package deepdel

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"streampulse/internal/store"
)

// Service 处理 Emby 删除联动。原则：只删台账命中的文件；路径必须落在媒体库目录内；
// 网盘删除默认关闭，开启后也只移入 115 回收站（可还原）。
// Remote 是网盘删除能力，便于测试注入。
type Remote interface {
	DeleteFiles(ctx context.Context, accountID int64, fids []string) error
}

type Service struct {
	Store        *store.Store
	Svc          Remote
	Log          *slog.Logger
}

type Item struct {
	Type string
	Name string
	Path string
}

type Result struct {
	Matched       int      `json:"matched"`
	DeletedLocal  int      `json:"deletedLocal"`
	DeletedRemote int      `json:"deletedRemote"`
	RemovedDirs   int      `json:"removedDirs"`
	Rejected      string   `json:"rejected,omitempty"`
	Warnings      []string `json:"warnings,omitempty"`

	// 记录区用(不进常规响应)
	FIDs     []string `json:"-"`
	RelPaths []string `json:"-"`
}

var allowedTypes = map[string]bool{
	"Movie": true, "Episode": true, "Season": true, "Series": true,
}

// Handle 执行一次深度删除并记录。所有拒绝条件都会返回 Result.Rejected，
// 不做任何删除;每次执行(含拒绝)都落一条记录,fids 是回收站还原凭据。
func (s *Service) Handle(ctx context.Context, item Item) (Result, error) {
	res, err := s.handle(ctx, item)
	rec := &store.DeepDeleteRecord{
		ItemID:       item.Name,
		ItemType:     item.Type,
		ItemName:     item.Name,
		MediaType:    item.Type,
		EpisodeLabel: EpisodeLabel(res.RelPaths),
		RelPaths:     res.RelPaths,
		FIDs:         res.FIDs,
		Message:      res.Rejected,
		VideoCount:   res.DeletedLocal,
		RemoteCount:  res.DeletedRemote,
	}
	if len(res.Warnings) > 0 {
		rec.Message = strings.Join(res.Warnings, "; ")
	}
	if err != nil {
		rec.Status = "failed"
		rec.Message = err.Error()
	} else if res.Rejected != "" {
		rec.Status = "rejected"
		rec.Message = res.Rejected
	} else {
		rec.Status = "done"
		rec.Message = ""
	}
	if serr := s.Store.SaveDeepDeleteRecord(rec); serr != nil {
		s.Log.Warn("深删记录落库失败", "err", serr)
	}
	return res, err
}

func (s *Service) handle(ctx context.Context, item Item) (Result, error) {
	var res Result
	if !allowedTypes[item.Type] {
		res.Rejected = "不支持的媒体类型: " + item.Type
		return res, nil
	}
	if strings.TrimSpace(item.Path) == "" {
		res.Rejected = "缺少路径"
		return res, nil
	}
	libs, err := s.Store.ListLibraries()
	if err != nil {
		return res, err
	}
	clean := filepath.Clean(item.Path)

	// 选最长匹配的媒体库：库目录可能嵌套（/media 与 /media/movies），必须命中更具体的那个。
	var (
		lib   *store.Library
		files []store.SyncedFile
	)
	for i := range libs {
		l := &libs[i]
		if !within(l.LocalDir, clean) {
			continue
		}
		if isRoot(l.LocalDir, clean) {
			res.Rejected = "拒绝删除媒体库根目录"
			return res, nil
		}
		if lib != nil && len(filepath.Clean(l.LocalDir)) <= len(filepath.Clean(lib.LocalDir)) {
			continue
		}
		all, err := s.Store.ListFiles(l.ID)
		if err != nil {
			return res, err
		}
		if matched := matchFiles(all, clean); len(matched) > 0 {
			lib = l
			files = matched
		}
	}
	if lib == nil || len(files) == 0 {
		res.Rejected = "路径不在台账中（拒绝删除）"
		return res, nil
	}

	// 本地删除：STRM + 同名 sidecar
	for _, f := range files {
		if err := removeWithSidecars(f.STRMPath); err != nil {
			res.Warnings = append(res.Warnings, "删除失败 "+f.STRMPath+": "+err.Error())
			continue
		}
		res.DeletedLocal++
		res.FIDs = append(res.FIDs, f.FID)
		if rel, rerr := filepath.Rel(lib.LocalDir, f.STRMPath); rerr == nil {
			res.RelPaths = append(res.RelPaths, rel)
		}
		if err := s.Store.DeleteFile(f.LibraryID, f.FID); err != nil {
			res.Warnings = append(res.Warnings, "台账删除失败 "+f.FID+": "+err.Error())
		}
	}
	res.Matched = len(files)

	// 网盘删除（可选）：每次从项目设置读取，保存后立即生效
	if s.Store.GetSetting("emby_delete_remote", "0") == "1" {
		fids := make([]string, 0, len(files))
		for _, f := range files {
			if f.FID != "" {
				fids = append(fids, f.FID)
			}
		}
		if len(fids) > 0 {
			if err := s.Svc.DeleteFiles(ctx, lib.AccountID, fids); err != nil {
				res.Warnings = append(res.Warnings, "网盘删除失败: "+err.Error())
			} else {
				res.DeletedRemote = len(fids)
				// 登记抑制:网盘删除会产生生活事件,TTL 内增量直接跳过(self),
				// 否则增量会把刚删的目录再"同步"一遍
				if err := s.Store.MarkSuppressed(fids, "delete", 2*time.Hour); err != nil {
					s.Log.Warn("事件抑制登记失败（不影响删除）", "err", err)
				}
			}
		}
	}

	// 空目录清理：只沿本次删除文件的父链，库根不动
	res.RemovedDirs = pruneEmptyDirs(lib.LocalDir, files)
	return res, nil
}

