package incr

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"time"

	"streampulse/internal/pan115"
	"streampulse/internal/scan"
	"streampulse/internal/store"
	"streampulse/internal/strm"
)

// Service 消费 115 生活事件：只处理新增/变更涉及的目录，不遍历全盘。
// 首轮只记录游标（baseline），避免历史事件造成扫描风暴。
//
// 可靠性语义（每一条都是长期运行的教训）：
//   - 两阶段:事件先落库 pending,处理完才标 done——中断/重启原样重放,不丢事件;
//   - 直推:带 pickcode 的新增/变更事件直接写 STRM,日常一轮 0~1 个 115 请求;
//   - 抑制:整理/删除自产的事件(fid 在抑制表里)打 self 跳过,不重复处理;
//   - 永久/临时跳过:目录已删(gone)标 done 不再重试;风控读不到整轮保持 pending;
//   - 浅扫优先:文件事件只列父目录一层;新目录按预算逐层补扫;
//   - 游标纪律:有失败/让路/占用一律不推进,下一轮重放(幂等)。
//
// Source 是增量消费需要的能力，便于测试注入假实现。
type Source interface {
	ListBehavior(ctx context.Context, accountID int64, limit int) ([]pan115.LifeEvent, error)
	ScanDir(ctx context.Context, lib *store.Library, cid string) (scan.Result, error)
}

// Yielder 可选能力:礼让锁状态查询(生产实现是 p115svc,测试可不给)。
type Yielder interface {
	YieldRequested() bool
}

// ErrBusy 表示 115 通道被占用;增量整轮放弃,事件保持 pending 下轮重放。
var ErrBusy = errors.New("115 通道被占用，本轮增量让路")

type Service struct {
	Store    *store.Store
	Src      Source
	Log      *slog.Logger
	Interval time.Duration

	mu     sync.Mutex
	status Status
	rounds []Round // 最近 50 轮"有事"的轮次;空转只计数
	idle   int     // 连续空转轮数
}

// Status 是增量同步的对外状态。
type Status struct {
	Enabled     bool   `json:"enabled"`
	IntervalSec int    `json:"intervalSec"`
	Cursor      string `json:"cursor"`
	LastRun     int64  `json:"lastRun"`
	LastResult  Result `json:"lastResult"`
	LastError   string `json:"lastError"`
	Pending     int    `json:"pending"`
	IdleRounds  int    `json:"idleRounds"`
}

type Result struct {
	Events      int    `json:"events"`
	NewEvents   int    `json:"newEvents"`
	Direct      int    `json:"direct"`
	ScannedDirs int    `json:"scannedDirs"`
	Baseline    bool   `json:"baseline"`
	Errors      int    `json:"errors"`
	Busy        bool   `json:"busy,omitempty"`
	Yielded     bool   `json:"yielded,omitempty"`
}

// Round 是一轮消费的账单(轮次历史,回答"为什么没同步")。
type Round struct {
	At       int64  `json:"at"`
	Cursor   string `json:"cursor"`
	Events   int    `json:"events"`
	New      int    `json:"new"`
	Direct   int    `json:"direct"`
	Dirs     int    `json:"dirs"`
	Errors   int    `json:"errors"`
	Busy     bool   `json:"busy,omitempty"`
	Yielded  bool   `json:"yielded,omitempty"`
	Baseline bool   `json:"baseline,omitempty"`
	Note     string `json:"note,omitempty"`
}

const maxRounds = 50

func (s *Service) Start(ctx context.Context) {
	go func() {
		// 首轮延迟几秒，等进程完成初始化
		select {
		case <-ctx.Done():
			return
		case <-time.After(5 * time.Second):
		}
		for {
			if s.enabled() {
				r, err := s.PollOnce(ctx)
				if err != nil {
					s.Log.Warn("生活事件轮询失败", "err", err)
				} else if !r.Baseline && (r.NewEvents > 0 || r.ScannedDirs > 0 || r.Direct > 0) {
					s.Log.Info("增量同步", "events", r.Events, "new", r.NewEvents,
						"direct", r.Direct, "dirs", r.ScannedDirs)
				}
			}
			wait := time.Duration(s.intervalSec()) * time.Second
			if wait < 5*time.Second {
				wait = 5 * time.Second
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(wait):
			}
		}
	}()
}

