package scan

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"streampulse/internal/pan115"
	"streampulse/internal/store"
	"streampulse/internal/strm"
)

// Source 是扫描需要的 115 能力，便于测试注入假实现。
type Source interface {
	ListDir(ctx context.Context, cid string) ([]pan115.Entry, error)
	DownloadURL(ctx context.Context, pickcode string) (string, error)
}

type Options struct {
	Library *store.Library
	Source  Source
	Store   *store.Store
	UID     string // 附加账号的 UID 前缀，主号留空
	Logger  *slog.Logger
}

type metaJob struct {
	entry pan115.Entry
	rel   string
}

type Result struct {
	Scanned  int      `json:"scanned"`
	Written  int      `json:"written"`
	Skipped  int      `json:"skipped"`
	Orphans  int      `json:"orphans"`
	Renamed  int      `json:"renamed"`
	Meta     int      `json:"meta"`
	Errors   int      `json:"errors"`
	Moves    []Move   `json:"moves"`
	Warnings []string `json:"warnings"`
}

type Move struct {
	CID  string `json:"cid"`
	From string `json:"from"`
	To   string `json:"to"`
}

type dirNode struct {
	CID       string
	ParentCID string
	Name      string
	RelPath   string
}

// Run 执行一次全量或目录级扫描。
// 视频串行（守 115 读写节流），附属文件 5 路并行。
func Run(ctx context.Context, opt Options) (Result, error) {
	if opt.Logger == nil {
		opt.Logger = slog.Default()
	}
	lib := opt.Library
	if lib == nil {
		return Result{}, errors.New("library 为空")
	}
	videoExts := splitExts(lib.VideoExts)
	metaExts := splitExts(lib.MetaExts)
	seen := map[string]bool{}

	// 快速模式每页 1000，标准模式每页 200：前者请求少、后者对风控更稳。
	if pl, ok := opt.Source.(interface{ SetPageLimit(int) }); ok {
		if lib.ScanMode == "normal" {
			pl.SetPageLimit(200)
		} else {
			pl.SetPageLimit(1000)
		}
	}

	var res Result
	// 1. 目录树：BFS，先建目录与相对路径
	dirs, err := walkDirs(ctx, opt.Source, lib.RemoteCID, lib.Name)
	if err != nil {
		return res, err
	}
	oldDirs, _ := opt.Store.ListDirs(lib.ID)
	moves := detectMoves(oldDirs, dirs)
	for _, m := range moves {
		if err := applyMove(lib.LocalDir, m.From, m.To); err != nil {
			opt.Logger.Warn("目录改名迁移失败", "from", m.From, "to", m.To, "err", err)
			res.Warnings = append(res.Warnings, fmt.Sprintf("改名迁移失败 %s → %s: %v", m.From, m.To, err))
			continue
		}
		res.Moves = append(res.Moves, m)
		res.Renamed++
	}
	for _, d := range dirs {
		_ = opt.Store.UpsertDir(lib.ID, d.CID, d.ParentCID, d.Name, d.RelPath)
	}

	// 2. 逐目录列文件；视频串行写 STRM，附属文件收集后并行下载
	var metaJobs []metaJob

	for _, d := range dirs {
		if ctx.Err() != nil {
			return res, ctx.Err()
		}
		entries, err := opt.Source.ListDir(ctx, d.CID)
		if err != nil {
			res.Errors++
			res.Warnings = append(res.Warnings, fmt.Sprintf("列目录失败 %s: %v", d.RelPath, err))
			continue
		}
		for _, e := range entries {
			if e.IsDir {
				continue
			}
			if e.Pickcode == "" {
				continue
			}
			rel := path.Join(d.RelPath, strm.SafeName(e.Name))
			if isVideo(e.Name, videoExts) {
				if e.Size < lib.MinSize {
					continue
				}
				res.Scanned++
				seen[e.FID] = true
				url := pan115.STRM(lib.BaseURL, lib.STRMFormat,
					pan115.STRMID(opt.UID, e.Pickcode, filepath.Ext(e.Name), lib.KeepExt, isISO(e.Name)), e.Name)
				p := strm.STRNPath(lib.LocalDir, d.RelPath, e.Name, lib.KeepExt)
				changed, err := strm.Write(p, url)
				if err != nil {
					res.Errors++
					res.Warnings = append(res.Warnings, fmt.Sprintf("写 STRM 失败 %s: %v", rel, err))
					continue
				}
				if changed {
					res.Written++
				} else {
					res.Skipped++
				}
				_ = opt.Store.UpsertFile(&store.SyncedFile{
					LibraryID: lib.ID, FID: e.FID, Pickcode: e.Pickcode, CID: d.CID,
					Name: e.Name, RelPath: rel, STRMPath: p, Size: e.Size, SHA1: e.SHA1, Status: "ok",
				})
			} else if isMeta(e.Name, metaExts) {
				metaJobs = append(metaJobs, metaJob{entry: e, rel: d.RelPath})
			}
		}
	}

	// 3. 附属文件并行（默认 5 路）
	res.Meta = downloadMeta(ctx, opt, metaJobs, 5)

	// 4. 本次没见到的台账行标 orphan（只标记不删）
	oldFiles, _ := opt.Store.ListFiles(lib.ID)
	for _, f := range oldFiles {
		if !seen[f.FID] && f.Status == "ok" {
			_ = opt.Store.MarkOrphan(lib.ID, f.FID)
			res.Orphans++
		}
	}
	_ = opt.Store.SetLibraryScanned(lib.ID)
	return res, nil
}

