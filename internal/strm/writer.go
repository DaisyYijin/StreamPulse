package strm

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

// WriteAtomic 原子写：同目录临时文件 + rename。避免 Emby 读到半个文件。
func WriteAtomic(path, content string) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".strm-*.part")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if _, err := tmp.WriteString(content); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmpName, 0o644); err != nil {
		return err
	}
	return os.Rename(tmpName, path)
}

// ReadFirstLine 读取 STRM 内容（用于增量比对）。
func ReadFirstLine(path string) (string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	s := string(b)
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		s = s[:i]
	}
	return strings.TrimSpace(s), nil
}

// SafeName 清理文件名里的路径分隔符与非法字符，保留中文。
func SafeName(name string) string {
	name = strings.TrimSpace(name)
	name = strings.ReplaceAll(name, "/", "_")
	name = strings.ReplaceAll(name, "\\", "_")
	name = strings.ReplaceAll(name, "\x00", "")
	if name == "" || name == "." || name == ".." {
		return "unnamed"
	}
	// 单个路径分量限制 255 字节
	if len(name) > 255 {
		ext := filepath.Ext(name)
		base := name[:len(name)-len(ext)]
		for len(base)+len(ext) > 255 {
			_, size := utf8.DecodeLastRuneInString(base)
			base = base[:len(base)-size]
		}
		name = base + ext
	}
	return name
}

// STRNPath 由远端文件名推本地 .strm 路径。
// 规则：视频名去扩展名 + .strm；同名冲突时退回 name.ext.strm。
func STRNPath(localDir, relDir, videoName string, keepExt bool) string {
	base := strings.TrimSuffix(videoName, filepath.Ext(videoName))
	if keepExt {
		base = videoName
	}
	return filepath.Join(localDir, relDir, SafeName(base)+".strm")
}

// Write 写入 STRM，返回是否内容发生变化。
func Write(path, content string) (bool, error) {
	if old, err := ReadFirstLine(path); err == nil {
		if old == content {
			return false, nil
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return false, err
	}
	return true, WriteAtomic(path, content+"\n")
}
