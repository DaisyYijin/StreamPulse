package scan

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"streampulse/internal/pan115"
	"streampulse/internal/store"
)

type fakeSource struct {
	dirs   map[string][]pan115.Entry
	dl     map[string]string
	onList func(cid string)
}

func (f *fakeSource) ListDir(_ context.Context, cid string) ([]pan115.Entry, error) {
	if f.onList != nil {
		f.onList(cid)
	}
	return f.dirs[cid], nil
}

func (f *fakeSource) DownloadURL(_ context.Context, pickcode string) (string, error) {
	return f.dl[pickcode], nil
}

func newLib(t *testing.T, st *store.Store) *store.Library {
	t.Helper()
	dir := t.TempDir()
	id, err := st.SaveLibrary(&store.Library{
		Name: "movies", AccountID: 1, RemoteCID: "0", LocalDir: dir,
		BaseURL: "http://h:2048", STRMFormat: "pick_code", KeepExt: false,
		VideoExts: ".mkv", MetaExts: ".srt", ScanMode: "fast", Enabled: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	lib, err := st.GetLibrary(id)
	if err != nil {
		t.Fatal(err)
	}
	return lib
}

func TestScanWritesSTRMAndSkipsUnchanged(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	lib := newLib(t, st)

	src := &fakeSource{dirs: map[string][]pan115.Entry{
		"0": {
			{CID: "c1", Name: "Movies", IsDir: true},
			{FID: "f0", CID: "0", Name: "root.mkv", Pickcode: "pc0", Size: 100},
		},
		"c1": {
			{FID: "f1", CID: "c1", Name: "a.mkv", Pickcode: "pc1", Size: 100},
			{FID: "f2", CID: "c1", Name: "a.srt", Pickcode: "pcsrt", Size: 10},
		},
	}, dl: map[string]string{}}

	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("subtitle"))
	}))
	defer ts.Close()
	src.dl["pcsrt"] = ts.URL

	res, err := Run(context.Background(), Options{Library: lib, Source: src, Store: st})
	if err != nil {
		t.Fatal(err)
	}
	if res.Written != 2 || res.Scanned != 2 || res.Meta != 1 {
		t.Fatalf("result = %+v", res)
	}
	for _, p := range []string{filepath.Join(lib.LocalDir, "root.strm"), filepath.Join(lib.LocalDir, "Movies", "a.strm")} {
		if _, err := os.Stat(p); err != nil {
			t.Fatalf("missing %s", p)
		}
	}
	b, _ := os.ReadFile(filepath.Join(lib.LocalDir, "Movies", "a.strm"))
	if string(b) != "http://h:2048/d/pc1\n" {
		t.Fatalf("strm content = %q", b)
	}
	if _, err := os.Stat(filepath.Join(lib.LocalDir, "Movies", "a.srt")); err != nil {
		t.Fatalf("meta not downloaded: %v", err)
	}

	// 第二次：内容一致，应跳过
	res2, err := Run(context.Background(), Options{Library: lib, Source: src, Store: st})
	if err != nil {
		t.Fatal(err)
	}
	if res2.Written != 0 || res2.Skipped != 2 {
		t.Fatalf("second = %+v", res2)
	}
}

func TestScanDetectsDirectoryRename(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	lib := newLib(t, st)

	src := &fakeSource{dirs: map[string][]pan115.Entry{
		"0":  {{CID: "c1", Name: "Movies", IsDir: true}},
		"c1": {{FID: "f1", CID: "c1", Name: "a.mkv", Pickcode: "pc1", Size: 100}},
	}}
	if _, err := Run(context.Background(), Options{Library: lib, Source: src, Store: st}); err != nil {
		t.Fatal(err)
	}
	oldPath := filepath.Join(lib.LocalDir, "Movies", "a.strm")
	if _, err := os.Stat(oldPath); err != nil {
		t.Fatal(err)
	}

	// 同一个 cid 改名
	src.dirs["0"] = []pan115.Entry{{CID: "c1", Name: "Films", IsDir: true}}
	res, err := Run(context.Background(), Options{Library: lib, Source: src, Store: st})
	if err != nil {
		t.Fatal(err)
	}
	if res.Renamed != 1 || len(res.Moves) != 1 || res.Moves[0].To != "Films" {
		t.Fatalf("rename result = %+v", res)
	}
	newPath := filepath.Join(lib.LocalDir, "Films", "a.strm")
	if _, err := os.Stat(newPath); err != nil {
		t.Fatalf("new path missing: %v", err)
	}
	if _, err := os.Stat(oldPath); !os.IsNotExist(err) {
		t.Fatalf("old path still exists")
	}
}

func TestScanMarksOrphan(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	lib := newLib(t, st)

	src := &fakeSource{dirs: map[string][]pan115.Entry{
		"0": {{FID: "f1", CID: "0", Name: "a.mkv", Pickcode: "pc1", Size: 100}},
	}}
	if _, err := Run(context.Background(), Options{Library: lib, Source: src, Store: st}); err != nil {
		t.Fatal(err)
	}

	src.dirs["0"] = nil
	res, err := Run(context.Background(), Options{Library: lib, Source: src, Store: st})
	if err != nil {
		t.Fatal(err)
	}
	if res.Orphans != 1 {
		t.Fatalf("orphans = %d", res.Orphans)
	}
	files, _ := st.ListFiles(lib.ID)
	if len(files) != 1 || files[0].Status != "orphan" {
		t.Fatalf("files = %+v", files)
	}
	// 只标记不删
	if _, err := os.Stat(filepath.Join(lib.LocalDir, "a.strm")); err != nil {
		t.Fatalf("orphan should not delete file: %v", err)
	}
}

func TestScanOneDir(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	lib := newLib(t, st)
	_ = st.UpsertDir(lib.ID, "c1", "", "Movies", "Movies")

	src := &fakeSource{dirs: map[string][]pan115.Entry{
		"c1": {{FID: "f1", CID: "c1", Name: "b.mkv", Pickcode: "pc9", Size: 1}},
	}}
	res, err := ScanOneDir(context.Background(), Options{Library: lib, Source: src, Store: st}, "c1")
	if err != nil {
		t.Fatal(err)
	}
	if res.Written != 1 {
		t.Fatalf("result = %+v", res)
	}
	if _, err := os.Stat(filepath.Join(lib.LocalDir, "Movies", "b.strm")); err != nil {
		t.Fatal(err)
	}
}

func TestScanRejectsEmptyBaseURL(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	lib := newLib(t, st)
	lib.BaseURL = ""
	if _, err := Run(context.Background(), Options{Library: lib, Source: &fakeSource{}, Store: st}); err == nil {
		t.Fatal("expected error for empty base url")
	}
}
