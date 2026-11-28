package embyproxy

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// 简化版 Emby 反代(借鉴 emby302 思路的独立实现):
//
//   客户端把 Emby 地址指向本端口,反代拦截两类请求,其余全部回源:
//   1. PlaybackInfo —— 对 .strm 媒体源强制 DirectPlay、剥离 TranscodingUrl,
//      客户端秒开直链、不走 NAS 转码;
//   2. /videos/{id}/stream —— 从 strm 文件读 pickcode,解析 115 直链 302;
//   失败一律回源(播放永不 500)。
//
// 不做 m3u8 转码代理:坚持转码的客户端仍由源站处理。

// Resolver 把 pickcode 换成 115 直链(生产实现是 p115svc,直链缓存/节流复用播放端口)。
type Resolver interface {
	DownloadURL(ctx context.Context, pickcode string) (string, error)
}

// ConfFn 每次请求读配置:设置页改了 Emby 地址立即生效。
type ConfFn func() Config

type Config struct {
	Base string // Emby 地址(设置页里的 emby_base)
	Key  string // Emby API Key
}

type Server struct {
	conf     ConfFn
	res      Resolver
	mediaDir string // 本地媒体根,strm 文件按 Emby 报告的 Path 直接读
	log      *slog.Logger
	client   *http.Client
}

func New(conf ConfFn, res Resolver, mediaDir string, log *slog.Logger) *Server {
	if log == nil {
		log = slog.Default()
	}
	return &Server{
		conf: conf, res: res, mediaDir: mediaDir, log: log,
		client: &http.Client{Timeout: 30 * time.Second},
	}
}

func (s *Server) Handler() http.Handler {
	return http.HandlerFunc(s.handle)
}

// /emby 前缀可带可不带(Emby 两种都服务)。
var (
	playbackInfoRe = regexp.MustCompile(`(?i)^(?:/emby)?/items/([^/]+)/playbackinfo/?$`)
	videoStreamRe  = regexp.MustCompile(`(?i)^(?:/emby)?/videos/([^/]+)/stream/?$`)
)

func (s *Server) handle(w http.ResponseWriter, r *http.Request) {
	cfg := s.conf()
	if cfg.Base == "" {
		http.Error(w, "emby proxy 未配置源站地址", http.StatusServiceUnavailable)
		return
	}
	p := strings.TrimSuffix(r.URL.Path, "/")
	if m := playbackInfoRe.FindStringSubmatch(p); m != nil && r.Method == http.MethodPost {
		s.playbackInfo(w, r, cfg, m[1])
		return
	}
	if m := videoStreamRe.FindStringSubmatch(p); m != nil {
		s.videoStream(w, r, cfg, m[1])
		return
	}
	s.passthrough(w, r, cfg)
}

// passthrough 其余请求原样回源。
func (s *Server) passthrough(w http.ResponseWriter, r *http.Request, cfg Config) {
	target, err := url.Parse(cfg.Base)
	if err != nil {
		http.Error(w, "emby base 无效", http.StatusBadGateway)
		return
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		s.log.Warn("Emby 回源失败", "path", r.URL.Path, "err", err)
		http.Error(w, "emby upstream error", http.StatusBadGateway)
	}
	proxy.ServeHTTP(w, r)
}

