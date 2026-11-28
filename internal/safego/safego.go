package safego

import (
	"log/slog"
	"runtime/debug"
)

// 后台 goroutine 的 panic 兜底:一处业务 panic 不允许拖垮整个进程。
// 原则:兜"一轮"而不是兜"整个循环"——循环体每轮单独包,连续 panic 会
// 在日志里连续出现(可见),而不是被静默吞掉刷屏。

// Go 启动一个带 panic 兜底的 goroutine,组件名用于日志定位。
func Go(name string, log *slog.Logger, fn func()) {
	if log == nil {
		log = slog.Default()
	}
	go func() {
		defer Guard(name, log)()
		fn()
	}()
}

// Guard 返回一个 defer 用的 recover 钩子。
func Guard(name string, log *slog.Logger) func() {
	if log == nil {
		log = slog.Default()
	}
	return func() {
		if r := recover(); r != nil {
			log.Error("后台任务 panic（已兜底，本组件继续运行）",
				"component", name, "panic", r, "stack", string(debug.Stack()))
		}
	}
}

// Loop 跑一个循环体,每轮独立兜 panic;intervalFn 返回每轮之间的等待(通常
// 来自 ticker / timer),由调用方自己控制退出。
func Loop(name string, log *slog.Logger, body func()) {
	if log == nil {
		log = slog.Default()
	}
	for {
		func() {
			defer Guard(name, log)()
			body()
		}()
	}
}
