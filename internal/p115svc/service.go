package p115svc

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"streampulse/internal/config"
	"streampulse/internal/pan115"
	"streampulse/internal/scan"
	"streampulse/internal/store"
)

// Service 负责把台账里的账号变成可用的 115 客户端，并串行化扫描。
type Service struct {
	Store *store.Store
	Cfg   *config.Config

	mu      sync.Mutex
	clients map[int64]*pan115.Client
	scanMu  sync.Mutex // 视频串行：同一进程内扫描不并发
}

func New(st *store.Store, cfg *config.Config) *Service {
	return &Service{Store: st, Cfg: cfg, clients: map[int64]*pan115.Client{}}
}

func (s *Service) Client(accountID int64) (*pan115.Client, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if c, ok := s.clients[accountID]; ok {
		if cr := c.Credential(); cr.AccessToken == "" || cr.ExpiresAt == 0 || time.Now().Unix() < cr.ExpiresAt-120 {
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
	s.clients[accountID] = c
	return c, nil
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

// ScanLibrary 执行一次完整扫描。串行锁保证视频请求不会互相打爆 115。
func (s *Service) ScanLibrary(ctx context.Context, lib *store.Library) (scan.Result, error) {
	s.scanMu.Lock()
	defer s.scanMu.Unlock()
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
	})
}

// ScanDir 供「目录行同步 STRM」。
func (s *Service) ScanDir(ctx context.Context, lib *store.Library, cid string) (scan.Result, error) {
	s.scanMu.Lock()
	defer s.scanMu.Unlock()
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
