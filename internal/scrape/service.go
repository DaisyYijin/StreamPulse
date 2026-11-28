package scrape

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	"streampulse/internal/store"
)

// Service 基础刮削:按媒体库扫描台账,对每个片目(电影目录/剧集目录)解析
// 身份 → TMDB 搜索 → 写 nfo + 海报到本地媒体目录,Emby 自己扫描即用。
//
// 纪律:
//   - 幂等:nfo 已存在且 tmdbid 一致则跳过;图片已存在(非空)跳过;
//   - 原子写:nfo/图片走临时文件 + rename;
//   - 单片目失败不阻断整库;电影/剧集按 3 路并行;
//   - 全部产物写本地,零 115 请求。
type Service struct {
	Store *store.Store
	Log   *slog.Logger

	mu      sync.Mutex
	running map[int64]bool // libraryID 防重入
}

type Summary struct {
	OK      int      `json:"ok"`
	Failed  int      `json:"failed"`
	Skipped int      `json:"skipped"`
	Details []string `json:"details,omitempty"`
}

type workItem struct {
	kind    string // movie | tv
	dir     string // 片目本地目录
	relDir  string // 相对媒体库根
	guess   Guess
	fileRel string // 第一个视频的相对路径(给日志)
}

// ScrapeLibrary 刮削一个媒体库。tmdbBase 供测试注入;空串用线上。
func (s *Service) ScrapeLibrary(ctx context.Context, libID int64, tmdbBase string) (Summary, error) {
	s.mu.Lock()
	if s.running == nil {
		s.running = map[int64]bool{}
	}
	if s.running[libID] {
		s.mu.Unlock()
		return Summary{}, fmt.Errorf("该库已在刮削中")
	}
	s.running[libID] = true
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.running, libID)
		s.mu.Unlock()
	}()

	var sum Summary
	lib, err := s.Store.GetLibrary(libID)
	if err != nil {
		return sum, err
	}
	key := s.Store.GetSetting("tmdb_api_key", "")
	if key == "" {
		return sum, fmt.Errorf("未配置 TMDB API Key（设置页填写后可用）")
	}
	lang := s.Store.GetSetting("tmdb_language", "zh-CN")
	tmdb := NewTMDB(key, lang)
	if tmdbBase != "" {
		// 测试注入:API 与图片都指向同一台假服务器
		tmdb.Base = tmdbBase
		tmdb.ImgBase = tmdbBase + "/img"
	}

	files, err := s.Store.ListFiles(lib.ID)
	if err != nil {
		return sum, err
	}

	// 组片目:movie = strm 所在目录;tv = 含季目录的节目目录
	items := s.groupItems(lib.LocalDir, files)
	// 3 路并行
	ch := make(chan workItem)
	var mu sync.Mutex
	var wg sync.WaitGroup
	for i := 0; i < 3; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for it := range ch {
				n, err := s.scrapeItem(ctx, tmdb, lib.LocalDir, it)
				mu.Lock()
				switch {
				case err != nil:
					sum.Failed++
					sum.Details = append(sum.Details, fmt.Sprintf("%s: %v", it.relDir, err))
				case n == 0:
					sum.Skipped++
				default:
					sum.OK++
				}
				mu.Unlock()
			}
		}()
	}
	for _, it := range items {
		select {
		case <-ctx.Done():
			break
		case ch <- it:
		}
	}
	close(ch)
	wg.Wait()

	_ = s.Store.SaveScrapeRecord(&store.ScrapeRecord{
		LibraryID: lib.ID, OK: sum.OK, Failed: sum.Failed, Skipped: sum.Skipped,
		Message: strings.Join(sum.Details, "; "),
	})
	s.Log.Info("刮削完成", "library", lib.Name, "ok", sum.OK, "failed", sum.Failed, "skipped", sum.Skipped)
	return sum, nil
}

// groupItems 把台账文件归组成片目工作项。
func (s *Service) groupItems(root string, files []store.SyncedFile) []workItem {
	seen := map[string]workItem{}
	var order []string
	for _, f := range files {
		if f.Status != "ok" {
			continue
		}
		rel := filepath.ToSlash(f.RelPath)
		g := GuessFromRelPath(rel)
		dir := filepath.Dir(f.STRMPath)
		key := ""
		switch g.Kind {
		case "tv":
			// 节目目录:季目录的上一级;没有季目录就用文件目录
			showDir := dir
			segs := strings.Split(rel, "/")
			for i, seg := range segs {
				if seasonDirRe.MatchString(seg) && i > 0 {
					showDir = filepath.Join(root, filepath.FromSlash(strings.Join(segs[:i], "/")))
					break
				}
			}
			key = "tv:" + showDir
			if _, ok := seen[key]; !ok {
				seen[key] = workItem{kind: "tv", dir: showDir, relDir: relDirOf(root, showDir), guess: g, fileRel: rel}
				order = append(order, key)
			}
		case "movie":
			key = "movie:" + dir
			if _, ok := seen[key]; !ok {
				seen[key] = workItem{kind: "movie", dir: dir, relDir: relDirOf(root, dir), guess: g, fileRel: rel}
				order = append(order, key)
			}
		default:
			// 解析不了的不猜,避免乱写 nfo
		}
	}
	out := make([]workItem, 0, len(order))
	for _, k := range order {
		out = append(out, seen[k])
	}
	return out
}

