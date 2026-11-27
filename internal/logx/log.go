package logx

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
)

// rotatingWriter 按大小切分日志文件，保留固定份数。
type rotatingWriter struct {
	mu      sync.Mutex
	dir     string
	name    string
	size    int64
	maxSize int64
	keep    int
	file    *os.File
}

func newRotatingWriter(dir, name string, maxSize int64, keep int) (*rotatingWriter, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	w := &rotatingWriter{dir: dir, name: name, maxSize: maxSize, keep: keep}
	if err := w.open(); err != nil {
		return nil, err
	}
	return w, nil
}

func (w *rotatingWriter) open() error {
	p := filepath.Join(w.dir, w.name)
	f, err := os.OpenFile(p, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	st, _ := f.Stat()
	w.file = f
	if st != nil {
		w.size = st.Size()
	}
	return nil
}

func (w *rotatingWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.size+int64(len(p)) > w.maxSize {
		w.rotate()
	}
	n, err := w.file.Write(p)
	w.size += int64(n)
	return n, err
}

func (w *rotatingWriter) rotate() {
	w.file.Close()
	_ = os.Remove(filepath.Join(w.dir, w.name+"."+itoa(w.keep-1)))
	for i := w.keep - 2; i >= 1; i-- {
		_ = os.Rename(filepath.Join(w.dir, w.name+"."+itoa(i)), filepath.Join(w.dir, w.name+"."+itoa(i+1)))
	}
	_ = os.Rename(filepath.Join(w.dir, w.name), filepath.Join(w.dir, w.name+".1"))
	w.size = 0
	_ = w.open()
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [8]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

// Init 初始化 slog：stdout + 文件。返回关闭函数。
func Init(dir string) (func() error, error) {
	w, err := newRotatingWriter(dir, "app.log", 10<<20, 3)
	if err != nil {
		return func() error { return nil }, err
	}
	h := slog.NewTextHandler(io.MultiWriter(os.Stdout, w), &slog.HandlerOptions{Level: slog.LevelInfo})
	slog.SetDefault(slog.New(h))
	return func() error { return w.file.Close() }, nil
}