// playbackInfo 转发到源站后改写响应:strm 媒体源强制直连。
func (s *Server) playbackInfo(w http.ResponseWriter, r *http.Request, cfg Config, itemID string) {
	target := strings.TrimRight(cfg.Base, "/") + "/emby/Items/" + itemID + "/PlaybackInfo"
	if r.URL.RawQuery != "" {
		target += "?" + r.URL.RawQuery
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, target, r.Body)
	if err != nil {
		s.passthrough(w, r, cfg)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	if key := apiKeyOf(r); key != "" {
		req.Header.Set("X-Emby-Token", key)
	} else if cfg.Key != "" {
		req.Header.Set("X-Emby-Token", cfg.Key)
	}
	resp, err := s.client.Do(req)
	if err != nil {
		s.log.Warn("PlaybackInfo 回源失败", "item", itemID, "err", err)
		http.Error(w, "emby upstream error", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		http.Error(w, "emby upstream error", http.StatusBadGateway)
		return
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		w.WriteHeader(resp.StatusCode)
		_, _ = w.Write(body)
		return
	}
	rewritten := rewritePlaybackInfo(body, itemID)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, _ = w.Write(rewritten)
}

// rewritePlaybackInfo 对 .strm 媒体源:强制 DirectPlay/DirectStream、
// 剥离 TranscodingUrl、DirectStreamUrl 指回本服务(命中 videoStream 拦截)。
// 用 map 操作避免锁死 Emby 响应结构。
func rewritePlaybackInfo(body []byte, itemID string) []byte {
	var doc map[string]any
	if err := json.Unmarshal(body, &doc); err != nil {
		return body // 非 JSON 原样返回
	}
	sources, _ := doc["MediaSources"].([]any)
	for _, srcAny := range sources {
		src, ok := srcAny.(map[string]any)
		if !ok {
			continue
		}
		pathStr, _ := src["Path"].(string)
		if !isStrmPath(pathStr) {
			continue // 本地媒体不干预
		}
		src["SupportsDirectPlay"] = true
		src["SupportsDirectStream"] = true
		src["SupportsTranscoding"] = false
		delete(src, "TranscodingUrl")
		delete(src, "TranscodingSubProtocol")
		delete(src, "TranscodingContainer")
		mediaSourceID, _ := src["Id"].(string)
		src["DirectStreamUrl"] = "/emby/videos/" + itemID + "/stream?Static=true&MediaSourceId=" + url.QueryEscape(mediaSourceID)
	}
	out, err := json.Marshal(doc)
	if err != nil {
		return body
	}
	return out
}

func isStrmPath(pathStr string) bool {
	i := strings.LastIndexByte(pathStr, '.')
	return i >= 0 && strings.EqualFold(pathStr[i+1:], "strm")
}

// videoStream 拦截视频流请求:strm → pickcode → 115 直链 302;失败回源。
func (s *Server) videoStream(w http.ResponseWriter, r *http.Request, cfg Config, itemID string) {
	path := s.itemPath(r.Context(), cfg, itemID)
	if !isStrmPath(path) {
		s.passthrough(w, r, cfg)
		return
	}
	pick := s.pickcodeFromStrmFile(path)
	if pick == "" {
		s.log.Warn("strm 内容解析失败,回源", "item", itemID, "path", path)
		s.passthrough(w, r, cfg)
		return
	}
	u, err := s.res.DownloadURL(r.Context(), pick)
	if err != nil {
		s.log.Warn("取直链失败,回源", "pickcode", pick, "err", err)
		s.passthrough(w, r, cfg)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	http.Redirect(w, r, u, http.StatusFound)
}

// itemPath 从源站查条目 Path。
func (s *Server) itemPath(ctx context.Context, cfg Config, itemID string) string {
	q := url.Values{}
	q.Set("Ids", itemID)
	q.Set("Fields", "Path")
	q.Set("Limit", "1")
	if key := cfg.Key; key != "" {
		q.Set("api_key", key)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(cfg.Base, "/")+"/emby/Items?"+q.Encode(), nil)
	if err != nil {
		return ""
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return ""
	}
	var doc struct {
		Items []struct {
			Path string `json:"Path"`
		} `json:"Items"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&doc); err != nil {
		return ""
	}
	if len(doc.Items) == 0 {
		return ""
	}
	return doc.Items[0].Path
}

// pickcodeFromStrmFile 读本地 strm 文件,解析出 pickcode。
// 兼容内容:{base}/d/{pickcode}[.{ext}][?/{name}] 与 {uid}~{pickcode}。
// 只允许读 mediaDir 内的文件(防路径穿越),mediaDir 未配置一律拒绝。
func (s *Server) pickcodeFromStrmFile(path string) string {
	if s.mediaDir == "" || !insideDir(s.mediaDir, path) {
		return ""
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	line := string(raw)
	if i := strings.IndexByte(line, '\n'); i >= 0 {
		line = line[:i]
	}
	line = strings.TrimSpace(line)
	u, err := url.Parse(line)
	if err != nil || u.Path == "" {
		return ""
	}
	segs := strings.Split(u.Path, "/")
	var id string
	for i, seg := range segs {
		if seg == "d" && i+1 < len(segs) {
			id = segs[i+1]
			break
		}
	}
	if id == "" {
		return ""
	}
	if i := strings.LastIndex(id, "~"); i >= 0 {
		id = id[i+1:]
	}
	// 剥掉 pickcode 后缀的扩展名(pick_code 格式可能带 .iso 等)
	if i := strings.LastIndexByte(id, '.'); i > 0 {
		id = id[:i]
	}
	return id
}

func insideDir(root, path string) bool {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

// apiKeyOf 从请求里拿访问凭据(客户端可能用 query 或 header)。
func apiKeyOf(r *http.Request) string {
	if v := r.URL.Query().Get("api_key"); v != "" {
		return v
	}
	if v := r.URL.Query().Get("X-Emby-Token"); v != "" {
		return v
	}
	if v := r.Header.Get("X-Emby-Token"); v != "" {
		return v
	}
	// Emby 客户端 Authorization: MediaBrowser Client="..", ..., Token=".."
	if v := r.Header.Get("Authorization"); strings.Contains(v, "Token=\"") {
		if i := strings.LastIndex(v, "Token=\""); i >= 0 {
			tok := v[i+len(`Token="`):]
			return strings.TrimSuffix(tok, "\"")
		}
	}
	return ""
}
