package scheduler

import (
	"context"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"time"

	"streampulse/internal/p115svc"
	"streampulse/internal/store"
)

// Scheduler 是自研 5 段 Cron：分 时 日 月 周。
// 支持 *、*/n、a-b、a-b/n、逗号列表。进程内每分钟最多触发一次。
type Scheduler struct {
	Store *store.Store
	Svc   *p115svc.Service
	Log   *slog.Logger

	mu   sync.Mutex
	last map[int64]string // libraryID -> "2006-01-02 15:04"
}

func New(st *store.Store, svc *p115svc.Service, log *slog.Logger) *Scheduler {
	if log == nil {
		log = slog.Default()
	}
	return &Scheduler{Store: st, Svc: svc, Log: log, last: map[int64]string{}}
}

func (s *Scheduler) Start(ctx context.Context) {
	go func() {
		t := time.NewTicker(20 * time.Second)
		defer t.Stop()
		// 对齐到下一分钟边界
		for {
			select {
			case <-ctx.Done():
				return
			case now := <-t.C:
				s.tick(ctx, now)
			}
		}
	}()
}

func (s *Scheduler) tick(ctx context.Context, now time.Time) {
	libs, err := s.Store.ListLibraries()
	if err != nil {
		return
	}
	stamp := now.Format("2006-01-02 15:04")
	for i := range libs {
		lib := &libs[i]
		if !lib.Enabled || strings.TrimSpace(lib.Cron) == "" {
			continue
		}
		ok, err := Match(lib.Cron, now)
		if err != nil {
			s.Log.Warn("cron 表达式无效", "library", lib.Name, "cron", lib.Cron, "err", err)
			continue
		}
		if !ok {
			continue
		}
		s.mu.Lock()
		if s.last[lib.ID] == stamp {
			s.mu.Unlock()
			continue
		}
		s.last[lib.ID] = stamp
		s.mu.Unlock()

		go func(lib store.Library) {
			taskID, _ := s.Store.CreateTask("cron-scan", lib.ID)
			_ = s.Store.UpdateTask(taskID, "running", "定时扫描")
			c, cancel := context.WithTimeout(ctx, 12*time.Hour)
			defer cancel()
			res, err := s.Svc.ScanLibrary(c, &lib)
			if err != nil {
				_ = s.Store.UpdateTask(taskID, "failed", err.Error())
				s.Log.Error("定时扫描失败", "library", lib.Name, "err", err)
				return
			}
			_ = s.Store.UpdateTask(taskID, "done", "定时扫描完成")
			s.Log.Info("定时扫描完成", "library", lib.Name, "written", res.Written)
		}(*lib)
	}
}

// Match 判断 5 段 cron 是否命中某一分钟。
func Match(expr string, t time.Time) (bool, error) {
	f := strings.Fields(strings.TrimSpace(expr))
	if len(f) != 5 {
		return false, strconv.ErrSyntax
	}
	vals := []int{t.Minute(), t.Hour(), t.Day(), int(t.Month()), int(t.Weekday())}
	for i, field := range f {
		ok, err := matchField(field, vals[i], i)
		if err != nil {
			return false, err
		}
		if !ok {
			return false, nil
		}
	}
	return true, nil
}

func matchField(field string, v int, pos int) (bool, error) {
	for _, part := range strings.Split(field, ",") {
		ok, err := matchPart(strings.TrimSpace(part), v, pos)
		if err != nil {
			return false, err
		}
		if ok {
			return true, nil
		}
	}
	return false, nil
}

func matchPart(part string, v, pos int) (bool, error) {
	if part == "*" {
		return true, nil
	}
	step := 1
	if i := strings.Index(part, "/"); i >= 0 {
		n, err := strconv.Atoi(part[i+1:])
		if err != nil || n <= 0 {
			return false, strconv.ErrSyntax
		}
		step = n
		part = part[:i]
	}
	lo, hi := 0, 0
	switch part {
	case "*":
		lo, hi = 0, 59
		if pos == 1 {
			hi = 23
		} else if pos == 2 {
			lo, hi = 1, 31
		} else if pos == 3 {
			lo, hi = 1, 12
		} else if pos == 4 {
			lo, hi = 0, 6
		}
	default:
		if i := strings.Index(part, "-"); i >= 0 {
			a, err1 := strconv.Atoi(part[:i])
			b, err2 := strconv.Atoi(part[i+1:])
			if err1 != nil || err2 != nil {
				return false, strconv.ErrSyntax
			}
			lo, hi = a, b
		} else {
			n, err := strconv.Atoi(part)
			if err != nil {
				return false, err
			}
			lo, hi = n, n
		}
	}
	if pos == 4 {
		// 周日既接受 0 也接受 7
		if v == 0 && lo<=7 && hi>=7 {
			return true, nil
		}
	}
	if v < lo || v > hi {
		return false, nil
	}
	return (v-lo)%step == 0, nil
}
