package pan115

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestRiskControlled(t *testing.T) {
	cases := map[string]bool{
		"115 限流 429: body":            true,
		`115 列目录失败: 服务器开小差了,请稍后再试`: true,
		"操作过于频繁":                     true,
		"115 HTTP 403":               false,
		"普通网络错误":                     false,
		"":                           false,
	}
	for s, want := range cases {
		if got := riskControlled(errors.New(s)); got != want {
			t.Fatalf("riskControlled(%q) = %v", s, got)
		}
	}
	if riskControlled(nil) {
		t.Fatal("nil should not trip")
	}
}

func TestBreakerTripAndRecovery(t *testing.T) {
	var b breaker
	if tripped, _, _ := b.status(); tripped {
		t.Fatal("fresh breaker should be clear")
	}
	b.trip(breakerPeriod, "429")
	tripped, until, reason := b.status()
	if !tripped || reason != "429" || until.Before(time.Now()) {
		t.Fatalf("tripped=%v until=%v reason=%q", tripped, until, reason)
	}
	// 等待会阻塞到恢复
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if err := b.wait(ctx); err == nil {
		t.Fatal("wait should block while tripped (ctx timeout expected)")
	}
	// 到期后自然恢复
	b.until = time.Now().Add(-time.Second)
	if err := b.wait(context.Background()); err != nil {
		t.Fatal(err)
	}
	if tripped, _, _ := b.status(); tripped {
		t.Fatal("expired breaker should report clear")
	}
}

func TestGatedTripsOnRiskError(t *testing.T) {
	c := New(Credential{}, time.Millisecond, time.Millisecond)
	// 通道自由时执行,返回风控错误 → 触发熔断
	c.gated(context.Background(), gateRead, func() error {
		return errors.New("115 限流 429: too fast")
	})
	tripped, _, reason := c.brk.status()
	if !tripped {
		t.Fatal("risk error should trip breaker")
	}
	if reason == "" {
		t.Fatal("reason should be recorded")
	}
	// 正常错误不触发
	c2 := New(Credential{}, time.Millisecond, time.Millisecond)
	c2.gated(context.Background(), gateRead, func() error {
		return errors.New("115 HTTP 403")
	})
	if tripped, _, _ := c2.brk.status(); tripped {
		t.Fatal("plain error should not trip")
	}
}

func TestThrottleStatusShape(t *testing.T) {
	c := New(Credential{}, time.Second, 3*time.Second)
	st := c.ThrottleStatus()
	if st.ReadMS != 1000 || st.WriteMS != 3000 || st.FastMS != 200 {
		t.Fatalf("status = %+v", st)
	}
	if st.Breaker.Tripped {
		t.Fatal("fresh client should not be tripped")
	}
	c.brk.trip(breakerPeriod, "测试")
	st = c.ThrottleStatus()
	if !st.Breaker.Tripped || st.Breaker.Reason != "测试" {
		t.Fatalf("status = %+v", st)
	}
}
