package adopt

import (
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"streampulse/internal/pan115"
	"streampulse/internal/store"
)

// 接管其他工具生成的 STRM:路径与文件名不动、只换直链,
// Emby 条目与观看记录全保留。
//
// 纪律(独立实现,协议思路来自对同类工具公开格式的观察):
//   - 解析:pickcode 参数 > /d/{id} 路径段 > 网盘路径后缀(对不上号),
//     每种来源尽力识别;
//   - 对号:pickcode 精确匹配台账 → 同名同位直接接管;位置不同算"名字变了";
//     无 pickcode 的按相对路径对台账;
//   - 预演与执行分离:执行时重新对号,不用预演结论;
//   - 执行:内容换成本站 /d/{pickcode},还原 mtime(Emby 时间排序不乱);
//   - 未配播放地址不许执行(兜底回环地址会让上万个 STRM 全播不了)。

// Foreign 是一个待接管的 STRM 文件。
type Foreign struct {
	LibraryID int64  `json:"libraryId"`
	Rel       string `json:"rel"` // 相对库根,斜杠分隔
	Path      string `json:"path"`
}

// AdoptItem 是一条可接管的对应关系。
type AdoptItem struct {
	Foreign Foreign          `json:"foreign"`
	File    store.SyncedFile `json:"file"`
	Kind    string           `json:"kind"` // same_path | renamed | by_path
}

// Plan 是预演结论(纯数据,可序列化给前端)。
type Plan struct {
	Scanned   int          `json:"scanned"`
	Adoptable []AdoptItem  `json:"adoptable"`
	Missing   []Foreign    `json:"missing"`
	Skipped   int          `json:"skipped"` // 本站自己的格式,无需接管
}

// ParsePickcode 从 STRM 内容解析 115 pickcode;返回空表示无法解析。
// 识别:pickcode= 查询参数 > /d/{id} 路径段(剥扩展名与 ~ 账号前缀)。
func ParsePickcode(content string) string {
	line := content
	if i := strings.IndexByte(line, '\n'); i >= 0 {
		line = line[:i]
	}
	line = strings.TrimSpace(line)
	if line == "" {
		return ""
	}
	u, err := url.Parse(line)
	if err != nil || u.Scheme != "http" && u.Scheme != "https" || u.Host == "" {
		return ""
	}
	if pc := u.Query().Get("pickcode"); pc != "" && validPickcode(pc) {
		return pc
	}
	segs := strings.Split(u.Path, "/")
	for i := 1; i < len(segs); i++ {
		if segs[i-1] != "d" || segs[i] == "" {
			continue
		}
		// OpenList/alist 风格 /d/115/网盘路径 → 紧跟 "d" 的可能是驱动名,不是 pickcode
		if isDriverName(segs[i]) {
			return ""
		}
		id := segs[i]
		if j := strings.LastIndex(id, "~"); j >= 0 {
			id = id[j+1:]
		}
		if k := strings.LastIndexByte(id, '.'); k > 0 {
			id = id[:k]
		}
		if validPickcode(id) {
			return id
		}
		return ""
	}
	return ""
}

// isDriverName 识别 OpenList/alist 挂载路径里的驱动名段。
func isDriverName(seg string) bool {
	switch strings.ToLower(seg) {
	case "115", "123", "quark", "uc", "webdav", "alist", "openlist", "local", "pikpak", "alias":
		return true
	}
	return false
}

// validPickcode 是宽松校验:非空、无空白、无 URL 结构字符。
func validPickcode(s string) bool {
	if s == "" || len(s) > 64 {
		return false
	}
	for _, r := range s {
		if r <= ' ' || strings.ContainsRune("/?#&=%", r) {
			return false
		}
	}
	return true
}

