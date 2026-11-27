package deepdel

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"streampulse/internal/store"
)

type fakeRemote struct {
	fids []string
	err  error
}

func (f *fakeRemote) DeleteFiles(_ context.Context, _ int64, fids []string) error {
	f.fids = append(f.fids, fids...)
	return f.err
}

func setup(t *testing.T) (*store.Store, *store.Library, string, string) {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	root := t.TempDir()
	accID, _ := st.SaveAccount(&store.Account{Name: "main", Role: "main", AuthType: "cookie", Cookie: "UID=1"})
	libID, _ := st.SaveLibrary(&store.Library{
		Name: "movies", AccountID: accID, RemoteCID: "0", LocalDir: root,
		BaseURL: "http://h:2048", VideoExts: ".mkv", Enabled: true,
	})
	lib, _ := st.GetLibrary(libID)

	strm := filepath.Join(root, "Movies", "Season 01", "a.strm")
	if err := os.MkdirAll(filepath.Dir(strm), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(strm, []byte("http://h:2048/d/pc1\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	sidecar := filepath.Join(filepath.Dir(strm), "a.nfo")
	if err := os.WriteFile(sidecar, []byte("<movie/>"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := st.UpsertFile(&store.SyncedFile{
		LibraryID: lib.ID, FID: "f1", Pickcode: "pc1", CID: "c1",
		Name: "a.mkv", RelPath: "Movies/Season 01/a.mkv", STRMPath: strm, Status: "ok",
	}); err != nil {
		t.Fatal(err)
	}
	return st, lib, root, strm
}

func TestRejectsUnsafeRequests(t *testing.T) {
	st, _, root, strm := setup(t)
	svc := &Service{Store: st, Log: slog.Default(), Svc: &fakeRemote{}}

	cases := []Item{
		{Type: "Folder", Path: strm},
		{Type: "Movie", Path: filepath.Join(root, "..", "outside.strm")},
		{Type: "Movie", Path: root},
		{Type: "Movie", Path: filepath.Join(root, "Movies", "Season 01", "missing.strm")},
	}
	for _, c := range cases {
		res, err := svc.Handle(context.Background(), c)
		if err != nil {
			t.Fatal(err)
		}
		if res.Rejected == "" || res.DeletedLocal != 0 {
			t.Fatalf("case %+v not rejected: %+v", c, res)
		}
	}
	if _, err := os.Stat(strm); err != nil {
		t.Fatal("file should be untouched")
	}
}

func TestDeletesFileAndSidecar(t *testing.T) {
	st, _, root, strm := setup(t)
	remote := &fakeRemote{}
	_ = st.SetSetting("emby_delete_remote", "1")
	svc := &Service{Store: st, Log: slog.Default(), Svc: remote}

	res, err := svc.Handle(context.Background(), Item{Type: "Movie", Name: "a", Path: strm})
	if err != nil {
		t.Fatal(err)
	}
	if res.Rejected != "" || res.Matched != 1 || res.DeletedLocal != 1 || res.DeletedRemote != 1 {
		t.Fatalf("result = %+v", res)
	}
	if _, err := os.Stat(strm); !os.IsNotExist(err) {
		t.Fatal("strm should be removed")
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(strm), "a.nfo")); !os.IsNotExist(err) {
		t.Fatal("sidecar should be removed")
	}
	if _, err := os.Stat(filepath.Dir(strm)); !os.IsNotExist(err) {
		t.Fatal("empty season dir should be pruned")
	}
	if _, err := os.Stat(filepath.Join(root, "Movies")); !os.IsNotExist(err) {
		t.Fatal("empty movie dir should be pruned")
	}
	if _, err := os.Stat(root); err != nil {
		t.Fatal("library root must be kept")
	}
	if len(remote.fids) != 1 || remote.fids[0] != "f1" {
		t.Fatalf("remote fids = %v", remote.fids)
	}
	files, _ := st.ListFiles(0)
	_ = files
	if fs, _ := st.ListFiles(1); len(fs) != 0 {
		t.Fatalf("ledger should be empty: %+v", fs)
	}
}

func TestDeletesDirectoryTree(t *testing.T) {
	st, _, root, _ := setup(t)
	// 增加第二集
	second := filepath.Join(root, "Movies", "Season 01", "b.strm")
	if err := os.WriteFile(second, []byte("http://h:2048/d/pc2\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	_ = st.UpsertFile(&store.SyncedFile{
		LibraryID: 1, FID: "f2", Pickcode: "pc2", CID: "c1",
		Name: "b.mkv", RelPath: "Movies/Season 01/b.mkv", STRMPath: second, Status: "ok",
	})

	svc := &Service{Store: st, Log: slog.Default(), Svc: &fakeRemote{}}
	res, err := svc.Handle(context.Background(), Item{Type: "Season", Name: "Season 01", Path: filepath.Join(root, "Movies", "Season 01")})
	if err != nil {
		t.Fatal(err)
	}
	if res.Rejected != "" || res.Matched != 2 || res.DeletedLocal != 2 {
		t.Fatalf("result = %+v", res)
	}
	if _, err := os.Stat(filepath.Join(root, "Movies")); !os.IsNotExist(err) {
		t.Fatal("empty tree should be pruned")
	}
}

func TestRemoteDeleteDisabledByDefault(t *testing.T) {
	st, _, _, strm := setup(t)
	remote := &fakeRemote{}
	svc := &Service{Store: st, Log: slog.Default(), Svc: remote}

	res, err := svc.Handle(context.Background(), Item{Type: "Movie", Path: strm})
	if err != nil {
		t.Fatal(err)
	}
	if res.DeletedRemote != 0 || len(remote.fids) != 0 {
		t.Fatalf("remote should not be called: %+v %v", res, remote.fids)
	}
}
