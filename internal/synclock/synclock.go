package synclock

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// 礼让锁:全局同一时刻只允许一个"重活"(全量扫描 / 增量 / 目录同步)占着 115。
//
// 与裸 Mutex 的区别(全部来自长期运行的教训):
//   - 等待方可登记,持有方在合适的查点主动让路(Yield)——增量每 30 秒一轮,
//     不让路的话手动任务会被增量饿死;让路方保持幂等,下一轮原样重放。
//   - TryLockPolite:有人排队时不抢——否则增量会在手动任务刚放锁的瞬间又抢回去,让路白做。
//   - Describe():报"被谁占着、占多久、几个人在等",状态页据此显示"正在等谁"。

type Lock struct {
	mu      sync.Mutex
	sem     chan struct{}
	holder  string
	since   time.Time
	waiters int
	yield   bool
}

func New() *Lock {
	return &Lock{sem: make(chan struct{}, 1)}
}

// Lock 阻塞拿锁,直到拿到或 ctx 结束。holder 是任务描述,如 "scan:电影"。
func (l *Lock) Lock(ctx context.Context, holder string) error {
	l.mu.Lock()
	l.waiters++
	// 有人排队就立刻请求持有方收工——不等我们阻塞上来,持有方在下一个
	// 查点就会让路,避免增量整轮跑完才放锁。
	if l.holder != "" {
		l.yield = true
	}
	l.mu.Unlock()
	defer func() {
		l.mu.Lock()
		l.waiters--
		l.mu.Unlock()
	}()

	select {
	case l.sem <- struct{}{}:
	case <-ctx.Done():
		return ctx.Err()
	}
	l.mu.Lock()
	l.holder = holder
	l.since = time.Now()
	l.yield = false
	l.mu.Unlock()
	return nil
}

// TryLockPolite 有人排队时不抢,返回 false。
func (l *Lock) TryLockPolite(holder string) bool {
	l.mu.Lock()
	busy := l.waiters > 0
	l.mu.Unlock()
	if busy {
		return false
	}
	select {
	case l.sem <- struct{}{}:
	default:
		return false
	}
	l.mu.Lock()
	l.holder = holder
	l.since = time.Now()
	l.yield = false
	l.mu.Unlock()
	return true
}

func (l *Lock) Unlock() {
	l.mu.Lock()
	l.holder = ""
	l.since = time.Time{}
	l.yield = false
	l.mu.Unlock()
	<-l.sem
}

// RequestYield 等待方请求持有方收工。只登记,不阻塞。
func (l *Lock) RequestYield() {
	l.mu.Lock()
	l.yield = true
	l.mu.Unlock()
}

// YieldRequested 持有方在扫描/遍历的查点调用;true 表示有人排队,尽快就地停下。
func (l *Lock) YieldRequested() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.yield
}

// ClearYield 持有方重新拿锁后清掉残留的让路标记。
func (l *Lock) ClearYield() {
	l.mu.Lock()
	l.yield = false
	l.mu.Unlock()
}

type Status struct {
	Holder        string `json:"holder"`
	HeldFor       string `json:"heldFor"`
	HeldSeconds   int64  `json:"heldSeconds"`
	Waiters       int    `json:"waiters"`
	YieldRequests bool   `json:"yieldRequested"`
}

func (l *Lock) Describe() Status {
	l.mu.Lock()
	defer l.mu.Unlock()
	st := Status{Holder: l.holder, Waiters: l.waiters, YieldRequests: l.yield}
	if !l.since.IsZero() {
		d := time.Since(l.since)
		st.HeldSeconds = int64(d.Seconds())
		st.HeldFor = fmt.Sprintf("%.0fs", d.Seconds())
	}
	return st
}
