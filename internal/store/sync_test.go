package store

import (
	"testing"
	"time"
)

func TestEventLifecycle(t *testing.T) {
	st, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	id1, isNew, err := st.AddEventPending(1, "100", "1", "a.mkv", "pc1")
	if err != nil || !isNew || id1 == 0 {
		t.Fatalf("add pending: %v %v %v", id1, isNew, err)
	}
	// 重复事件:返回既有行,isNew=false
	id2, isNew, err := st.AddEventPending(1, "100", "1", "a.mkv", "pc1")
	if err != nil || isNew || id2 != id1 {
		t.Fatalf("replay: %v %v %v", id2, isNew, err)
	}
	n, _ := st.CountPendingEvents(1)
	if n != 1 {
		t.Fatalf("pending = %d", n)
	}
	pending, _ := st.ListPendingEvents(1)
	if len(pending) != 1 || pending[0].Pickcode != "pc1" {
		t.Fatalf("pending rows = %+v", pending)
	}
	if err := st.ApplyEvents([]int64{id1}, "self"); err != nil {
		t.Fatal(err)
	}
	n, _ = st.CountPendingEvents(1)
	if n != 0 {
		t.Fatalf("pending after apply = %d", n)
	}
}

func TestMaxEventIDAndMarkAll(t *testing.T) {
	st, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	for _, id := range []string{"900", "1200", "80", "abc"} {
		_, _, _ = st.AddEventPending(1, id, "1", "", "")
	}
	if got := st.MaxEventID(1); got != "1200" {
		t.Fatalf("max = %q", got)
	}
	if err := st.MarkAllEventsApplied(1, "full"); err != nil {
		t.Fatal(err)
	}
	n, _ := st.CountPendingEvents(1)
	if n != 0 {
		t.Fatalf("pending after mark-all = %d", n)
	}
}

func TestSuppression(t *testing.T) {
	st, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	if err := st.MarkSuppressed([]string{"f1", "", "f2"}, "delete", time.Hour); err != nil {
		t.Fatal(err)
	}
	m, err := st.PeekSuppressed([]string{"f1", "f3"})
	if err != nil {
		t.Fatal(err)
	}
	if !m["f1"] || m["f3"] {
		t.Fatalf("peek = %v", m)
	}
	// 续期:TTL 过期后不再命中
	if err := st.MarkSuppressed([]string{"f1"}, "delete", -time.Second); err != nil {
		t.Fatal(err)
	}
	m, _ = st.PeekSuppressed([]string{"f1"})
	if m["f1"] {
		t.Fatal("expired suppression should not hit")
	}
	// 清理过期行:此刻只有 f1 过期,f2 还在期内
	n, err := st.CleanupSuppressed()
	if err != nil || n != 1 {
		t.Fatalf("cleanup = %d %v", n, err)
	}
	if err := st.MarkSuppressed([]string{"f2"}, "delete", -time.Second); err != nil {
		t.Fatal(err)
	}
	if n, err := st.CleanupSuppressed(); err != nil || n != 1 {
		t.Fatalf("cleanup f2 = %d %v", n, err)
	}
}

func TestPathCacheAndSubtreeForget(t *testing.T) {
	st, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	rows := []PathRow{
		{CID: "a", ParentCID: "0", Name: "media", Path: "media"},
		{CID: "b", ParentCID: "a", Name: "movies", Path: "media/movies"},
		{CID: "c", ParentCID: "b", Name: "2024", Path: "media/movies/2024"},
	}
	if err := st.UpsertPathRows(rows); err != nil {
		t.Fatal(err)
	}
	row, ok := st.GetPath("c")
	if !ok || row.Path != "media/movies/2024" {
		t.Fatalf("get = %+v ok=%v", row, ok)
	}
	// 更新
	if err := st.UpsertPathRows([]PathRow{{CID: "c", ParentCID: "b", Name: "2024", Path: "media/movies/2024x"}}); err != nil {
		t.Fatal(err)
	}
	row, _ = st.GetPath("c")
	if row.Path != "media/movies/2024x" {
		t.Fatalf("updated path = %q", row.Path)
	}
	// 子树失效:删 b 应连带 c,不动 a
	n, err := st.ForgetDirSubtree("b")
	if err != nil || n != 2 {
		t.Fatalf("forget = %d %v", n, err)
	}
	if _, ok := st.GetPath("a"); !ok {
		t.Fatal("a should survive")
	}
	if _, ok := st.GetPath("b"); ok {
		t.Fatal("b should be gone")
	}
	if _, ok := st.GetPath("c"); ok {
		t.Fatal("c should be gone")
	}
}