func (s *Service) enabled() bool {
	return s.Store.GetSetting("incr_enabled", "1") == "1"
}

func (s *Service) intervalSec() int {
	if v := s.Store.GetSetting("incr_interval_sec", ""); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 15 && n <= 3600 {
			return n
		}
	}
	if s.Interval > 0 {
		return int(s.Interval.Seconds())
	}
	return 30
}

// Rounds 返回最近轮次历史(只读副本)。
func (s *Service) Rounds() []Round {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Round, len(s.rounds))
	copy(out, s.rounds)
	return out
}

// Status 返回增量同步状态。
func (s *Service) Status() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := s.status
	st.Enabled = s.enabled()
	st.IntervalSec = s.intervalSec()
	if acc, err := s.Store.MainAccount(); err == nil {
		st.Cursor = s.Store.GetSetting(cursorKey(acc.ID), "")
		st.Pending, _ = s.Store.CountPendingEvents(acc.ID)
	}
	st.IdleRounds = s.idle
	return st
}

// TestEvents 只读拉取最近事件，不推进游标、不落库。
func (s *Service) TestEvents(ctx context.Context, limit int) ([]pan115.LifeEvent, error) {
	acc, err := s.Store.MainAccount()
	if err != nil {
		return nil, errors.New("还没有 115 账号")
	}
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	return s.Src.ListBehavior(ctx, acc.ID, limit)
}

// AdvanceCursorPastPending 全量同步收口:把台账里最大的事件 id 设为游标,
// pending 事件全部标 done——全量已补齐窗口内的文件,增量不必再扫。
func (s *Service) AdvanceCursorPastPending() {
	acc, err := s.Store.MainAccount()
	if err != nil {
		return
	}
	if max := s.Store.MaxEventID(acc.ID); max != "" && idNewer(max, s.Store.GetSetting(cursorKey(acc.ID), "")) {
		_ = s.Store.SetSetting(cursorKey(acc.ID), max)
	}
	_ = s.Store.MarkAllEventsApplied(acc.ID, "covered-by-full")
}

// noteRound 记录轮次账单:空转只计数不入列,"为什么没动静"靠失败轮回答。
func (s *Service) noteRound(res Result, err error) {
	r := Round{
		At: time.Now().Unix(), Events: res.Events, New: res.NewEvents,
		Direct: res.Direct, Dirs: res.ScannedDirs, Errors: res.Errors,
		Busy: res.Busy, Yielded: res.Yielded, Baseline: res.Baseline,
	}
	if err != nil {
		r.Note = err.Error()
	}
	busy := r.Events > 0 || r.New > 0 || r.Direct > 0 || r.Dirs > 0 || r.Errors > 0 ||
		r.Busy || r.Yielded || r.Baseline || r.Note != ""
	if busy {
		s.idle = 0
		s.rounds = append(s.rounds, r)
		if len(s.rounds) > maxRounds {
			s.rounds = s.rounds[len(s.rounds)-maxRounds:]
		}
	} else {
		s.idle++
	}
}

