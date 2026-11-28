package synclock

import (
	"context"
	"testing"
	"time"
)

func TestLockUnlock(t *testing.T) {
	l := New()
	if err := l.Lock(context.Background(), "scan:test"); err != nil {
		t.Fatal(err)
	}
	st := l.Describe()
	if st.Holder != "scan:test" || st.Waiters != 0 {
		t.Fatalf("describe = %+v", st)
	}
	l.Unlock()
	if st := l.Describe(); st.Holder != "" {
		t.Fatalf("holder after unlock = %+v", st)
	}
}

func TestLockSecondWaiterRequestsYield(t *testing.T) {
	l := New()
	if err := l.Lock(context.Background(), "incremental"); err != nil {
		t.Fatal(err)
	}
	if l.YieldRequested() {
		t.Fatal("yield should be false before any waiter")
	}
	got := make(chan struct{})
	go func() {
		if err := l.Lock(context.Background(), "scan:电影"); err != nil {
			t.Error(err)
		}
		close(got)
	}()
	// 等待方登记后,持有方应立即看到让路请求
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if l.YieldRequested() {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if !l.YieldRequested() {
		t.Fatal("holder should see yield request after waiter registers")
	}
	l.Unlock()
	<-got // 第二个持有者拿到锁
	if st := l.Describe(); st.Holder != "scan:电影" {
		t.Fatalf("holder = %+v", st)
	}
	l.Unlock()
}

func TestTryLockPoliteSkipsWhenWaiting(t *testing.T) {
	l := New()
	if err := l.Lock(context.Background(), "scan:电影"); err != nil {
		t.Fatal(err)
	}
	// 无人排队时礼貌尝试可拿锁?不行,持有人已占用 → false
	if l.TryLockPolite("x") {
		t.Fatal("should fail while held")
	}
	go func() {
		_ = l.Lock(context.Background(), "incremental")
	}()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && l.Describe().Waiters == 0 {
		time.Sleep(5 * time.Millisecond)
	}
	// 有人排队时,第三个到的人礼貌放弃
	if l.TryLockPolite("third") {
		t.Fatal("polite try should skip when waiters exist")
	}
	l.Unlock()
	<-time.After(100 * time.Millisecond)
}

func TestLockCtxCancel(t *testing.T) {
	l := New()
	if err := l.Lock(context.Background(), "a"); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if err := l.Lock(ctx, "b"); err == nil {
		t.Fatal("expected ctx cancel error")
	}
	l.Unlock()
}

func TestTryLockPoliteWhenFree(t *testing.T) {
	l := New()
	if !l.TryLockPolite("quick") {
		t.Fatal("should acquire when free and no waiters")
	}
	l.Unlock()
}
