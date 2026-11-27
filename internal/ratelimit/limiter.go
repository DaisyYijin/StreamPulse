package ratelimit

import (
	"context"
	"sync"
	"time"
)

// Limiter 是串行间隔限流器：两次 Wait 之间至少间隔 every。
// 115 的读接口默认 1s、写接口默认 3s；并发调用会排队。
type Limiter struct {
	mu    sync.Mutex
	every time.Duration
	next  time.Time
}

func New(every time.Duration) *Limiter {
	if every < 0 {
		every = 0
	}
	return &Limiter{every: every}
}

func (l *Limiter) Every() time.Duration { return l.every }

func (l *Limiter) Wait(ctx context.Context) error {
	l.mu.Lock()
	now := time.Now()
	at := l.next
	if at.Before(now) {
		at = now
	}
	l.next = at.Add(l.every)
	l.mu.Unlock()

	d := time.Until(at)
	if d <= 0 {
		return ctx.Err()
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// SetEvery 允许运行时调整（例如设置页改间隔）。
func (l *Limiter) SetEvery(d time.Duration) {
	l.mu.Lock()
	l.every = d
	l.mu.Unlock()
}
