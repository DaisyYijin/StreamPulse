package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"streampulse/internal/api"
	"streampulse/internal/config"
	"streampulse/internal/deepdel"
	"streampulse/internal/emby"
	"streampulse/internal/incr"
	"streampulse/internal/logx"
	"streampulse/internal/p115svc"
	"streampulse/internal/scheduler"
	"streampulse/internal/store"
	"streampulse/internal/stream"
)

type streamProvider struct{ svc *p115svc.Service }

func (p streamProvider) DownloadURL(ctx context.Context, pickcode string) (string, error) {
	return p.svc.MainDownloadURL(ctx, pickcode)
}

func main() {
	cfg := config.Load()
	if msg := cfg.Validate(); msg != "" {
		slog.Error("配置错误", "error", msg)
		os.Exit(1)
	}
	closeLog, err := logx.Init(cfg.LogDir)
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
	eb := emby.New(cfg.EmbyBase, cfg.EmbyKey)
	deep := &deepdel.Service{Store: st, Svc: svc, Log: log, DeleteRemote: cfg.EmbyDeleteRemote}
	app, err := api.New(cfg, st, svc, eb, deep, log)
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

	scheduler.New(st, svc, log).Start(ctx)
	if cfg.IncrEnabled {
		incremental := &incr.Service{Store: st, Src: svc, Log: log, Interval: cfg.IncrInterval}
		incremental.Start(ctx)
		log.Info("生活事件增量已启用", "interval", cfg.IncrInterval)
	}

	<-ctx.Done()
	log.Info("正在关闭…")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = apiSrv.Shutdown(shutdownCtx)
	_ = streamSrv.Shutdown(shutdownCtx)
}
