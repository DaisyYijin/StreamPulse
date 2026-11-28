package store

import "testing"

func TestTaskQueue(t *testing.T) {
	st, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	// 首次入队
	id1, reused, err := st.EnqueueTask("scan", 1, "scan:1", `{"libraryId":1}`)
	if err != nil || reused {
		t.Fatalf("first enqueue: id=%d reused=%v err=%v", id1, reused, err)
	}
	// 同键再入队 → 复用,不产生新行
	id2, reused, err := st.EnqueueTask("scan", 1, "scan:1", `{"libraryId":1}`)
	if err != nil {
		t.Fatal(err)
	}
	if !reused || id2 != id1 {
		t.Fatalf("dedupe: id=%d reused=%v (want id=%d reused=true)", id2, reused, id1)
	}
	tasks, _ := st.ListTasks(10)
	if len(tasks) != 1 {
		t.Fatalf("rows = %d, want 1", len(tasks))
	}

	// 不同键正常入队
	if _, reused, err := st.EnqueueTask("scan", 2, "scan:2", `{}`); err != nil || reused {
		t.Fatalf("second key: reused=%v err=%v", reused, err)
	}

	// FIFO 认领
	first, err := st.ClaimNextTask()
	if err != nil || first == nil {
		t.Fatalf("claim: %v", err)
	}
	if first.ID != id1 || first.Kind != "scan" || first.Status != "running" {
		t.Fatalf("first claimed = %+v", first)
	}
	if got := st.GetSetting("none", ""); got != "" {
		t.Fatal("unrelated")
	}

	// 认领后同键可以再次入队(运行中的不挡新的排队)
	if _, reused, err := st.EnqueueTask("scan", 1, "scan:1", `{}`); err != nil || reused {
		t.Fatalf("re-enqueue after claim should insert new: reused=%v err=%v", reused, err)
	}

	// 进度与完成
	if err := st.SetTaskProgress(id1, "扫描中"); err != nil {
		t.Fatal(err)
	}
	if err := st.UpdateTask(id1, "done", "完成"); err != nil {
		t.Fatal(err)
	}
	second, _ := st.ClaimNextTask()
	if second == nil || second.ID == id1 {
		t.Fatalf("second claim = %+v", second)
	}
}

func TestRecoverStuckTasks(t *testing.T) {
	st, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	id, _, err := st.EnqueueTask("scan", 1, "scan:1", `{}`)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.ClaimNextTask(); err != nil {
		t.Fatal(err)
	}
	if err := st.RecoverStuckTasks(); err != nil {
		t.Fatal(err)
	}
	tasks, _ := st.ListTasks(10)
	if tasks[0].ID == id && tasks[0].Status != "failed" {
		t.Fatalf("stuck task not recovered: %+v", tasks[0])
	}
}