func within(root, p string) bool {
	rel, err := filepath.Rel(filepath.Clean(root), p)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

var epRe = regexp.MustCompile(`(?i)s(\d{1,2})[\s/\\._-]{0,3}e(\d{1,3})`)

// EpisodeLabel 从相对路径里提取集数标签:
// 单集 S02E05 / 同季连续 S02E01–E03 / 跨季 S01–S02;电影返回空。
func EpisodeLabel(relPaths []string) string {
	type ep struct{ s, e int }
	seen := map[ep]bool{}
	for _, p := range relPaths {
		for _, m := range epRe.FindAllStringSubmatch(p, 1) {
			var s, e int
			_, _ = fmt.Sscanf(m[1], "%d", &s)
			_, _ = fmt.Sscanf(m[2], "%d", &e)
			seen[ep{s, e}] = true
		}
	}
	if len(seen) == 0 {
		return ""
	}
	seasons := map[int][]int{}
	for k := range seen {
		seasons[k.s] = append(seasons[k.s], k.e)
	}
	if len(seasons) == 1 {
		var s int
		var eps []int
		for k, v := range seasons {
			s = k
			eps = v
		}
		if len(eps) == 1 {
			return fmt.Sprintf("S%02dE%02d", s, eps[0])
		}
		min, max := eps[0], eps[0]
		for _, e := range eps {
			if e < min {
				min = e
			}
			if e > max {
				max = e
			}
		}
		return fmt.Sprintf("S%02dE%02d–E%02d", s, min, max)
	}
	minS, maxS := 1000, 0
	for s := range seasons {
		if s < minS {
			minS = s
		}
		if s > maxS {
			maxS = s
		}
	}
	return fmt.Sprintf("S%02d–S%02d", minS, maxS)
}

func isRoot(root, p string) bool {
	return filepath.Clean(root) == filepath.Clean(p)
}

// matchFiles：Path 指向 .strm 时精确匹配；指向目录时匹配其下所有 STRM。
func matchFiles(files []store.SyncedFile, target string) []store.SyncedFile {
	var out []store.SyncedFile
	for _, f := range files {
		if filepath.Clean(f.STRMPath) == target {
			out = append(out, f)
			continue
		}
		if strings.HasSuffix(strings.ToLower(target), ".strm") {
			continue
		}
		prefix := target + string(filepath.Separator)
		if strings.HasPrefix(filepath.Clean(f.STRMPath), prefix) {
			out = append(out, f)
		}
	}
	return out
}

var sidecarExts = map[string]bool{
	".nfo": true, ".srt": true, ".ass": true, ".ssa": true, ".vtt": true,
	".jpg": true, ".jpeg": true, ".png": true, ".webp": true,
}

func removeWithSidecars(strmPath string) error {
	if err := os.Remove(strmPath); err != nil && !os.IsNotExist(err) {
		return err
	}
	base := strings.TrimSuffix(strmPath, filepath.Ext(strmPath))
	entries, err := os.ReadDir(filepath.Dir(strmPath))
	if err != nil {
		return nil
	}
	name := filepath.Base(base)
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		n := e.Name()
		ext := strings.ToLower(filepath.Ext(n))
		if !sidecarExts[ext] {
			continue
		}
		stem := strings.TrimSuffix(n, filepath.Ext(n))
		if stem == name || strings.HasPrefix(stem, name+"-") || strings.HasSuffix(stem, "-thumb") {
			_ = os.Remove(filepath.Join(filepath.Dir(strmPath), n))
		}
	}
	return nil
}

// pruneEmptyDirs 从文件所在目录向上删空目录，直到媒体库根（不删根）。
func pruneEmptyDirs(root string, files []store.SyncedFile) int {
	dirs := map[string]bool{}
	for _, f := range files {
		d := filepath.Dir(f.STRMPath)
		for within(root, d) && !isRoot(root, d) {
			dirs[d] = true
			d = filepath.Dir(d)
		}
	}
	// 深的先删
	list := make([]string, 0, len(dirs))
	for d := range dirs {
		list = append(list, d)
	}
	sortByDepthDesc(list)
	removed := 0
	for _, d := range list {
		if err := os.Remove(d); err == nil {
			removed++
		}
	}
	return removed
}

func sortByDepthDesc(list []string) {
	for i := 1; i < len(list); i++ {
		for j := i; j > 0 && strings.Count(list[j], string(filepath.Separator)) > strings.Count(list[j-1], string(filepath.Separator)); j-- {
			list[j], list[j-1] = list[j-1], list[j]
		}
	}
}

var _ = errors.New
