package store

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestStoreBasics(t *testing.T) {
	st, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	if got := st.GetSetting("missing", "def"); got != "def" {
		t.Fatalf("default setting = %q", got)
	}
	if err := st.SetSetting("k", "v"); err != nil {
		t.Fatal(err)
	}
	if got := st.GetSetting("k", ""); got != "v" {
		t.Fatalf("setting = %q", got)
	}

	id, err := st.SaveAccount(&Account{Name: "main", Role: "main", AuthType: "cookie", Cookie: "UID=1"})
	if err != nil || id == 0 {
		t.Fatalf("save account: %v id=%d", err, id)
	}
	acc, err := st.MainAccount()
	if err != nil || acc.ID != id {
		t.Fatalf("main account: %v %+v", err, acc)
	}
	if acc.Cookie != "UID=1" {
		t.Fatalf("cookie not persisted")
	}

	libID, err := st.SaveLibrary(&Library{
		Name: "movies", AccountID: id, RemoteCID: "0", LocalDir: filepath.Join(t.TempDir(), "media"),
		BaseURL: "http://h:2048", STRMFormat: "pick_code", VideoExts: ".mkv", MetaExts: ".srt",
		ScanMode: "fast", Enabled: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	lib, err := st.GetLibrary(libID)
	if err != nil {
		t.Fatal(err)
	}
	if lib.Name != "movies" || lib.STRMFormat != "pick_code" || !lib.Enabled {
		t.Fatalf("library roundtrip: %+v", lib)
	}

	f := &SyncedFile{LibraryID: libID, FID: "f1", Pickcode: "pc1", CID: "c1", Name: "a.mkv", RelPath: "a.mkv", STRMPath: "/tmp/a.strm", Size: 10}
	if err := st.UpsertFile(f); err != nil {
		t.Fatal(err)
	}
	// 同一 fid 更新而不是新增
	f.Pickcode = "pc2"
	if err := st.UpsertFile(f); err != nil {
		t.Fatal(err)
	}
	files, _ := st.ListFiles(libID)
	if len(files) != 1 || files[0].Pickcode != "pc2" {
		t.Fatalf("files = %+v", files)
	}
	if err := st.MarkOrphan(libID, "f1"); err != nil {
		t.Fatal(err)
	}
	files, _ = st.ListFiles(libID)
	if files[0].Status != "orphan" {
		t.Fatalf("status = %q", files[0].Status)
	}

	if err := st.UpsertDir(libID, "c1", "0", "movies", ""); err != nil {
		t.Fatal(err)
	}
	dirs, _ := st.ListDirs(libID)
	if len(dirs) != 1 || dirs[0].CID != "c1" {
		t.Fatalf("dirs = %+v", dirs)
	}

	taskID, err := st.CreateTask("scan", libID)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.UpdateTask(taskID, "done", "ok"); err != nil {
		t.Fatal(err)
	}
	tasks, _ := st.ListTasks(10)
	if len(tasks) != 1 || tasks[0].Status != "done" {
		t.Fatalf("tasks = %+v", tasks)
	}

	if err := st.DeleteLibrary(libID); err != nil {
		t.Fatal(err)
	}
	if _, err := st.GetLibrary(libID); err == nil {
		t.Fatal("library should be deleted")
	}
}

func TestDatabasePermissions(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows 不支持 POSIX 权限位")
	}
	st, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	info, err := os.Stat(st.path)
	if err != nil {
		t.Fatal(err)
	}
	if perm := info.Mode().Perm(); perm&0o077 != 0 {
		t.Fatalf("db permissions too open: %o", perm)
	}
}
