package incr

import (
	"context"
	"log/slog"
	"testing"

	"streampulse/internal/pan115"
	"streampulse/internal/scan"
	"streampulse/internal/store"
)

type fakeSource struct {
	events  []pan115.LifeEvent
	scanned []string
}

func (f *fakeSource) ListBehavior(_ context.Context, _ int64, _ int) ([]pan115.LifeEvent, error) {
	return f.events, nil
}

func (f *fakeSource) ScanDir(_ context.Context, lib *store.Library, cid string) (scan.Result, error) {
	f.scanned = append(f.scanned, cid)
	return scan.Result{Scanned: 1}, nil
}

func TestPollOnceBaselineThenDelta(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	accID, err := st.SaveAccount(&store.Account{Name: "main", Role: "main", AuthType: "cookie", Cookie: "UID=1"})
	if err != nil {
		t.Fatal(err)
	}
	libID, _ := st.SaveLibrary(&store.Library{
		Name: "movies", AccountID: accID, RemoteCID: "0", LocalDir: t.TempDir(),
		BaseURL: "http://h:6086", VideoExts: ".mkv", Enabled: true,
	})
	_ = st.UpsertDir(libID, "c1", "0", "Movies", "Movies")

	src := &fakeSource{events: []pan115.LifeEvent{
		{ID: "300", FileID: "f1", CID: "c1", FileName: "a.mkv"},
		{ID: "200", FileID: "f0", CID: "c1", FileName: "old.mkv"},
	}}
	svc := &Service{Store: st, Src: src, Log: slog.Default()}

	r, err := svc.PollOnce(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !r.Baseline || len(src.scanned) != 0 {
		t.Fatalf("baseline = %+v scanned=%v", r, src.scanned)
	}
	if got := st.GetSetting(cursorKey(accID), ""); got != "300" {
		t.Fatalf("cursor = %q", got)
	}

	// 新事件 400，触发 c1 目录扫描
	src.events = []pan115.LifeEvent{
		{ID: "400", FileID: "f2", CID: "c1", FileName: "b.mkv"},
		{ID: "300", FileID: "f1", CID: "c1", FileName: "a.mkv"},
	}
	r, err = svc.PollOnce(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if r.NewEvents != 1 || r.ScannedDirs != 1 {
		t.Fatalf("delta = %+v", r)
	}
	if len(src.scanned) != 1 || src.scanned[0] != "c1" {
		t.Fatalf("scanned = %v", src.scanned)
	}
	if got := st.GetSetting(cursorKey(accID), ""); got != "400" {
		t.Fatalf("cursor = %q", got)
	}

	// 同一事件重复出现：游标已到 400，不应再处理
	r, err = svc.PollOnce(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if r.NewEvents != 0 || r.ScannedDirs != 0 {
		t.Fatalf("repeat = %+v", r)
	}
}

func TestPollOnceUnknownCIDIgnored(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	accID, _ := st.SaveAccount(&store.Account{Name: "main", Role: "main", AuthType: "cookie", Cookie: "x"})
	_, _ = st.SaveLibrary(&store.Library{Name: "m", AccountID: accID, RemoteCID: "0", LocalDir: t.TempDir(), VideoExts: ".mkv", Enabled: true})
	_ = st.SetSetting(cursorKey(accID), "100")

	src := &fakeSource{events: []pan115.LifeEvent{{ID: "200", FileID: "f", CID: "unknown"}}}
	svc := &Service{Store: st, Src: src, Log: slog.Default()}
	r, err := svc.PollOnce(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if r.NewEvents != 1 || r.ScannedDirs != 0 || len(src.scanned) != 0 {
		t.Fatalf("result = %+v scanned=%v", r, src.scanned)
	}
	if got := st.GetSetting(cursorKey(accID), ""); got != "200" {
		t.Fatalf("cursor = %q", got)
	}
}
