package backup

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"
)

func TestExportAndStageRestore(t *testing.T) {
	tmp := t.TempDir()
	snap := filepath.Join(tmp, "snapshot.db")
	if err := os.WriteFile(snap, []byte("SQLITEDATA"), 0o600); err != nil {
		t.Fatal(err)
	}
	cfgDir := filepath.Join(tmp, "config")
	if err := os.MkdirAll(cfgDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(cfgDir, "jwt.key"), []byte("SECRETKEY32BYTES-SECRETKEY32BYTES"), 0o600); err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(tmp, "backup.zip")
	if err := Export(dst, snap, cfgDir); err != nil {
		t.Fatal(err)
	}
	zf, err := zip.OpenReader(dst)
	if err != nil {
		t.Fatal(err)
	}
	defer zf.Close()
	names := map[string]bool{}
	for _, f := range zf.File {
		names[f.Name] = true
	}
	if !names["streampulse.db"] || !names["config/jwt.key"] || !names[manifestName] {
		t.Fatalf("zip entries = %v", names)
	}

	// Stage:校验并解到 restore-pending
	pending := filepath.Join(tmp, "restore-pending")
	if err := StageRestore(dst, pending); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(pending, "streampulse.db")); err != nil {
		t.Fatal("db not staged")
	}
	if _, err := os.Stat(filepath.Join(pending, "jwt.key")); err != nil {
		t.Fatal("key not staged")
	}

	// Apply:换进正式位置
	dataDir := filepath.Join(tmp, "data")
	cfgDir2 := filepath.Join(tmp, "config2")
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(cfgDir2, 0o700); err != nil {
		t.Fatal(err)
	}
	oldDB := filepath.Join(dataDir, "streampulse.db")
	if err := os.WriteFile(oldDB, []byte("OLDDATA"), 0o600); err != nil {
		t.Fatal(err)
	}
	ApplyPendingRestore(dataDir, cfgDir2, pending, nil)
	b, err := os.ReadFile(oldDB)
	if err != nil || string(b) != "SQLITEDATA" {
		t.Fatalf("restored db = %q %v", string(b), err)
	}
	if _, err := os.Stat(oldDB + ".prerestore"); err != nil {
		t.Fatal("prerestore backup missing")
	}
	k, err := os.ReadFile(filepath.Join(cfgDir2, "jwt.key"))
	if err != nil || string(k) != "SECRETKEY32BYTES-SECRETKEY32BYTES" {
		t.Fatalf("restored key = %q %v", string(k), err)
	}
	// 结果文件
	if _, err := os.Stat(filepath.Join(dataDir, ".restore-result.json")); err != nil {
		t.Fatal("restore result missing")
	}
	// pending 目录已清
	if _, err := os.Stat(pending); !os.IsNotExist(err) {
		t.Fatal("pending dir should be removed")
	}
}

func TestStageRejectsBadZip(t *testing.T) {
	tmp := t.TempDir()
	bad := filepath.Join(tmp, "bad.zip")
	if err := os.WriteFile(bad, []byte("not a zip"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := StageRestore(bad, filepath.Join(tmp, "pending")); err == nil {
		t.Fatal("bad zip should fail")
	}
	// 没有数据库快照的包也拒绝
	partial := filepath.Join(tmp, "partial.zip")
	zf, err := os.Create(partial)
	if err != nil {
		t.Fatal(err)
	}
	zw := zip.NewWriter(zf)
	w, _ := zw.Create("manifest.json")
	w.Write([]byte("{}"))
	zw.Close()
	zf.Close()
	if err := StageRestore(partial, filepath.Join(tmp, "pending2")); err == nil {
		t.Fatal("zip without db should fail")
	}
}