// MatchForeign 把待接管文件与台账对号(纯函数)。
func MatchForeign(foreign []Foreign, ledger []store.SyncedFile, libRoots map[int64]string) Plan {
	var plan Plan
	plan.Scanned = len(foreign)

	// pickcode → 台账行
	byPick := map[string]store.SyncedFile{}
	for _, f := range ledger {
		if f.Pickcode != "" {
			byPick[f.Pickcode] = f
		}
	}
	// libID|relPath → 台账行
	byRel := map[string]store.SyncedFile{}
	for _, f := range ledger {
		byRel[keyOf(f.LibraryID, f.RelPath)] = f
	}

	for _, fo := range foreign {
		raw, err := os.ReadFile(fo.Path)
		if err != nil {
			plan.Missing = append(plan.Missing, fo)
			continue
		}
		line := string(raw)
		if i := strings.IndexByte(line, '\n'); i >= 0 {
			line = line[:i]
		}
		// 本站格式(/d/{pickcode} 或 /d/{pickcode}?/{name})且台账命中 → 已是本站,跳过
		if ownPick := ownFormatPickcode(strings.TrimSpace(line)); ownPick != "" {
			if _, ok := byPick[ownPick]; ok {
				plan.Skipped++
				continue
			}
			plan.Missing = append(plan.Missing, fo)
			continue
		}
		if pc := ParsePickcode(string(raw)); pc != "" {
			if f, ok := byPick[pc]; ok {
				kind := "same_path"
				if !sameRel(libRoots, fo, f) {
					kind = "renamed"
				}
				plan.Adoptable = append(plan.Adoptable, AdoptItem{Foreign: fo, File: f, Kind: kind})
				continue
			}
			plan.Missing = append(plan.Missing, fo)
			continue
		}
		// 无 pickcode:按相对路径对
		if f, ok := byRel[keyOf(fo.LibraryID, fo.Rel)]; ok {
			plan.Adoptable = append(plan.Adoptable, AdoptItem{Foreign: fo, File: f, Kind: "by_path"})
			continue
		}
		plan.Missing = append(plan.Missing, fo)
	}
	return plan
}

// ownFormatPickcode 识别本站两种 STRM 形态:
//   {base}/d/{pickcode}            (pick_code)
//   {base}/d/{pickcode}?/{name}    (pick_code_name)
// 带扩展名(/d/abc.mp4)或更深路径的不算——那是别家工具的写法。
func ownFormatPickcode(line string) string {
	u, err := url.Parse(line)
	if err != nil || u.Host == "" || !strings.HasPrefix(u.Path, "/d/") {
		return ""
	}
	rest := strings.TrimPrefix(u.Path, "/d/")
	if rest == "" || strings.Contains(rest, "/") {
		return ""
	}
	if k := strings.LastIndexByte(rest, '.'); k > 0 {
		return "" // 带扩展名是别家写法
	}
	if validPickcode(rest) {
		return rest
	}
	return ""
}

func keyOf(libID int64, rel string) string {
	return strings.ToLower(strings.Trim(filepath.ToSlash(rel), "/")) + "@" + itoa(libID)
}

func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

func sameRel(libRoots map[int64]string, fo Foreign, f store.SyncedFile) bool {
	return strings.EqualFold(filepath.ToSlash(f.RelPath), strings.Trim(fo.Rel, "/"))
}

// Apply 执行接管:重写内容为本站直链、还原 mtime、更新台账行指向。
// base 是播放地址(public_base)。返回成功数。
func Apply(base string, items []AdoptItem, st *store.Store) (int, error) {
	if strings.TrimSpace(base) == "" {
		return 0, os.ErrInvalid
	}
	n := 0
	for _, it := range items {
		u := pan115.STRM(base, "pick_code", it.File.Pickcode, it.File.Name)
		info, err := os.Stat(it.Foreign.Path)
		if err != nil {
			continue
		}
		tmp, err := os.CreateTemp(filepath.Dir(it.Foreign.Path), ".adopt-*.part")
		if err != nil {
			continue
		}
		tmpName := tmp.Name()
		if _, err := tmp.WriteString(u + "\n"); err != nil {
			tmp.Close()
			os.Remove(tmpName)
			continue
		}
		if err := tmp.Close(); err != nil {
			os.Remove(tmpName)
			continue
		}
		if err := os.Rename(tmpName, it.Foreign.Path); err != nil {
			os.Remove(tmpName)
			continue
		}
		_ = os.Chtimes(it.Foreign.Path, info.ModTime(), info.ModTime())
		// 台账行指向接管后的位置(路径不同的把行搬过去)
		f := it.File
		f.STRMPath = it.Foreign.Path
		f.RelPath = strings.Trim(it.Foreign.Rel, "/")
		f.Status = "ok"
		_ = st.UpsertFile(&f)
		n++
	}
	return n, nil
}
