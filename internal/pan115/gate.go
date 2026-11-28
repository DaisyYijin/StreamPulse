package pan115

import (
	"context"
	"strings"
	"sync"
	"time"

	"streampulse/internal/ratelimit"
)

// 调用中轴:所有 115 文件域接口(webapi/proapi)的调用,无论走 driver 库还是
// 轻量 HTTP,都必须经这里拿通道——修复 driver 路径绕过节流的问题。
//
// 三条通道:
//   read  普通读(列目录/查详情/容量/事件流),默认 1s;
//   write 写(删除/改名),默认 3s,写接口对风控更敏感;
//   fast  播放取直链,独立锁+独立锚点 200ms。取直链在起播关键路径上,
//         与扫描共用 1s 队列会被后台任务饿死,所以完全解耦。
//
// 熔断:收到 429 / 风控文案(如"服务器开小差了"、"操作过于频繁")触发
// 全局冷却 60s,期间所有通道排队等恢复——避免雪崩式重试把风控拖成封禁。
// 登录域名(qrcodeapi / passportapi)不节流,不影响扫码体验。

type gateKind int

const (
	gateRead gateKind = iota
	gateWrite
	gateFast
)

const (
	fastInterval  = 200 * time.Millisecond
	breakerPeriod = 60 * time.Second
)

// breaker 是全局风控熔断状态机:trip 后所有 gate 调用排队到 until。
type breaker struct {
	mu     sync.Mutex
	until  time.Time
	reason string
}

func (b *breaker) wait(ctx context.Context) error {
	b.mu.Lock()
	until := b.until
	b.mu.Unlock()
	if until.IsZero() {
		return nil
	}
	d := time.Until(until)
	if d <= 0 {
		return nil
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

func (b *breaker) trip(d time.Duration, reason string) {
	b.mu.Lock()
	now := time.Now()
	if b.until.IsZero() || now.Add(d).After(b.until) {
		b.until = now.Add(d)
	}
	b.reason = reason
	b.mu.Unlock()
}

func (b *breaker) status() (tripped bool, until time.Time, reason string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.until.IsZero() || time.Now().After(b.until) {
		return false, time.Time{}, ""
	}
	return true, b.until, b.reason
}

// riskControlled 从错误文本里识别 115 风控信号(driver 库的错误没有结构化
// 错误码,只能按文案识别;HTTP 路径的 429 文案也走这里)。
func riskControlled(err error) bool {
	if err == nil {
		return false
	}
	s := err.Error()
	for _, kw := range []string{"429", "限流", "开小差", "过于频繁", "请求太快"} {
		if strings.Contains(s, kw) {
			return true
		}
	}
	return false
}

// gated 是中轴入口:熔断等待 → 通道限流 → 执行 → 风控错误触发熔断。
func (c *Client) gated(ctx context.Context, k gateKind, fn func() error) error {
	if err := c.brk.wait(ctx); err != nil {
		return err
	}
	var lim *ratelimit.Limiter
	switch k {
	case gateWrite:
		lim = c.write
	case gateFast:
		lim = c.fast
	default:
		lim = c.read
	}
	if err := lim.Wait(ctx); err != nil {
		return err
	}
	err := fn()
	if riskControlled(err) {
		c.brk.trip(breakerPeriod, err.Error())
	}
	return err
}

// ThrottleStatus 暴露给状态页:当前间隔与熔断状态。
type ThrottleStatus struct {
	ReadMS  int64 `json:"readMs"`
	WriteMS int64 `json:"writeMs"`
	FastMS  int64 `json:"fastMs"`
	Breaker struct {
		Tripped bool   `json:"tripped"`
		Reason  string `json:"reason"`
		Until   int64  `json:"until"`
	} `json:"breaker"`
}

func (c *Client) ThrottleStatus() ThrottleStatus {
	st := ThrottleStatus{
		ReadMS:  c.read.Every().Milliseconds(),
		WriteMS: c.write.Every().Milliseconds(),
		FastMS:  c.fast.Every().Milliseconds(),
	}
	if tripped, until, reason := c.brk.status(); tripped {
		st.Breaker.Tripped = true
		st.Breaker.Reason = reason
		st.Breaker.Until = until.Unix()
	}
	return st
}
