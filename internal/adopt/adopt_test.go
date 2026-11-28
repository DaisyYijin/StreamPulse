package adopt

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"streampulse/internal/store"
)

func TestParsePickcode(t *testing.T) {
	cases := map[string]string{
		// qmediasync 风格:pickcode 参数
		"http://nas:12333/115/url/video.mkv?pickcode=abc123&userid=99": "abc123",
		// p115strmhelper 风格
		"http://nas:8080/d/abc123.mp4": "abc123",
		// 本站直链(不应算待接管,但解析能出 id)
		"http://nas:2048/d/pc1": "pc1",
		// OpenList 路径风格(无 pickcode,解析不出)
		"http://host:5244/d/115/%E7%94%B5%E5%BD%B1/a.mkv": "",
		// 非法
		"not a url": "",
		"":          "",
	}
	for in, want := range cases {
		if got := ParsePickcode(in); got != want {
			t.Fatalf("ParsePickcode(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestMatchForeignBuckets(t *testing.T) {
	root := t.TempDir()
	mk := func(rel, content string) Foreign {
		p := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content+"\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		return Foreign{LibraryID: 1, Rel: rel, Path: p}
	}
	vars := []Foreign{
		mk("Movies/a.strm", "http://other:99/115/url/video.mkv?pickcode=pc1"),  // 同位接管
		mk("Movies/newname.strm", "http://other:99/d/pc2.mkv"),                 // 改名接管
		mk("Movies/pathonly.strm", "http://host:5244/d/115/x/y.mkv"),           // 按路径对
		mk("Movies/none.strm", "http://host:5244/d/115/zzz.mkv"),               // 对不上
		mk("Movies/ours.strm", "http://nas:2048/d/pc1"),                        // 本站格式跳过
	}
	ledger := []store.SyncedFile{
		{LibraryID: 1, FID: "f1", Pickcode: "pc1", RelPath: "Movies/a.strm", STRMPath: filepath.Join(root, "Movies", "a.strm")},
		{LibraryID: 1, FID: "f2", Pickcode: "pc2", RelPath: "Movies/oldname.strm", STRMPath: filepath.Join(root, "Movies", "oldname.strm")},
		{LibraryID: 1, FID: "f3", Pickcode: "pc3", RelPath: "Movies/pathonly.strm", STRMPath: filepath.Join(root, "Movies", "pathonly.strm")},
	}
	plan := MatchForeign(vars, ledger, map[int64]string{1: root})
	if plan.Scanned != 5 || plan.Skipped != 1 || len(plan.Adoptable) != 3 || len(plan.Missing) != 1 {
		t.Fatalf("plan: scanned=%d skipped=%d adoptable=%d missing=%d",
			plan.Scanned, plan.Skipped, len(plan.Adoptable), len(plan.Missing))
	}
	kinds := map[string]string{}
	for _, it := range plan.Adoptable {
		kinds[it.Kind] = it.File.Pickcode
	}
	if kinds["same_path"] != "pc1" || kinds["renamed"] != "pc2" || kinds["by_path"] != "pc3" {
		t.Fatalf("kinds = %v", kinds)
	}
}

func TestApplyRewritesAndKeepsMtime(t *testing.T) {
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	root := t.TempDir()
	p := filepath.Join(root, "Movies", "a.strm")
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-24 * time.Hour)
	if err := os.WriteFile(p, []byte("http://other:99/115/url/video.mkv?pickcode=pc9\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(p, old, old); err != nil {
		t.Fatal(err)
	}
	items := []AdoptItem{{
		Foreign: Foreign{LibraryID: 1, Rel: "Movies/a.strm", Path: p},
		File:    store.SyncedFile{LibraryID: 1, FID: "f1", Pickcode: "pc9", Name: "a.mkv", RelPath: "Movies/old.strm", STRMPath: "old"},
	}}
	n, err := Apply("http://nas:2048", items, st)
	if err != nil || n != 1 {
		t.Fatalf("apply = %d %v", n, err)
	}
	b, _ := os.ReadFile(p)
	if !strings.HasPrefix(string(b), "http://nas:2048/d/pc9") {
		t.Fatalf("content = %q", string(b))
	}
	info, _ := os.Stat(p)
	if info.ModTime().Sub(old) > time.Minute {
		t.Fatalf("mtime not preserved: %v", info.ModTime())
	}
	// 台账行搬到接管位置
	files, _ := st.ListFiles(1)
	if len(files) != 1 || files[0].RelPath != "Movies/a.strm" || files[0].Status != "ok" {
		t.Fatalf("files = %+v", files)
	}
	// 未配播放地址拒绝
	if _, err := Apply("", items, st); err == nil {
		t.Fatal("empty base should fail")
	}
}
