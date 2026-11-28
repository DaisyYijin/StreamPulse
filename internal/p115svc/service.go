package p115svc

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"sync"
	"time"

	"streampulse/internal/config"
	"streampulse/internal/incr"
	"streampulse/internal/pan115"
	"streampulse/internal/scan"
	"streampulse/internal/store"
	"streampulse/internal/synclock"
)

// Service 负责把台账里的账号变成可用的 115 客户端，并串行化扫描。
type Service struct {
	Store *store.Store
	Cfg   *config.Config

	mu      sync.Mutex
	clients map[int64]*pan115.Client
	Sync    *synclock.Lock // 重活互斥：扫描/增量/目录同步同一把礼让锁
}

func New(st *store.Store, cfg *config.Config) *Service {
	return &Service{Store: st, Cfg: cfg, clients: map[int64]*pan115.Client{}, Sync: synclock.New()}
}

// SyncStatus 供状态页展示"被谁占着、占多久、几个人在等"。
func (s *Service) SyncStatus() synclock.Status { return s.Sync.Describe() }

// RequestYield 让正在跑的重活尽快收工（增量请求让路时用）。
func (s *Service) RequestYield() { s.Sync.RequestYield() }

// ThrottleStatus 返回当前账号客户端的节流/熔断状态;没有缓存客户端时返回 nil。
func (s *Service) ThrottleStatus() *pan115.ThrottleStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, c := range s.clients {
		st := c.ThrottleStatus()
		return &st
	}
	return nil
}

func (s *Service) Client(accountID int64) (*pan115.Client, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if c, ok := s.clients[accountID]; ok {
		if cr := c.Credential(); cr.AccessToken == "" || cr.ExpiresAt == 0 || time.Now().Unix() < cr.ExpiresAt-120 {
			s.applyIntervals(c)
			return c, nil
		}
	}
	acc, err := s.Store.GetAccount(accountID)
	if err != nil {
		return nil, err
	}
	cr := pan115.Credential{
		Cookie:       acc.Cookie,
		AccessToken:  acc.AccessToken,
		RefreshToken: acc.RefreshToken,
		ExpiresAt:    acc.ExpiresAt,
		AppID:        acc.AppID,
		UID:          acc.UID,
	}
	if cr.Cookie == "" && cr.AccessToken == "" {
		return nil, fmt.Errorf("账号 %s 没有可用凭据", acc.Name)
	}
	c := pan115.New(cr, s.Cfg.ReadEvery, s.Cfg.WriteEvery)
	if cr.Cookie == "" && cr.AccessToken != "" && cr.ExpiresAt > 0 && time.Now().Unix() >= cr.ExpiresAt-120 && cr.RefreshToken != "" {
		if err := c.RefreshOpenToken(context.Background()); err != nil {
			return nil, err
		}
		nc := c.Credential()
		acc.AccessToken, acc.RefreshToken, acc.ExpiresAt = nc.AccessToken, nc.RefreshToken, nc.ExpiresAt
		_, _ = s.Store.SaveAccount(acc)
	}
	s.applyIntervals(c)
	s.clients[accountID] = c
	return c, nil
}

// applyIntervals 把项目设置里的「API 等待时间（秒）」应用到 115 客户端。
// 设置保存后对缓存的客户端也立即生效。
func (s *Service) applyIntervals(c *pan115.Client) {
	sec := 1
	if v := s.Store.GetSetting("api_wait_sec", ""); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 1 && n <= 60 {
			sec = n
		}
	}
	read := time.Duration(sec) * time.Second
	write := read
	if write < 3*time.Second {
		write = 3 * time.Second
	}
	c.SetIntervals(read, write)
}

func (s *Service) Invalidate(accountID int64) {
	s.mu.Lock()
	delete(s.clients, accountID)
	s.mu.Unlock()
}

// MainDownloadURL 供播放端口使用。
func (s *Service) MainDownloadURL(ctx context.Context, pickcode string) (string, error) {
	acc, err := s.Store.MainAccount()
	if err != nil {
		return "", errors.New("还没有登录 115 账号")
	}
	c, err := s.Client(acc.ID)
	if err != nil {
		return "", err
	}
	return c.DownloadURL(ctx, pickcode)
}

// ScanLibrary 执行一次完整扫描。礼让锁保证同一进程内重活串行，
// 且扫描让路给排队中的增量（Yield 查点在 scan.Run 的目录循环里）。
func (s *Service) ScanLibrary(ctx context.Context, lib *store.Library) (scan.Result, error) {
	if err := s.Sync.Lock(ctx, "scan:"+lib.Name); err != nil {
		return scan.Result{}, err
	}
	defer s.Sync.Unlock()
	acc, err := s.Store.GetAccount(lib.AccountID)
	if err != nil {
		return scan.Result{}, err
	}
	c, err := s.Client(acc.ID)
	if err != nil {
		return scan.Result{}, err
	}
	uid := ""
	if acc.Role == "extra" {
		uid = acc.UID
	}
	return scan.Run(ctx, scan.Options{
		Library: lib,
		Source:  c,
		Store:   s.Store,
		UID:     uid,
		Yield:   s.Sync.YieldRequested,
	})
}

// ScanDir 供「目录行同步 STRM」与增量消费。
// 礼让锁有人排队（或已被重活占用）时礼貌让路，事件保持 pending 下轮重放。
func (s *Service) ScanDir(ctx context.Context, lib *store.Library, cid string) (scan.Result, error) {
	if !s.Sync.TryLockPolite("syncdir:" + lib.Name) {
		return scan.Result{}, incr.ErrBusy
	}
	defer s.Sync.Unlock()
	acc, err := s.Store.GetAccount(lib.AccountID)
	if err != nil {
		return scan.Result{}, err
	}
	c, err := s.Client(acc.ID)
	if err != nil {
		return scan.Result{}, err
	}
	uid := ""
	if acc.Role == "extra" {
		uid = acc.UID
	}
	return scan.ScanOneDir(ctx, scan.Options{Library: lib, Source: c, Store: s.Store, UID: uid}, cid)
}

// ErrBusy 表示礼让锁被占用且有人排队，本次礼貌放弃。
var ErrBusy = errors.New("有任务正在占用 115 通道，本轮已让路")

// ListRemoteDir 供目录选择器。
func (s *Service) ListRemoteDir(ctx context.Context, accountID int64, cid string) ([]pan115.Entry, error) {
	c, err := s.Client(accountID)
	if err != nil {
		return nil, err
	}
	return c.ListDir(ctx, cid)
}

// ListBehavior 读取 115 生活事件（供增量消费）。
func (s *Service) ListBehavior(ctx context.Context, accountID int64, limit int) ([]pan115.LifeEvent, error) {
	c, err := s.Client(accountID)
	if err != nil {
		return nil, err
	}
	return c.ListBehavior(ctx, limit)
}

// DeleteFiles 把网盘文件移入回收站（供深度删除）。
func (s *Service) DeleteFiles(ctx context.Context, accountID int64, fids []string) error {
	if len(fids) == 0 {
		return nil
	}
	c, err := s.Client(accountID)
	if err != nil {
		return err
	}
	return c.DeleteToRecycle(ctx, fids)
}
