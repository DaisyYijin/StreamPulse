package scan

import (
	"os"
	"path/filepath"
	"strings"

	"streampulse/internal/store"
)

// CleanOrphans 删除孤儿 STRM 文件并回收空目录(预览确认后调用)。
// root 是媒体库本地目录,回收沿文件父目录链向上、不删库根。
func CleanOrphans(root string, files []store.SyncedFile) (removed int, dirs int) {
	dirsTouched := map[string]bool{}
	for _, f := range files {
		if err := os.Remove(f.STRMPath); err == nil || os.IsNotExist(err) {
			removed++
		}
		d := filepath.Dir(f.STRMPath)
		for withinRoot(root, d) && !isRootDir(root, d) {
			dirsTouched[d] = true
			d = filepath.Dir(d)
		}
	}
	list := make([]string, 0, len(dirsTouched))
	for d := range dirsTouched {
		list = append(list, d)
	}
	// 深的先删
	for i := 1; i < len(list); i++ {
		for j := i; j > 0 && strings.Count(list[j], string(filepath.Separator)) > strings.Count(list[j-1], string(filepath.Separator)); j-- {
			list[j], list[j-1] = list[j-1], list[j]
		}
	}
	for _, d := range list {
		if err := os.Remove(d); err == nil {
			dirs++
		}
	}
	return removed, dirs
}

func withinRoot(root, p string) bool {
	rel, err := filepath.Rel(filepath.Clean(root), filepath.Clean(p))
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func isRootDir(root, p string) bool {
	return filepath.Clean(root) == filepath.Clean(p)
}
