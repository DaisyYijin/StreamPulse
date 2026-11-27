package incr

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"sync"
	"time"

	"streampulse/internal/pan115"
	"streampulse/internal/scan"
	"streampulse/internal/store"
)

// Service 消费 115 生活事件：只处理新增/变更涉及的目录，不遍历全盘。
// 首轮只记录游标（baseline），避免历史事件造成扫描风暴。
// Source 是增量消费需要的能力，便于测试注入假实现。
type Source interface {
	ListBehavior(ctx context.Context, accountID int64, limit int) ([]pan115.LifeEvent, error)
	ScanDir(ctx context.Context, lib *store.Library, cid string) (scan.Result, error)
}

type Service struct {
	Store    *store.Store
	Src      Source
	Log      *slog.Logger
	Interval time.Duration

	mu sync.Mutex
}

type Result struct {
	Events      int  `json:"events"`
	NewEvents   int  `json:"newEvents"`
	ScannedDirs int  `json:"scannedDirs"`
	Baseline    bool `json:"baseline"`
	Errors      int  `json:"errors"`
}

func (s *Service) Start(ctx context.Context) {
	if s.Interval <= 0 {
		s.Interval = 30 * time.Second
	}
	go func() {
		// 首轮延迟几秒，等进程完成初始化
		select {
		case <-ctx.Done():
			return
		case <-time.After(5 * time.Second):
		}
		for {
			r, err := s.PollOnce(ctx)
			if err != nil {
				s.Log.Warn("生活事件轮询失败", "err", err)
			} else if !r.Baseline && (r.NewEvents > 0 || r.ScannedDirs > 0) {
				s.Log.Info("增量同步", "events", r.Events, "new", r.NewEvents, "dirs", r.ScannedDirs)
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(s.Interval):
			}
		}
	}()
}

func (s *Service) PollOnce(ctx context.Context) (Result, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var res Result
	acc, err := s.Store.MainAccount()
	if err != nil {
		return res, nil // 还没有账号，静默等待
	}
	cursor := s.Store.GetSetting(cursorKey(acc.ID), "")
	limit := 64
	if cursor == "" {
		limit = 1000
	}
	events, err := s.Src.ListBehavior(ctx, acc.ID, limit)
	if err != nil {
		return res, err
	}
	res.Events = len(events)
	if len(events) == 0 {
		return res, nil
	}

	latest := events[0].ID
	if cursor == "" {
		_ = s.Store.SetSetting(cursorKey(acc.ID), latest)
		res.Baseline = true
		return res, nil
	}

	// 只在游标之后的事件里做去重，避免一轮重复扫描同一目录
	seen := map[string]bool{}
	type target struct {
		lib *store.Library
		cid string
	}
	targets := map[string]target{}
	libByCID := s.indexDirs()

	for _, ev := range events {
		if !idNewer(ev.ID, cursor) {
			break // 事件按新 → 旧返回，命中游标即停
		}
		if ev.FileID != "" && seen[ev.FileID] {
			continue
		}
		seen[ev.FileID] = true
		added, _ := s.Store.AddEvent(acc.ID, ev.ID, ev.Type, ev.FileName)
		if added {
			res.NewEvents++
		}
		// 即使事件已记录，只要游标还没推进就继续收集目标目录：
		// 上一轮扫描失败时游标不前进，必须允许重试。
		if ev.CID == "" {
			continue
		}
		if t, ok := libByCID[ev.CID]; ok {
			targets[fmt.Sprintf("%d|%s", t.lib.ID, ev.CID)] = target{lib: t.lib, cid: ev.CID}
		}
	}

	// 每轮最多处理 10 个目录，避免一次把 115 打爆
	const maxDirs = 10
	n := 0
	for _, t := range targets {
		if n >= maxDirs {
			break
		}
		if ctx.Err() != nil {
			return res, ctx.Err()
		}
		if _, err := s.Src.ScanDir(ctx, t.lib, t.cid); err != nil {
			res.Errors++
			s.Log.Warn("增量扫描目录失败", "library", t.lib.Name, "cid", t.cid, "err", err)
			continue
		}
		res.ScannedDirs++
		n++
	}

	// 有失败或目标目录超过单轮上限时不推进游标，下一轮继续。
	if res.Errors == 0 && len(targets) <= maxDirs {
		_ = s.Store.SetSetting(cursorKey(acc.ID), latest)
	}
	return res, nil
}

type dirTarget struct {
	lib *store.Library
}

// indexDirs 建立 cid → 媒体库 的索引（cid 在台账里出现即认为属于该库）。
func (s *Service) indexDirs() map[string]dirTarget {
	out := map[string]dirTarget{}
	libs, err := s.Store.ListLibraries()
	if err != nil {
		return out
	}
	for i := range libs {
		lib := &libs[i]
		dirs, err := s.Store.ListDirs(lib.ID)
		if err != nil {
			continue
		}
		out[lib.RemoteCID] = dirTarget{lib: lib}
		for _, d := range dirs {
			out[d.CID] = dirTarget{lib: lib}
		}
	}
	return out
}

func cursorKey(accountID int64) string {
	return fmt.Sprintf("life_cursor_%d", accountID)
}

// idNewer 比较事件 id（通常是数字字符串；格式异常时退回字符串比较）。
func idNewer(id, cursor string) bool {
	a, err1 := strconv.ParseInt(id, 10, 64)
	b, err2 := strconv.ParseInt(cursor, 10, 64)
	if err1 == nil && err2 == nil {
		return a > b
	}
	return id > cursor
}
