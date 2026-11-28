package incr

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"streampulse/internal/pan115"
	"streampulse/internal/scan"
	"streampulse/internal/store"
)

func setupIncr(t *testing.T) (*store.Store, *store.Library, int64, string) {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	accID, err := st.SaveAccount(&store.Account{Name: "main", Role: "main", AuthType: "cookie", Cookie: "UID=1"})
	if err != nil {
		t.Fatal(err)
	}
	local := t.TempDir()
	libID, _ := st.SaveLibrary(&store.Library{
		Name: "movies", AccountID: accID, RemoteCID: "0", LocalDir: local,
		BaseURL: "http://h:2048", VideoExts: ".mkv", Enabled: true,
	})
	_ = st.UpsertDir(libID, "c1", "0", "Movies", "Movies")
	_ = st.SetSetting(cursorKey(accID), "100")
	return st, &store.Library{ID: libID, Name: "movies", AccountID: accID, RemoteCID: "0", LocalDir: local, BaseURL: "http://h:2048", VideoExts: ".mkv"}, accID, local
}

func TestPollOnceDirectPush(t *testing.T) {
	st, _, accID, local := setupIncr(t)
	src := &fakeSource{events: []pan115.LifeEvent{
		{ID: "200", FileID: "f1", CID: "c1", FileName: "new.mkv", Pickcode: "pc9", Type: "file_upload", Size: 5},
	}}
	svc := &Service{Store: st, Src: src, Log: slog.Default()}

	r, err := svc.PollOnce(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if r.Direct != 1 || r.ScannedDirs != 0 || len(src.scanned) != 0 {
		t.Fatalf("direct push result = %+v scanned=%v", r, src.scanned)
	}
	b, err := os.ReadFile(filepath.Join(local, "Movies", "new.strm"))
	if err != nil {
		t.Fatalf("strm missing: %v", err)
	}
	if got := string(b); got != "http://h:2048/d/pc9\n" {
		t.Fatalf("strm content = %q", got)
	}
	files, _ := st.ListFiles(1)
	if len(files) != 1 || files[0].FID != "f1" || files[0].RelPath != "Movies/new.mkv" {
		t.Fatalf("files = %+v", files)
	}
	if got := st.GetSetting(cursorKey(accID), ""); got != "200" {
		t.Fatalf("cursor = %q", got)
	}
	// 事件已标 done
	n, _ := st.CountPendingEvents(accID)
	if n != 0 {
		t.Fatalf("pending = %d", n)
	}
}

func TestPollOnceSuppressed(t *testing.T) {
	st, _, accID, _ := setupIncr(t)
	if err := st.MarkSuppressed([]string{"f1"}, "delete", 3600e9); err != nil {
		t.Fatal(err)
	}
	src := &fakeSource{events: []pan115.LifeEvent{
		{ID: "200", FileID: "f1", CID: "c1", FileName: "x.mkv", Pickcode: "pc", Type: "file_upload"},
	}}
	svc := &Service{Store: st, Src: src, Log: slog.Default()}
	r, err := svc.PollOnce(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if r.Direct != 0 || r.ScannedDirs != 0 || len(src.scanned) != 0 {
		t.Fatalf("suppressed result = %+v", r)
	}
	if got := st.GetSetting(cursorKey(accID), ""); got != "200" {
		t.Fatalf("cursor = %q", got)
	}
}

type busySource struct {
	fakeSource
	busy bool
}

func (f *busySource) ScanDir(_ context.Context, _ *store.Library, _ string) (scan.Result, error) {
	if f.busy {
		return scan.Result{}, ErrBusy
	}
	return scan.Result{}, nil
}

func TestPollOnceBusyKeepsCursor(t *testing.T) {
	st, _, accID, _ := setupIncr(t)
	src := &busySource{fakeSource{events: []pan115.LifeEvent{
		{ID: "200", FileID: "f1", CID: "c1", FileName: "x.mkv"},
	}}, true}
	svc := &Service{Store: st, Src: src, Log: slog.Default()}
	r, err := svc.PollOnce(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !r.Busy {
		t.Fatalf("busy not reported: %+v", r)
	}
	if got := st.GetSetting(cursorKey(accID), ""); got != "100" {
		t.Fatalf("cursor should not advance, = %q", got)
	}
	n, _ := st.CountPendingEvents(accID)
	if n != 1 {
		t.Fatalf("pending should be 1, = %d", n)
	}
	// 解除占用后下一轮正常消费
	src.busy = false
	r, err = svc.PollOnce(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if r.ScannedDirs != 1 || r.Busy {
		t.Fatalf("retry = %+v", r)
	}
	if got := st.GetSetting(cursorKey(accID), ""); got != "200" {
		t.Fatalf("cursor = %q", got)
	}
}

func TestPollOnceGoneDirIsPermanent(t *testing.T) {
	st, _, accID, _ := setupIncr(t)
	src := &goneSource{fakeSource{events: []pan115.LifeEvent{
		{ID: "200", FileID: "f1", CID: "c1", FileName: "x.mkv"},
	}}}
	svc := &Service{Store: st, Src: src, Log: slog.Default()}
	r, err := svc.PollOnce(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if r.Errors != 0 || r.ScannedDirs != 0 {
		t.Fatalf("gone result = %+v", r)
	}
	// 目录已删:事件标 done,游标推进
	n, _ := st.CountPendingEvents(accID)
	if n != 0 {
		t.Fatalf("pending = %d", n)
	}
	if got := st.GetSetting(cursorKey(accID), ""); got != "200" {
		t.Fatalf("cursor = %q", got)
	}
}

type goneSource struct {
	fakeSource
}

func (f *goneSource) ScanDir(_ context.Context, _ *store.Library, _ string) (scan.Result, error) {
	return scan.Result{}, errors.New("115 列目录失败: 目录不存在")
}

func TestAdvanceCursorPastPending(t *testing.T) {
	st, _, accID, _ := setupIncr(t)
	_, _, _ = st.AddEventPending(accID, "150", "1", "", "")
	_, _, _ = st.AddEventPending(accID, "250", "1", "", "")
	svc := &Service{Store: st, Src: &fakeSource{}, Log: slog.Default()}
	svc.AdvanceCursorPastPending()
	if got := st.GetSetting(cursorKey(accID), ""); got != "250" {
		t.Fatalf("cursor = %q", got)
	}
	n, _ := st.CountPendingEvents(accID)
	if n != 0 {
		t.Fatalf("pending = %d", n)
	}
}

func TestRoundHistory(t *testing.T) {
	st, _, _, _ := setupIncr(t)
	src := &busySource{fakeSource{events: []pan115.LifeEvent{
		{ID: "200", FileID: "f1", CID: "c1", FileName: "x.mkv"},
	}}, true}
	svc := &Service{Store: st, Src: src, Log: slog.Default()}
	_, _ = svc.PollOnce(context.Background())
	rounds := svc.Rounds()
	if len(rounds) != 1 || rounds[0].Busy != true {
		t.Fatalf("rounds = %+v", rounds)
	}
	if svc.Status().IdleRounds != 0 {
		t.Fatal("busy round should reset idle")
	}
	// 空转:无事件 → 只计数
	src.events = nil
	_, _ = svc.PollOnce(context.Background())
	if svc.Status().IdleRounds != 1 {
		t.Fatalf("idle = %d", svc.Status().IdleRounds)
	}
	if len(svc.Rounds()) != 1 {
		t.Fatal("idle round should not be recorded")
	}
}
