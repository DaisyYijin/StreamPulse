package strm

import (
	"os"
	"path/filepath"
	"strings"
)

// Rebase 批量替换 STRM 里的播放地址前缀(直连域名填错/换 IP 后的自救通道)。
//
// 纪律:
//   - 扫 root 下所有 .strm(不按台账,别家项目写的也能换);
//   - 只换内容第一条有效行的开头;旧地址后面必须紧跟 / ? # 或行尾才算命中
//     (不做整条子串替换,避免误伤相近域名);
//   - 写回保留原修改时间(Emby 按时间排序不被打乱);
//   - 零网络请求、不通知 Emby(Emby 现读 STRM 内容)。
//
// from/to 校验:都是 http(s):// 开头且不同。
func Rebase(root, from, to string) (changed int, scanned int, err error) {
	from = strings.TrimRight(strings.TrimSpace(from), "/")
	to = strings.TrimRight(strings.TrimSpace(to), "/")
	if !validBase(from) || !validBase(to) {
		return 0, 0, os.ErrInvalid
	}
	if from == to {
		return 0, 0, os.ErrInvalid
	}
	e := filepath.Walk(root, func(p string, info os.FileInfo, werr error) error {
		if werr != nil || info == nil || info.IsDir() {
			return nil
		}
		if !strings.EqualFold(filepath.Ext(p), ".strm") {
			return nil
		}
		scanned++
		ok, rerr := rebaseFile(p, from, to)
		if rerr != nil {
			return nil // 单个文件失败不中断整体
		}
		if ok {
			changed++
		}
		return nil
	})
	return changed, scanned, e
}

func validBase(s string) bool {
	if len(s) < 8 {
		return false
	}
	if !strings.HasPrefix(s, "http://") && !strings.HasPrefix(s, "https://") {
		return false
	}
	// 至少要有主机名部分
	rest := strings.TrimPrefix(strings.TrimPrefix(s, "https://"), "http://")
	return rest != "" && !strings.HasPrefix(rest, "/")
}

// rebaseLine 判断 content 首行是否以 from 开头且边界正确,返回替换后的整行。
func rebaseLine(line, from, to string) (string, bool) {
	if !strings.HasPrefix(line, from) {
		return line, false
	}
	rest := line[len(from):]
	// 旧地址后面必须是路径/参数/锚点或行尾,防 "http://a.com" 匹配 "http://a.com.evil.com"
	if rest != "" && rest[0] != '/' && rest[0] != '?' && rest[0] != '#' {
		return line, false
	}
	return to + rest, true
}

func rebaseFile(path, from, to string) (bool, error) {
	info, err := os.Stat(path)
	if err != nil {
		return false, err
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return false, err
	}
	s := string(raw)
	first := s
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		first = s[:i]
	}
	line := strings.TrimSpace(first)
	if line == "" {
		return false, nil
	}
	newLine, ok := rebaseLine(line, from, to)
	if !ok {
		return false, nil
	}
	// 保持原文件的换行结构
	var out string
	if strings.Contains(s, "\n") {
		out = newLine + s[len(first):]
	} else {
		out = newLine
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".rebase-*.part")
	if err != nil {
		return false, err
	}
	tmpName := tmp.Name()
	if _, err := tmp.WriteString(out); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return false, err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpName)
		return false, err
	}
	if err := os.Rename(tmpName, path); err != nil {
		os.Remove(tmpName)
		return false, err
	}
	_ = os.Chtimes(path, info.ModTime(), info.ModTime())
	return true, nil
}
