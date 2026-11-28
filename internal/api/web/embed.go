package web

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
	"time"
)

// 前端单文件产物(vite-plugin-singlefile 构建到 dist/index.html)。
// 产物提交进仓库,Go 构建不需要 Node。
//
//go:embed all:dist
var distFS embed.FS

// Handler 返回 SPA 静资源处理器:静态资源带缓存头,未知路径回 index.html
// (hash 路由下只是兜底)。
func Handler() http.Handler {
	serveIndex := func(w http.ResponseWriter, r *http.Request) {
		b, err := distFS.ReadFile("dist/index.html")
		if err != nil {
			http.Error(w, "前端资源缺失，请先构建 web/（npm run build）", http.StatusServiceUnavailable)
			return
		}
		// 入口不缓存,发版即生效
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write(b)
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(r.URL.Path, "/")
		if p == "" || p == "index.html" {
			serveIndex(w, r)
			return
		}
		b, err := distFS.ReadFile("dist/" + p)
		if err != nil {
			serveIndex(w, r) // SPA 路由回退
			return
		}
		w.Header().Set("Cache-Control", "public, max-age=86400")
		var mod time.Time
		if e, statErr := fs.Stat(distFS, "dist/"+p); statErr == nil {
			mod = e.ModTime()
		}
		http.ServeContent(w, r, p, mod, strings.NewReader(string(b)))
	})
}
