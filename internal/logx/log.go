package logx

import (
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// dailyWriter 按天 + 单文件大小切分：
//
//	app-2026-11-27.log
//	app-2026-11-27.log.1   （当天超过 maxSize 后）
//	app-2026-11-27.log.2
//
// 保留最近 keepDays 天，过期文件在启动与跨天时清理。
type dailyWriter struct {
	mu       sync.Mutex
	dir      string
	base     string
	maxSize  int64
	keepDays int

	day  string
	seq  int
	size int64
	file *os.File

	now func() time.Time
}

var fileRe = regexp.MustCompile(`^(.*)-(\d{4}-\d{2}-\d{2})\.log(?:\.(\d+))?$`)

func newDailyWriter(dir, base string, maxSize int64, keepDays int) (*dailyWriter, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	w := &dailyWriter{
		dir: dir, base: base, maxSize: maxSize, keepDays: keepDays,
		now: time.Now,
	}
	w.day = w.now().Format("2006-01-02")
	if err := w.open(); err != nil {
		return nil, err
	}
	w.cleanup()
	return w, nil
}

func (w *dailyWriter) path() string {
	name := fmt.Sprintf("%s-%s.log", w.base, w.day)
	if w.seq > 0 {
		name += "." + strconv.Itoa(w.seq)
	}
	return filepath.Join(w.dir, name)
}

func (w *dailyWriter) open() error {
	for i := 0; i < 1000; i++ {
		f, err := os.OpenFile(w.path(), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
		if err != nil {
			return err
		}
		st, _ := f.Stat()
		var size int64
		if st != nil {
			size = st.Size()
		}
		if w.maxSize > 0 && size >= w.maxSize {
			f.Close()
			w.seq++
			continue
		}
		w.file = f
		w.size = size
		return nil
	}
	return fmt.Errorf("日志切分失败：%s 的序号超过上限", w.base)
}

func (w *dailyWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	day := w.now().Format("2006-01-02")
	if w.file == nil || day != w.day || (w.maxSize > 0 && w.size+int64(len(p)) > w.maxSize) {
		if err := w.rotate(day); err != nil {
			return 0, err
		}
	}
	n, err := w.file.Write(p)
	w.size += int64(n)
	return n, err
}

func (w *dailyWriter) rotate(day string) error {
	if w.file != nil {
		_ = w.file.Close()
		w.file = nil
	}
	if day != w.day {
		w.day = day
		w.seq = 0
		w.cleanupLocked()
	} else {
		w.seq++
	}
	return w.open()
}

func (w *dailyWriter) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.file == nil {
		return nil
	}
	err := w.file.Close()
	w.file = nil
	return err
}

func (w *dailyWriter) cleanup() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.cleanupLocked()
}

func (w *dailyWriter) cleanupLocked() {
	if w.keepDays <= 0 {
		return
	}
	cutoff := w.now().AddDate(0, 0, -(w.keepDays - 1)).Format("2006-01-02")
	entries, err := os.ReadDir(w.dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if m := fileRe.FindStringSubmatch(name); m != nil && m[1] == w.base {
			if m[2] < cutoff {
				_ = os.Remove(filepath.Join(w.dir, name))
			}
			continue
		}
		// 兼容旧版 app.log / app.log.1：按 mtime 清理
		if name == w.base+".log" || strings.HasPrefix(name, w.base+".log.") {
			if info, err := e.Info(); err == nil && info.ModTime().Format("2006-01-02") < cutoff {
				_ = os.Remove(filepath.Join(w.dir, name))
			}
		}
	}
}

// Init 初始化 slog：stdout + 按天/按大小滚动的文件。返回关闭函数。
func Init(dir string, maxMB, keepDays int) (func() error, error) {
	if maxMB <= 0 {
		maxMB = 50
	}
	if keepDays <= 0 {
		keepDays = 14
	}
	w, err := newDailyWriter(dir, "app", int64(maxMB)<<20, keepDays)
	if err != nil {
		return func() error { return nil }, err
	}
	h := slog.NewTextHandler(io.MultiWriter(os.Stdout, w), &slog.HandlerOptions{Level: slog.LevelInfo})
	slog.SetDefault(slog.New(h))
	return w.Close, nil
}