func (s *Service) PollOnce(ctx context.Context) (res Result, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	defer func() {
		s.status.LastRun = time.Now().Unix()
		s.status.LastResult = res
		if err != nil {
			s.status.LastError = err.Error()
		} else {
			s.status.LastError = ""
		}
		s.noteRound(res, err)
	}()

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

	libByCID := s.indexDirs()
	seen := map[string]bool{}
	type target struct {
		lib *store.Library
		cid string
	}
	targets := map[string]target{}
	eventsByCID := map[string][]int64{} // cid → 本轮相关事件行 id
	cidEventTotal := map[string]int{}   // cid → 事件数
	cidPushed := map[string]int{}       // cid → 已直推数

	var (
		applyIDs   []int64 // 正常处理完成
		selfIDs    []int64 // 整理/删除自产,抑制跳过
		outsideIDs []int64 // 不涉及媒体库
	)

	// 第一遍:落库(pending)+ 抑制批量查询
	var newFIDs []string
	type evRow struct {
		ev pan115.LifeEvent
		id int64
	}
	var rows []evRow
	for _, ev := range events {
		if !idNewer(ev.ID, cursor) {
			break // 事件按新 → 旧返回，命中游标即停
		}
		rowID, isNew, verr := s.Store.AddEventPending(acc.ID, ev.ID, ev.Type, ev.FileName, ev.Pickcode)
		if verr != nil {
			res.Errors++
			continue
		}
		if isNew {
			res.NewEvents++
		}
		rows = append(rows, evRow{ev: ev, id: rowID})
		if ev.FileID != "" {
			newFIDs = append(newFIDs, ev.FileID)
		}
	}
	suppressed, _ := s.Store.PeekSuppressed(newFIDs)

	// 第二遍:分类
	dirsCache := map[int64]map[string]string{} // libID → cid → relPath
	for _, r := range rows {
		ev := r.ev
		if ev.FileID != "" && seen[ev.FileID] {
			// 同一文件的多条事件:已有一条在处理,这条记 done 即可
			applyIDs = append(applyIDs, r.id)
			continue
		}
		seen[ev.FileID] = true
		if ev.FileID != "" && suppressed[ev.FileID] {
			selfIDs = append(selfIDs, r.id)
			continue
		}
		if ev.CID == "" {
			outsideIDs = append(outsideIDs, r.id)
			continue
		}
		t, ok := libByCID[ev.CID]
		if !ok {
			outsideIDs = append(outsideIDs, r.id)
			continue
		}
		eventsByCID[ev.CID] = append(eventsByCID[ev.CID], r.id)
		cidEventTotal[ev.CID]++
		targets[fmt.Sprintf("%d|%s", t.lib.ID, ev.CID)] = target{lib: t.lib, cid: ev.CID}

		// 直推判定:新增/变更类 + 带 pickcode + 是视频扩展名 + 路径已知
		if ev.Pickcode != "" && !isDeleteEvent(ev) && t.lib.BaseURL != "" &&
			isVideoName(ev.FileName, splitExts(t.lib.VideoExts)) {
			rel := ""
			known := ev.CID == t.lib.RemoteCID // 库根本身,相对路径为空
			if !known {
				rels := s.dirsOf(t.lib, dirsCache)
				rel, known = rels[ev.CID]
			}
			if known && s.writeDirect(t.lib, rel, ev) {
				res.Direct++
				cidPushed[ev.CID]++
				applyIDs = append(applyIDs, r.id)
				continue
			}
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
		// 该目录的事件已全部直推完成 → 不再列目录
		if cidPushed[t.cid] >= cidEventTotal[t.cid] {
			continue
		}
		// 礼让查点：手动任务入队后,增量就地收工,事件保持 pending。
		if y, ok := s.Src.(Yielder); ok && y.YieldRequested() {
			res.Yielded = true
			break
		}
		sr, serr := s.Src.ScanDir(ctx, t.lib, t.cid)
		if serr != nil {
			if errors.Is(serr, ErrBusy) {
				// 扫描等重活占着锁(或有人在排队),整轮放弃,游标不推进。
				res.Busy = true
				break
			}
			if isGoneError(serr) {
				// 目录已删:永久跳过,事件标 done 不再重试
				applyIDs = append(applyIDs, eventsByCID[t.cid]...)
				s.Log.Info("增量目标目录已不存在", "library", t.lib.Name, "cid", t.cid)
				continue
			}
			res.Errors++
			s.Log.Warn("增量扫描目录失败", "library", t.lib.Name, "cid", t.cid, "err", serr)
			continue
		}
		res.ScannedDirs++
		n++
		applyIDs = append(applyIDs, eventsByCID[t.cid]...)
		// 新发现的子目录按预算补扫(浅扫扩展),避免"丢个文件夹进去要等全量"
		for i, nd := range sr.DirNew {
			if i >= 5 || ctx.Err() != nil {
				break
			}
			if y, ok := s.Src.(Yielder); ok && y.YieldRequested() {
				res.Yielded = true
				break
			}
			if _, err := s.Src.ScanDir(ctx, t.lib, nd.CID); err != nil {
				if errors.Is(err, ErrBusy) {
					res.Busy = true
					break
				}
				res.Errors++
				continue
			}
			res.ScannedDirs++
		}
	}

	// 分组落状态:已处理/self/outside 标 done;失败、让路、占用的保持 pending
	if len(selfIDs) > 0 {
		_ = s.Store.ApplyEvents(selfIDs, "self")
	}
	if len(outsideIDs) > 0 {
		_ = s.Store.ApplyEvents(outsideIDs, "outside")
	}
	if len(applyIDs) > 0 {
		_ = s.Store.ApplyEvents(applyIDs, "")
	}

	// 有失败、让路或目标目录超过单轮上限时不推进游标，下一轮继续。
	if res.Errors == 0 && !res.Busy && !res.Yielded && len(targets) <= maxDirs {
		_ = s.Store.SetSetting(cursorKey(acc.ID), latest)
	}
	return res, nil
}

// writeDirect 直推:事件自带 pickcode,不列目录直接写 STRM。
// 返回 false 表示无法直推(路径未知等),留给目录扫描兜底。
func (s *Service) writeDirect(lib *store.Library, relDir string, ev pan115.LifeEvent) bool {
	ext := strings.ToLower(_ext(ev.FileName))
	p := strm.STRNPath(lib.LocalDir, relDir, ev.FileName, lib.KeepExt)
	url := pan115.STRM(lib.BaseURL, lib.STRMFormat,
		pan115.STRMID("", ev.Pickcode, ext, lib.KeepExt, isISOName(ev.FileName)), ev.FileName)
	if _, err := strm.Write(p, url); err != nil {
		return false
	}
	_ = s.Store.UpsertFile(&store.SyncedFile{
		LibraryID: lib.ID, FID: ev.FileID, Pickcode: ev.Pickcode, CID: ev.CID,
		Name: ev.FileName, RelPath: _joinRel(relDir, ev.FileName), STRMPath: p,
		Size: ev.Size, Status: "ok",
	})
	return true
}

// dirsOf 读取库的 cid → 相对路径表(每轮每库只读一次)。
func (s *Service) dirsOf(lib *store.Library, cache map[int64]map[string]string) map[string]string {
	if m, ok := cache[lib.ID]; ok {
		return m
	}
	m := map[string]string{}
	if dirs, err := s.Store.ListDirs(lib.ID); err == nil {
		for _, d := range dirs {
			m[d.CID] = d.RelPath
		}
	}
	cache[lib.ID] = m
	return m
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

// isDeleteEvent 判断事件是否删除类——删除事件不能直推(文件已不在,
// 直推会写出一个死链 STRM),交给目录扫描/全量兜底。
// 数字类型码语义无法确认,只对带语义的类型名生效。
func isDeleteEvent(ev pan115.LifeEvent) bool {
	t := strings.ToLower(ev.Type)
	return strings.Contains(t, "del") || strings.Contains(t, "remov") || strings.Contains(t, "trash")
}

// isGoneError 识别"目录已不存在"类错误(永久跳过);风控/网络错误是临时的。
func isGoneError(err error) bool {
	if err == nil {
		return false
	}
	s := err.Error()
	return strings.Contains(s, "不存在") || strings.Contains(s, "ErrDirGone")
}

func splitExts(s string) map[string]bool {
	out := map[string]bool{}
	for _, p := range strings.FieldsFunc(s, func(r rune) bool { return r == ',' || r == ' ' || r == ';' }) {
		p = strings.ToLower(strings.TrimSpace(p))
		if !strings.HasPrefix(p, ".") {
			p = "." + p
		}
		if p != "." {
			out[p] = true
		}
	}
	return out
}

func isVideoName(name string, exts map[string]bool) bool {
	return exts[strings.ToLower(_ext(name))]
}

func _ext(name string) string {
	i := strings.LastIndexByte(name, '.')
	if i < 0 {
		return ""
	}
	return name[i:]
}

func isISOName(name string) bool { return strings.EqualFold(_ext(name), ".iso") }

func _joinRel(dir, name string) string {
	if dir == "" {
		return name
	}
	return dir + "/" + name
}