// walkDirs 只列目录，构建 cid → 相对路径。快速模式与标准模式这里共用；
// 真正的差异在 ListDir 的页大小（快速 1000 / 标准 200），由客户端配置。
func walkDirs(ctx context.Context, src Source, rootCID, rootName string) ([]dirNode, error) {
	root := dirNode{CID: rootCID, ParentCID: "", Name: rootName, RelPath: ""}
	out := []dirNode{root}
	queue := []dirNode{root}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		if ctx.Err() != nil {
			return out, ctx.Err()
		}
		entries, err := src.ListDir(ctx, cur.CID)
		if err != nil {
			return out, fmt.Errorf("列出 %s 失败: %w", cur.RelPath, err)
		}
		for _, e := range entries {
			if !e.IsDir || e.CID == "" || strings.HasPrefix(e.Name, ".") {
				continue
			}
			if isRecycle(e.Name) {
				continue
			}
			n := dirNode{
				CID:       e.CID,
				ParentCID: cur.CID,
				Name:      e.Name,
				RelPath:   path.Join(cur.RelPath, strm.SafeName(e.Name)),
			}
			out = append(out, n)
			queue = append(queue, n)
		}
	}
	return out, nil
}

// detectMoves 通过 cid 稳定、rel_path 变化来识别目录改名/移动。
func detectMoves(old []store.Dir, now []dirNode) []Move {
	byCID := make(map[string]store.Dir, len(old))
	for _, d := range old {
		byCID[d.CID] = d
	}
	var moves []Move
	for _, n := range now {
		o, ok := byCID[n.CID]
		if !ok || o.RelPath == n.RelPath {
			continue
		}
		moves = append(moves, Move{CID: n.CID, From: o.RelPath, To: n.RelPath})
	}
	// 浅层优先；父目录已迁移时子目录无需再迁移
	sort.Slice(moves, func(i, j int) bool {
		return strings.Count(moves[i].From, "/") < strings.Count(moves[j].From, "/")
	})
	var out []Move
	moved := map[string]bool{}
	for _, m := range moves {
		parent := path.Dir(m.From)
		if moved[parent] && parent != "." {
			moved[m.To] = true
			continue
		}
		out = append(out, m)
		moved[m.From] = true
	}
	return out
}

func applyMove(root, from, to string) error {
	if from == "" || to == "" || from == to {
		return nil
	}
	src := filepath.Join(root, from)
	dst := filepath.Join(root, to)
	if _, err := os.Stat(src); err != nil {
		return nil // 本地还没有这个目录
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	if err := os.Rename(src, dst); err == nil {
		return nil
	}
	// 跨盘/占用时逐文件搬
	var files []string
	_ = filepath.Walk(src, func(p string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() {
			files = append(files, p)
		}
		return nil
	})
	for _, f := range files {
		rel, _ := filepath.Rel(src, f)
		target := filepath.Join(dst, rel)
		_ = os.MkdirAll(filepath.Dir(target), 0o755)
		if err := os.Rename(f, target); err != nil {
			return err
		}
	}
	_ = os.RemoveAll(src)
	return nil
}

func downloadMeta(ctx context.Context, opt Options, jobs []metaJob, workers int) int {
	if len(jobs) == 0 {
		return 0
	}
	if workers < 1 {
		workers = 1
	}
	var (
		wg   sync.WaitGroup
		mu   sync.Mutex
		done int
	)
	ch := make(chan int)
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for idx := range ch {
				j := jobs[idx]
				if err := fetchFile(ctx, opt.Source, j.entry.Pickcode,
					filepath.Join(opt.Library.LocalDir, j.rel, strm.SafeName(j.entry.Name))); err != nil {
					continue
				}
				mu.Lock()
				done++
				mu.Unlock()
			}
		}()
	}
	for i := range jobs {
		select {
		case <-ctx.Done():
			break
		case ch <- i:
		}
	}
	close(ch)
	wg.Wait()
	return done
}

