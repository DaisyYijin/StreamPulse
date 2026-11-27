package logx

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestDailyWriterSplitsBySize(t *testing.T) {
	dir := t.TempDir()
	w, err := newDailyWriter(dir, "app", 100, 3)
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()

	for i := 0; i < 3; i++ {
		if _, err := w.Write(make([]byte, 60)); err != nil {
			t.Fatal(err)
		}
	}
	day := time.Now().Format("2006-01-02")
	for _, name := range []string{"app-" + day + ".log", "app-" + day + ".log.1", "app-" + day + ".log.2"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Fatalf("missing %s: %v", name, err)
		}
	}
}

func TestDailyWriterRotatesByDay(t *testing.T) {
	dir := t.TempDir()
	w, err := newDailyWriter(dir, "app", 1<<20, 3)
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()

	day1 := time.Date(2026, 11, 26, 10, 0, 0, 0, time.Local)
	w.now = func() time.Time { return day1 }
	// 构造函数按真实日期打开了文件，测试里切到固定日期需重新打开
	if w.file != nil {
		_ = w.file.Close()
	}
	w.file = nil
	w.day = "2026-11-26"
	w.seq, w.size = 0, 0
	if err := w.open(); err != nil {
		t.Fatal(err)
	}
	if _, err := w.Write([]byte("first\n")); err != nil {
		t.Fatal(err)
	}

	day2 := day1.Add(24 * time.Hour)
	w.now = func() time.Time { return day2 }
	if _, err := w.Write([]byte("second\n")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "app-2026-11-26.log")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "app-2026-11-27.log")); err != nil {
		t.Fatal(err)
	}
}

func TestCleanupOldDays(t *testing.T) {
	dir := t.TempDir()
	old := filepath.Join(dir, "app-2000-01-01.log")
	if err := os.WriteFile(old, []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	legacy := filepath.Join(dir, "app.log")
	if err := os.WriteFile(legacy, []byte("legacy"), 0o600); err != nil {
		t.Fatal(err)
	}
	oldTime := time.Now().AddDate(0, 0, -30)
	_ = os.Chtimes(legacy, oldTime, oldTime)

	w, err := newDailyWriter(dir, "app", 1<<20, 3)
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()

	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Fatal("old dated file should be removed")
	}
	if _, err := os.Stat(legacy); !os.IsNotExist(err) {
		t.Fatal("old legacy file should be removed")
	}
}
