package eventbus

import "sync"

// 轻量类型化事件总线:同步完成 → 刮削 → Emby 刷库 这类联动用,
// 发布者不感知订阅者。事件是小 struct,订阅者按事件类型注册。
type sub struct {
	fn func(any)
}

type Bus struct {
	mu   sync.RWMutex
	subs map[string][]*sub
}

func New() *Bus {
	return &Bus{subs: map[string][]*sub{}}
}

// Subscribe 注册某类事件的订阅者;返回退订函数。
func (b *Bus) Subscribe(event string, fn func(payload any)) func() {
	s := &sub{fn: fn}
	b.mu.Lock()
	b.subs[event] = append(b.subs[event], s)
	b.mu.Unlock()
	return func() {
		b.mu.Lock()
		defer b.mu.Unlock()
		list := b.subs[event]
		for i, e := range list {
			if e == s {
				b.subs[event] = append(list[:i], list[i+1:]...)
				break
			}
		}
	}
}

// Publish 广播事件。订阅者异常不应影响发布方,这里不做 recover——
// 订阅方自己用 safego 包;同步调用保证事件顺序简单可预测。
func (b *Bus) Publish(event string, payload any) {
	b.mu.RLock()
	list := make([]*sub, len(b.subs[event]))
	copy(list, b.subs[event])
	b.mu.RUnlock()
	for _, s := range list {
		s.fn(payload)
	}
}

// 内置事件名。
const (
	EventSyncDone    = "sync.done"    // payload: SyncDoneEvent
	EventScrapeDone  = "scrape.done"  // payload: ScrapeDoneEvent
	EventDeleteLocal = "delete.local" // payload: DeleteLocalEvent(深删本地完成后)
)

type SyncDoneEvent struct {
	LibraryID   int64
	LibraryName string
	Written     int
}

type ScrapeDoneEvent struct {
	LibraryID int64
	OK        int
	Failed    int
}

type DeleteLocalEvent struct {
	LibraryID int64
	Count     int
}
