package stream

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Provider 只要能把 pickcode 换成直链。
type Provider interface {
	DownloadURL(ctx context.Context, pickcode string) (string, error)
}

type cacheItem struct {
	url    string
	expire time.Time
}

// flight 是进行中的取链:并发同 key 请求合并成一次上游调用(防缓存击穿)。
type flight struct {
	done chan struct{}
	url  string
	err  error
}

type Server struct {
	provider Provider
	mode     string // redirect | proxy
	log      *slog.Logger

	mu    sync.Mutex
	cache map[string]cacheItem
	ttl   time.Duration

	fmu     sync.Mutex
	flights map[string]*flight
}

func New(provider Provider, mode string, log *slog.Logger) *Server {
	if log == nil {
		log = slog.Default()
	}
	if mode != "proxy" {
		mode = "redirect"
	}
	return &Server{
		provider: provider, mode: mode, log: log,
		cache:   map[string]cacheItem{},
		ttl:     50 * time.Minute,
		flights: map[string]*flight{},
	}
}

// Handler 返回播放端口的路由。独立端口，不与管理后台共用。
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = io.WriteString(w, "ok")
	})
	mux.HandleFunc("GET /d/{id}", s.handlePlay)
	return mux
}

var extRe = regexp.MustCompile(`(?i)\.(mkv|mp4|ts|m2ts|iso|avi|mov|wmv|flv|rmvb|webm)$`)

func (s *Server) handlePlay(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		http.NotFound(w, r)
		return
	}
	// 附加账号 {uid}~{pickcode}；P0 只支持主号，直接取后半段
	if i := strings.LastIndex(id, "~"); i >= 0 {
		id = id[i+1:]
	}
	id = extRe.ReplaceAllString(id, "")
	if id == "" {
		http.NotFound(w, r)
		return
	}

	u, err := s.resolve(r.Context(), id, r.UserAgent())
	if err != nil {
		s.log.Warn("取直链失败", "pickcode", id, "err", err)
		http.Error(w, "upstream unavailable", http.StatusBadGateway)
		return
	}
	if s.mode == "proxy" {
		s.proxy(w, r, u)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	http.Redirect(w, r, u, http.StatusFound)
}

// resolve 取直链:缓存 → HEAD 失效校验 → singleflight 合并并发回源。
// 直链与 UA 绑定,缓存 key 带 UA。
func (s *Server) resolve(ctx context.Context, pickcode, ua string) (string, error) {
	key := pickcode + "|" + ua
	s.mu.Lock()
	if it, ok := s.cache[key]; ok && time.Now().Before(it.expire) {
		u := it.url
		s.mu.Unlock()
		// 命中缓存也 HEAD 校验:链接可能已被 115 吊销,直接 302 死链
		// 客户端体验更差。探测必须用与播放请求一致的 UA(115 直链与 UA
		// 绑定);HEAD 网络错误不判死,照常给出。
		if s.headOK(ctx, u, ua) {
			return u, nil
		}
		s.mu.Lock()
		delete(s.cache, key)
		s.mu.Unlock()
		s.log.Info("直链已失效，重新取链", "pickcode", pickcode)
	} else {
		s.mu.Unlock()
	}

	// singleflight:同 key 并发请求共享一次上游取链
	s.fmu.Lock()
	if f, ok := s.flights[key]; ok {
		s.fmu.Unlock()
		select {
		case <-f.done:
		case <-ctx.Done():
			return "", ctx.Err()
		}
		if f.err != nil {
			return "", f.err
		}
		return f.url, nil
	}
	f := &flight{done: make(chan struct{})}
	s.flights[key] = f
	s.fmu.Unlock()

	defer func() {
		s.fmu.Lock()
		delete(s.flights, key)
		s.fmu.Unlock()
	}()

	u, err := s.provider.DownloadURL(ctx, pickcode)
	if err == nil {
		s.mu.Lock()
		s.cache[key] = cacheItem{url: u, expire: time.Now().Add(s.ttl)}
		s.mu.Unlock()
	}
	f.url, f.err = u, err
	close(f.done)
	if err != nil {
		return "", err
	}
	return u, nil
}

// headOK 对缓存直链做 HEAD 校验;2xx 视为存活,网络错误视为存活(不挡播放)。
func (s *Server) headOK(ctx context.Context, u, ua string) bool {
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, u, nil)
	if err != nil {
		return true
	}
	req.Header.Set("User-Agent", ua)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return true
	}
	defer resp.Body.Close()
	return resp.StatusCode >= 200 && resp.StatusCode < 300
}

// proxy 是可选中转模式：保留 Range，逐段转发；上游 401/403 时刷新一次直链。
func (s *Server) proxy(w http.ResponseWriter, r *http.Request, target string) {
	for attempt := 0; attempt < 2; attempt++ {
		req, err := http.NewRequestWithContext(r.Context(), r.Method, target, nil)
		if err != nil {
			http.Error(w, "bad upstream", http.StatusBadGateway)
			return
		}
		for _, h := range []string{"Range", "If-Range", "User-Agent"} {
			if v := r.Header.Get(h); v != "" {
				req.Header.Set(h, v)
			}
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			http.Error(w, "upstream error", http.StatusBadGateway)
			return
		}
		if (resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden) && attempt == 0 {
			resp.Body.Close()
			// 让下次 resolve 重新取链
			s.invalidate(r.UserAgent())
			continue
		}
		for k, vv := range resp.Header {
			switch k {
			case "Content-Length", "Content-Range", "Content-Type", "Accept-Ranges":
				for _, v := range vv {
					w.Header().Add(k, v)
				}
			}
		}
		w.WriteHeader(resp.StatusCode)
		_, _ = io.Copy(w, resp.Body)
		resp.Body.Close()
		return
	}
	http.Error(w, "upstream rejected", http.StatusBadGateway)
}

func (s *Server) invalidate(ua string) {
	s.mu.Lock()
	for k := range s.cache {
		if strings.HasSuffix(k, "|"+ua) {
			delete(s.cache, k)
		}
	}
	s.mu.Unlock()
}