func fetchFile(ctx context.Context, src Source, pickcode, dst string) error {
	u, err := src.DownloadURL(ctx, pickcode)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("下载附属文件 HTTP %d", resp.StatusCode)
	}
	tmp, err := os.CreateTemp(filepath.Dir(dst), ".meta-*.part")
	if err != nil {
		return err
	}
	if _, err := io.Copy(tmp, resp.Body); err != nil {
		tmp.Close()
		os.Remove(tmp.Name())
		return err
	}
	tmp.Close()
	return os.Rename(tmp.Name(), dst)
}

func splitExts(s string) map[string]bool {
	out := map[string]bool{}
	for _, p := range strings.FieldsFunc(s, func(r rune) bool { return r == ',' || r == ' ' || r == ';' }) {
		p = strings.ToLower(strings.TrimSpace(p))
		if !strings.HasPrefix(p, ".") {
			p = "." + p
		}
		if p != "." {
			out[p] = true
		}
	}
	return out
}

func isVideo(name string, exts map[string]bool) bool {
	if len(exts) == 0 {
		exts = map[string]bool{".mkv": true, ".mp4": true, ".ts": true, ".m2ts": true, ".iso": true, ".avi": true, ".mov": true, ".wmv": true, ".flv": true, ".rmvb": true, ".webm": true, ".strm": false}
	}
	return exts[strings.ToLower(filepath.Ext(name))]
}

func isMeta(name string, exts map[string]bool) bool {
	if len(exts) == 0 {
		return false
	}
	return exts[strings.ToLower(filepath.Ext(name))]
}

func isISO(name string) bool { return strings.EqualFold(filepath.Ext(name), ".iso") }

func isRecycle(name string) bool {
	n := strings.ToLower(strings.TrimSpace(name))
	return n == "recycle_bin" || n == "回收站" || n == "#recycle"
}

// ScanOneDir 是「目录行同步 STRM」：只处理一个 cid，不改其他目录。
func ScanOneDir(ctx context.Context, opt Options, cid string) (Result, error) {
	var res Result
	if cid == "" {
		return res, errors.New("cid 为空")
	}
	lib := opt.Library
	entries, err := opt.Source.ListDir(ctx, cid)
	if err != nil {
		return res, err
	}
	rel := ""
	// 从台账里找这个 cid 的相对路径；找不到就当作根
	if dirs, _ := opt.Store.ListDirs(lib.ID); dirs != nil {
		for _, d := range dirs {
			if d.CID == cid {
				rel = d.RelPath
				break
			}
		}
	}
	videoExts := splitExts(lib.VideoExts)
	metaExts := splitExts(lib.MetaExts)
	for _, e := range entries {
		if e.IsDir || e.Pickcode == "" {
			continue
		}
		if isVideo(e.Name, videoExts) {
			url := pan115.STRM(lib.BaseURL, lib.STRMFormat,
				pan115.STRMID(opt.UID, e.Pickcode, filepath.Ext(e.Name), lib.KeepExt, isISO(e.Name)), e.Name)
			p := strm.STRNPath(lib.LocalDir, rel, e.Name, lib.KeepExt)
			changed, err := strm.Write(p, url)
			if err != nil {
				res.Errors++
				continue
			}
			res.Scanned++
			if changed {
				res.Written++
			}
			_ = opt.Store.UpsertFile(&store.SyncedFile{
				LibraryID: lib.ID, FID: e.FID, Pickcode: e.Pickcode, CID: cid,
				Name: e.Name, RelPath: path.Join(rel, strm.SafeName(e.Name)), STRMPath: p,
				Size: e.Size, SHA1: e.SHA1, Status: "ok",
			})
		} else if isMeta(e.Name, metaExts) {
			_ = fetchFile(ctx, opt.Source, e.Pickcode, filepath.Join(lib.LocalDir, rel, strm.SafeName(e.Name)))
			res.Meta++
		}
	}
	return res, nil
}

