package strm

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRebaseLine(t *testing.T) {
	cases := []struct {
		line string
		ok   bool
		want string
	}{
		{"http://old.com/d/abc", true, "http://new.com/d/abc"},
		{"http://old.com/d/abc?/name.mkv", true, "http://new.com/d/abc?/name.mkv"},
		{"http://old.com/", true, "http://new.com/"},
		{"http://old.com", true, "http://new.com"},
		{"http://old.com.evil.com/d/abc", false, ""},
		{"http://other.com/d/abc", false, ""},
	}
	for _, c := range cases {
		got, ok := rebaseLine(c.line, "http://old.com", "http://new.com")
		if ok != c.ok || (ok && got != c.want) {
			t.Fatalf("rebaseLine(%q) = %q %v, want %q %v", c.line, got, ok, c.want, c.ok)
		}
	}
}

func TestRebase(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "Movies")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	write := func(name, content string) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("a.strm", "http://old.com/d/abc\n")
	write("b.strm", "http://old.com.evil.com/d/xyz\n") // 不该被替换
	write("c.strm", "http://other.com/d/ok\n")         // 不该被替换
	write("d.txt", "ignore me\n")

	changed, scanned, err := Rebase(root, "http://old.com", "http://new.com:2048")
	if err != nil {
		t.Fatal(err)
	}
	if changed != 1 || scanned != 3 {
		t.Fatalf("changed=%d scanned=%d", changed, scanned)
	}
	b, _ := os.ReadFile(filepath.Join(dir, "a.strm"))
	if !strings.HasPrefix(string(b), "http://new.com:2048/d/abc\n") {
		t.Fatalf("a.strm = %q", string(b))
	}
	b, _ = os.ReadFile(filepath.Join(dir, "b.strm"))
	if !strings.HasPrefix(string(b), "http://old.com.evil.com") {
		t.Fatalf("b.strm must stay: %q", string(b))
	}
	// 非法参数
	if _, _, err := Rebase(root, "notaurl", "http://x.com"); err == nil {
		t.Fatal("from must be http(s)")
	}
	if _, _, err := Rebase(root, "http://x.com", "http://x.com"); err == nil {
		t.Fatal("from == to should fail")
	}
}
