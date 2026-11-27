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

type Server struct {
	provider Provider
	mode     string // redirect | proxy
	log      *slog.Logger

	mu    sync.Mutex
	cache map[string]cacheItem
	ttl   time.Duration
}

func New(provider Provider, mode string, log *slog.Logger) *Server {
	if log == nil {
		log = slog.Default()
	}
	if mode != "proxy" {
		mode = "redirect"
	}
	return &Server{provider: provider, mode: mode, log: log, cache: map[string]cacheItem{}, ttl: 50 * time.Minute}
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

func (s *Server) resolve(ctx context.Context, pickcode, ua string) (string, error) {
	key := pickcode + "|" + ua
	s.mu.Lock()
	if it, ok := s.cache[key]; ok && time.Now().Before(it.expire) {
		s.mu.Unlock()
		return it.url, nil
	}
	s.mu.Unlock()

	u, err := s.provider.DownloadURL(ctx, pickcode)
	if err != nil {
		return "", err
	}
	s.mu.Lock()
	s.cache[key] = cacheItem{url: u, expire: time.Now().Add(s.ttl)}
	s.mu.Unlock()
	return u, nil
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
