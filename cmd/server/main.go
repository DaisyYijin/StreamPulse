package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"streampulse/internal/api"
	"streampulse/internal/backup"
	"streampulse/internal/config"
	"streampulse/internal/embyproxy"
	"streampulse/internal/deepdel"
	"streampulse/internal/incr"
	"streampulse/internal/logx"
	"streampulse/internal/safego"
	"streampulse/internal/p115svc"
	"streampulse/internal/scheduler"
	"streampulse/internal/store"
	"streampulse/internal/stream"
)

// version 由构建注入:go build -ldflags "-X main.version=0.2.0"
var version = "dev"

type streamProvider struct{ svc *p115svc.Service }

func (p streamProvider) DownloadURL(ctx context.Context, pickcode string) (string, error) {
	return p.svc.MainDownloadURL(ctx, pickcode)
}

func main() {
	cfg := config.Load()

	// 一次性重置管理员密码：保留账号、媒体库与设置，只清掉登录凭据。
	// 用法：docker compose run --rm streampulse --reset-admin
	if len(os.Args) > 1 && os.Args[1] == "--reset-admin" {
		st, err := store.Open(cfg.DataDir)
		if err != nil {
			fmt.Fprintln(os.Stderr, "打开数据库失败:", err)
			os.Exit(1)
		}
		defer st.Close()
		if err := st.SetSetting("admin_password_hash", ""); err != nil {
			fmt.Fprintln(os.Stderr, "重置失败:", err)
			os.Exit(1)
		}
		if err := st.SetSetting("admin_initialized", ""); err != nil {
			fmt.Fprintln(os.Stderr, "重置失败:", err)
			os.Exit(1)
		}
		fmt.Println("管理员密码已清空。重启容器后打开网页，会重新进入「创建管理员」页面。")
		return
	}

	if msg := cfg.Validate(); msg != "" {
		slog.Error("配置错误", "error", msg)
		os.Exit(1)
	}
	// 待恢复备份在开库之前应用(先给现库留 prerestore 备份)
	backup.ApplyPendingRestore(cfg.DataDir, cfg.ConfigDir,
		filepath.Join(cfg.ConfigDir, "restore-pending"), slog.Default())
	closeLog, err := logx.Init(cfg.LogDir, cfg.LogMaxMB, cfg.LogKeepDays)
	if err != nil {
		slog.Warn("日志文件不可写，只输出到 stdout", "err", err)
		closeLog = func() error { return nil }
	}
	defer closeLog()

	log := slog.Default()
	log.Info("StreamPulse 启动", "port", cfg.Port, "streamPort", cfg.StreamPort, "playMode", cfg.PlayMode)

	st, err := store.Open(cfg.DataDir)
	if err != nil {
		log.Error("打开数据库失败", "err", err)
		os.Exit(1)
	}
	defer st.Close()

	svc := p115svc.New(st, cfg)
	deep := &deepdel.Service{Store: st, Svc: svc, Log: log}
	incremental := &incr.Service{Store: st, Src: svc, Log: log, Interval: cfg.IncrInterval}
	if !cfg.IncrEnabled && st.GetSetting("incr_enabled", "") == "" {
		_ = st.SetSetting("incr_enabled", "0")
	}
	// 启动自愈:上次进程中断遗留的 running 任务标为 failed
	if err := st.RecoverStuckTasks(); err != nil {
		log.Warn("恢复遗留任务状态失败", "err", err)
	}
	app, err := api.New(cfg, st, svc, deep, incremental, log)
	if err != nil {
		log.Error("初始化 API 失败", "err", err)
		os.Exit(1)
	}

	apiSrv := &http.Server{
		Addr:              ":" + strconv.Itoa(cfg.Port),
		Handler:           app.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	streamSrv := &http.Server{
		Addr:              ":" + strconv.Itoa(cfg.StreamPort),
		Handler:           stream.New(streamProvider{svc: svc}, cfg.PlayMode, log).Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	// Emby 反代(可选):EMBY_PROXY_PORT 非零时开启,PlaybackInfo 直连改写
	var embyProxySrv *http.Server
	if cfg.EmbyProxyPort != 0 {
		proxyConf := func() embyproxy.Config {
			e := st.GetEmbyConfig()
			return embyproxy.Config{Base: e.Base, Key: e.APIKey}
		}
		embyProxySrv = &http.Server{
			Addr:              ":" + strconv.Itoa(cfg.EmbyProxyPort),
			Handler:           embyproxy.New(proxyConf, streamProvider{svc: svc}, cfg.MediaDir, log).Handler(),
			ReadHeaderTimeout: 10 * time.Second,
		}
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Info("管理后台监听", "addr", apiSrv.Addr)
		if err := apiSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("管理后台退出", "err", err)
			stop()
		}
	}()
	go func() {
		log.Info("播放端口监听", "addr", streamSrv.Addr)
		if err := streamSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("播放端口退出", "err", err)
			stop()
		}
	}()
	if embyProxySrv != nil {
		go func() {
			log.Info("Emby 反代监听（PlaybackInfo 直连改写）", "addr", embyProxySrv.Addr)
			if err := embyProxySrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
				log.Error("Emby 反代退出", "err", err)
				stop()
			}
		}()
	}

	scheduler.New(st, log).Start(ctx)
	app.StartWorkers(ctx)
	app.SetVersion(version)
	incremental.Start(ctx)
	log.Info("生活事件增量已启动", "interval", cfg.IncrInterval, "version", version)

	// 每日维护:过期抑制清理、已消费事件清理、深删记录清理
	safego.Go("daily-maintenance", log, func() {
		t := time.NewTicker(24 * time.Hour)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				if n, err := st.CleanupSuppressed(); err != nil {
					log.Warn("清理事件抑制失败", "err", err)
				} else if n > 0 {
					log.Info("清理过期事件抑制", "count", n)
				}
				if n, err := st.PruneAppliedEvents(30); err == nil && n > 0 {
					log.Info("清理已消费事件", "count", n)
				}
				if n, err := st.PruneDeepDeleteRecords(90); err == nil && n > 0 {
					log.Info("清理过期深删记录", "count", n)
				}
			}
		}
	})

	<-ctx.Done()
	log.Info("正在关闭…")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = apiSrv.Shutdown(shutdownCtx)
	_ = streamSrv.Shutdown(shutdownCtx)
	if embyProxySrv != nil {
		_ = embyProxySrv.Shutdown(shutdownCtx)
	}
}