func relDirOf(root, dir string) string {
	if rel, err := filepath.Rel(root, dir); err == nil {
		return filepath.ToSlash(rel)
	}
	return ""
}

// scrapeItem 刮一个片目;返回写入的产物数(0 = 全部已存在,视为 skipped)。
func (s *Service) scrapeItem(ctx context.Context, tmdb *TMDB, root string, it workItem) (int, error) {
	written := 0
	var (
		m   *Match
		err error
	)
	switch it.kind {
	case "tv":
		m, err = tmdb.SearchTV(ctx, it.guess.ShowTitle, it.guess.Year)
	default:
		m, err = tmdb.SearchMovie(ctx, it.guess.Title, it.guess.Year)
	}
	if err != nil {
		return 0, err
	}
	if m == nil {
		return 0, fmt.Errorf("TMDB 无匹配: %q", it.guess.Title)
	}

	// 幂等:nfo 已存在且 tmdbid 一致 → 只补缺的图片
	nfoName := "tvshow.nfo"
	if it.kind == "movie" {
		nfoName = "movie.nfo"
	}
	nfoPath := filepath.Join(it.dir, nfoName)
	existing := readTMDBID(nfoPath)
	if existing != "" && existing != fmt.Sprintf("%d", m.ID) {
		return 0, fmt.Errorf("已有 nfo 属于其它条目 (tmdbid %s)，跳过避免覆盖", existing)
	}
	if existing == "" {
		nfo := buildNFO(it.kind, m)
		if err := writeFileAtomic(nfoPath, nfo); err != nil {
			return written, err
		}
		written++
	}

	written += s.fetchImage(ctx, tmdb, filepath.Join(it.dir, "poster.jpg"), tmdb.ImageURL(m.PosterPath, "w500"))
	written += s.fetchImage(ctx, tmdb, filepath.Join(it.dir, "fanart.jpg"), tmdb.ImageURL(m.BackdropPath, "w1280"))

	// 剧集:季目录补 poster.jpg
	if it.kind == "tv" && it.guess.Season > 0 {
		if pp, err := tmdb.SeasonPoster(ctx, m.ID, it.guess.Season); err == nil && pp != "" {
			seasonDir := findSeasonDir(root, it.dir, it.guess.Season)
			if seasonDir != "" {
				written += s.fetchImage(ctx, tmdb, filepath.Join(seasonDir, "poster.jpg"), tmdb.ImageURL(pp, "w500"))
			}
		}
	}
	return written, nil
}

// fetchImage 下载图片(已存在非空文件跳过)。
func (s *Service) fetchImage(ctx context.Context, tmdb *TMDB, dst, url string) int {
	if url == "" {
		return 0
	}
	if st, err := os.Stat(dst); err == nil && st.Size() > 0 {
		return 0
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0
	}
	resp, err := tmdb.client.Do(req)
	if err != nil {
		return 0
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, 20<<20))
	if err != nil || len(b) == 0 {
		return 0
	}
	if err := writeFileAtomic(dst, string(b)); err != nil {
		return 0
	}
	return 1
}

// findSeasonDir 在节目目录下找季目录。
func findSeasonDir(root, showDir string, season int) string {
	entries, err := os.ReadDir(showDir)
	if err != nil {
		return ""
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		if m := seasonDirRe.FindStringSubmatch(e.Name()); m != nil {
			n := 0
			_, _ = fmt.Sscanf(m[1], "%d", &n)
			if n == season {
				return filepath.Join(showDir, e.Name())
			}
		}
	}
	return ""
}

// buildNFO 生成最小可用的 Kodi/Emby 兼容 nfo。
func buildNFO(kind string, m *Match) string {
	name := xmlEscape(m.DisplayName())
	plot := xmlEscape(m.Overview)
	date := xmlEscape(m.Date())
	id := fmt.Sprintf("%d", m.ID)
	if kind == "tv" {
		return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<tvshow>\n  <title>" + name +
			"</title>\n  <plot>" + plot + "</plot>\n  <premiered>" + date + "</premiered>\n  <tmdbid>" + id +
			"</tmdbid>\n  <uniqueid type=\"tmdb\" default=\"true\">" + id + "</uniqueid>\n</tvshow>\n"
	}
	return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<movie>\n  <title>" + name +
		"</title>\n  <plot>" + plot + "</plot>\n  <premiered>" + date + "</premiered>\n  <tmdbid>" + id +
		"</tmdbid>\n  <uniqueid type=\"tmdb\" default=\"true\">" + id + "</uniqueid>\n</movie>\n"
}

func xmlEscape(s string) string {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", "\"", "&quot;", "'", "&apos;")
	return r.Replace(s)
}

// readTMDBID 从已有 nfo 里读 tmdbid(幂等判断)。
func readTMDBID(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	var doc struct {
		TMDBID string `json:"tmdbid"`
	}
	// nfo 是 XML;不做完整解析,正则取值
	if m := tmdbIDRe.FindSubmatch(b); m != nil {
		return string(m[1])
	}
	_ = doc
	return ""
}

var tmdbIDRe = regexp.MustCompile(`<tmdbid>\s*([^<\s]+)\s*</tmdbid>`)

// writeFileAtomic 临时文件 + rename,失败不留半个文件。
func writeFileAtomic(path, content string) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".scrape-*.part")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	if _, err := tmp.WriteString(content); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpName)
		return err
	}
	return os.Rename(tmpName, path)
}
