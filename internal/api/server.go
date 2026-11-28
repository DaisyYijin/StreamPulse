package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"streampulse/internal/adopt"
	"streampulse/internal/config"
	"streampulse/internal/deepdel"
	"streampulse/internal/emby"
	"streampulse/internal/eventbus"
	"streampulse/internal/incr"
	"streampulse/internal/p115svc"
	"streampulse/internal/pan115"
	"streampulse/internal/safego"
	"streampulse/internal/scan"
	"streampulse/internal/scrape"
	"streampulse/internal/store"
	"streampulse/internal/strm"
)

type App struct {
	Cfg   *config.Config
	Store *store.Store
	Svc   *p115svc.Service
	Deep  *deepdel.Service
	Incr  *incr.Service
	Log   *slog.Logger

	secret []byte

	qrMu  sync.Mutex
	qr    map[string]*pan115.QR
	opena map[string]*pan115.OpenAuth

	setupMu sync.Mutex

	// 任务队列:手动操作只入队(202),worker 串行执行
	executors map[string]func(ctx context.Context, t *store.Task)
	bus       *eventbus.Bus
	Scraper   *scrape.Service

	// Emby 定向刷新节流
	embyMu      sync.Mutex
	lastRefresh map[string]int64
}

func New(cfg *config.Config, st *store.Store, svc *p115svc.Service, deep *deepdel.Service, incrSvc *incr.Service, log *slog.Logger) (*App, error) {
	secret, err := loadSecret(cfg.ConfigDir)
	if err != nil {
		return nil, err
	}
	a := &App{
		Cfg: cfg, Store: st, Svc: svc, Deep: deep, Incr: incrSvc, Log: log, secret: secret,
		qr: map[string]*pan115.QR{}, opena: map[string]*pan115.OpenAuth{},
		bus: eventbus.New(), lastRefresh: map[string]int64{},
		Scraper: &scrape.Service{Store: st, Log: log},
	}
	a.registerExecutors()
	// 增量落盘 → 按库定向刷新 Emby(节流,防 30 秒一轮把 Emby 刷爆)
	if incrSvc != nil {
		incrSvc.OnSync = a.throttledEmbyRefresh
	}
	// 首次启动不生成密码：由 /api/setup 让用户自己创建管理员。
	return a, nil
}

// throttledEmbyRefresh 定向刷新节流:同一目录 10 分钟内只刷一次;
// 全库刷新由扫描任务自己负责,不走这里。
func (a *App) throttledEmbyRefresh(localDirs []string) {
	a.embyMu.Lock()
	now := time.Now().Unix()
	var pending []string
	for _, d := range localDirs {
		if now-a.lastRefresh[d] >= 600 {
			pending = append(pending, d)
			a.lastRefresh[d] = now
		}
	}
	a.embyMu.Unlock()
	for _, d := range pending {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		if err := a.emby().RefreshByPath(ctx, d); err != nil {
			a.Log.Warn("Emby 定向刷新失败", "dir", d, "err", err)
		}
		cancel()
	}
}

// Bus 暴露事件总线(同步完成 → 刮削 → 刷库 联动用)。
func (a *App) Bus() *eventbus.Bus { return a.bus }

// StartWorkers 启动后台任务 worker 与事件消费。ctx 结束即停。
func (a *App) StartWorkers(ctx context.Context) {
	safego.Go("task-worker", a.Log, func() {
		for {
			select {
			case <-ctx.Done():
				return
			default:
			}
			t, err := a.Store.ClaimNextTask()
			if err != nil {
				a.Log.Warn("取任务失败", "err", err)
				sleepCtx(ctx, 2*time.Second)
				continue
			}
			if t == nil {
				sleepCtx(ctx, 2*time.Second)
				continue
			}
			safego.Go("task:"+t.Kind, a.Log, func() { a.runTask(ctx, t) })
		}
	})
}

func (a *App) runTask(ctx context.Context, t *store.Task) {
	exec, ok := a.executors[t.Kind]
	if !ok {
		_ = a.Store.UpdateTask(t.ID, "failed", "未知任务类型: "+t.Kind)
		return
	}
	tctx, cancel := context.WithTimeout(ctx, taskTimeout(t.Kind))
	defer cancel()
	exec(tctx, t)
}

func taskTimeout(kind string) time.Duration {
	switch kind {
	case "sync-dir":
		return 2 * time.Hour
	case "scrape":
		return 4 * time.Hour
	default:
		return 12 * time.Hour
	}
}

// handleScrape 手动刮削:入队(重复点击合并)。
func (a *App) handleScrape(w http.ResponseWriter, r *http.Request) {
	id, _ := parseInt64(r.PathValue("id"))
	if _, err := a.Store.GetLibrary(id); err != nil {
		writeErr(w, http.StatusNotFound, "媒体库不存在")
		return
	}
	if a.Store.GetSetting("tmdb_api_key", "") == "" {
		writeErr(w, http.StatusBadRequest, "请先在设置页填写 TMDB API Key")
		return
	}
	payload, _ := json.Marshal(scrapePayload{LibraryID: id})
	taskID, reused, err := a.Store.EnqueueTask("scrape", id, fmt.Sprintf("scrape:%d", id), string(payload))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"taskId": taskID, "reused": reused})
}

func (a *App) execScrape(ctx context.Context, t *store.Task) {
	var p scrapePayload
	_ = json.Unmarshal([]byte(t.Payload), &p)
	lib, err := a.Store.GetLibrary(p.LibraryID)
	if err != nil {
		_ = a.Store.UpdateTask(t.ID, "failed", "媒体库不存在（可能已被删除）")
		return
	}
	_ = a.Store.SetTaskProgress(t.ID, "刮削中 "+lib.Name)
	sum, err := a.Scraper.ScrapeLibrary(ctx, lib.ID, "")
	if err != nil {
		_ = a.Store.UpdateTask(t.ID, "failed", err.Error())
		return
	}
	if err := a.emby().RefreshByPath(ctx, lib.LocalDir); err != nil {
		a.Log.Warn("刮削后 Emby 刷新失败", "err", err)
	}
	msg := fmt.Sprintf("刮削完成：成功 %d，失败 %d，已存在 %d", sum.OK, sum.Failed, sum.Skipped)
	if len(sum.Details) > 0 && sum.Failed > 0 {
		msg += "；" + strings.Join(sum.Details[:minInt(3, len(sum.Details))], "；")
	}
	_ = a.Store.UpdateTask(t.ID, "done", msg)
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func sleepCtx(ctx context.Context, d time.Duration) {
	select {
	case <-ctx.Done():
	case <-time.After(d):
	}
}

// initialized 以显式注册标记为准：旧版本自动生成的密码哈希不算注册完成。
func (a *App) initialized() bool {
	return a.Store.GetSetting("admin_initialized", "") == "1"
}

func (a *App) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /", a.handleIndex)
	mux.HandleFunc("GET /api/setup/status", a.handleSetupStatus)
	mux.HandleFunc("POST /api/setup", a.handleSetup)
	mux.HandleFunc("POST /api/login", a.handleLogin)
	mux.HandleFunc("POST /api/emby/webhook", a.handleEmbyWebhook)

	auth := a.requireAuth

	mux.Handle("GET /api/status", auth(http.HandlerFunc(a.handleStatus)))
	mux.Handle("POST /api/logout", auth(http.HandlerFunc(a.handleLogout)))

	mux.Handle("GET /api/accounts", auth(http.HandlerFunc(a.handleAccounts)))
	mux.Handle("POST /api/accounts/qrcode", auth(http.HandlerFunc(a.handleQRStart)))
	mux.Handle("GET /api/accounts/qrcode/{uid}", auth(http.HandlerFunc(a.handleQRPoll)))
	mux.Handle("GET /api/accounts/qrcode/{uid}/image", auth(http.HandlerFunc(a.handleQRByUID)))
	mux.Handle("GET /api/qr", auth(http.HandlerFunc(a.handleQRImage)))
	mux.Handle("POST /api/accounts/open/start", auth(http.HandlerFunc(a.handleOpenStart)))
	mux.Handle("GET /api/accounts/open/{uid}", auth(http.HandlerFunc(a.handleOpenPoll)))
	mux.Handle("DELETE /api/accounts/{id}", auth(http.HandlerFunc(a.handleAccountDelete)))
	mux.Handle("POST /api/accounts/refresh", auth(http.HandlerFunc(a.handleRefreshAccount)))
	mux.Handle("POST /api/accounts/115/logout", auth(http.HandlerFunc(a.handleLogout115)))

	mux.Handle("GET /api/dirs", auth(http.HandlerFunc(a.handleDirs)))

	mux.Handle("GET /api/libraries", auth(http.HandlerFunc(a.handleListLibraries)))
	mux.Handle("POST /api/libraries", auth(http.HandlerFunc(a.handleSaveLibrary)))
	mux.Handle("GET /api/libraries/{id}", auth(http.HandlerFunc(a.handleGetLibrary)))
	mux.Handle("DELETE /api/libraries/{id}", auth(http.HandlerFunc(a.handleDeleteLibrary)))
	mux.Handle("POST /api/libraries/{id}/scan", auth(http.HandlerFunc(a.handleScan)))
	mux.Handle("POST /api/libraries/{id}/sync-dir", auth(http.HandlerFunc(a.handleSyncDir)))
	mux.Handle("POST /api/libraries/{id}/scrape", auth(http.HandlerFunc(a.handleScrape)))
	mux.Handle("GET /api/sync/status", auth(http.HandlerFunc(a.handleSyncStatus)))
	mux.Handle("GET /api/sync/rounds", auth(http.HandlerFunc(a.handleSyncRounds)))
	mux.Handle("POST /api/sync/full", auth(http.HandlerFunc(a.handleFullSync)))
	mux.Handle("POST /api/sync/incremental", auth(http.HandlerFunc(a.handleIncremental)))
	mux.Handle("POST /api/sync/incremental/test", auth(http.HandlerFunc(a.handleIncrementalTest)))
	mux.Handle("PUT /api/sync/settings", auth(http.HandlerFunc(a.handleSyncSettings)))
	mux.Handle("GET /api/libraries/{id}/orphans", auth(http.HandlerFunc(a.handleOrphans)))
	mux.Handle("POST /api/libraries/{id}/orphans/clean", auth(http.HandlerFunc(a.handleOrphanClean)))
	mux.Handle("POST /api/strm/rebase", auth(http.HandlerFunc(a.handleStrmRebase)))
	mux.Handle("POST /api/adopt/preview", auth(http.HandlerFunc(a.handleAdoptPreview)))
	mux.Handle("POST /api/adopt/apply", auth(http.HandlerFunc(a.handleAdoptApply)))

	mux.Handle("GET /api/tasks", auth(http.HandlerFunc(a.handleTasks)))
	mux.Handle("GET /api/emby/status", auth(http.HandlerFunc(a.handleEmbyStatus)))
	mux.Handle("GET /api/emby/webhook/status", auth(http.HandlerFunc(a.handleWebhookStatus)))
	mux.Handle("GET /api/deepdel/records", auth(http.HandlerFunc(a.handleDeepDelRecords)))
	mux.Handle("GET /api/settings", auth(http.HandlerFunc(a.handleGetSettings)))
	mux.Handle("PUT /api/settings", auth(http.HandlerFunc(a.handleSaveSettings)))

	return securityHeaders(mux)
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy",
			"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'")
		next.ServeHTTP(w, r)
	})
}

func (a *App) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tok := ""
		if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
			tok = strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
		}
		if tok == "" {
			if c, err := r.Cookie("sp_token"); err == nil {
				tok = c.Value
			}
		}
		if tok == "" {
			writeErr(w, http.StatusUnauthorized, "未登录")
			return
		}
		if _, err := parseToken(a.secret, tok); err != nil {
			writeErr(w, http.StatusUnauthorized, err.Error())
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ---------- auth ----------

func (a *App) handleSetupStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]bool{"initialized": a.initialized()})
}

// handleSetup 只在尚未初始化时可用：创建管理员并直接登录。
func (a *App) handleSetup(w http.ResponseWriter, r *http.Request) {
	a.setupMu.Lock()
	defer a.setupMu.Unlock()
	if a.initialized() {
		writeErr(w, http.StatusConflict, "已经初始化，请直接登录")
		return
	}
	var in struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Confirm  string `json:"confirm"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&in); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if in.Password != in.Confirm {
		writeErr(w, http.StatusBadRequest, "两次输入的密码不一致")
		return
	}
	if len(in.Password) < 8 {
		writeErr(w, http.StatusBadRequest, "密码至少 8 位")
		return
	}
	user := strings.TrimSpace(in.Username)
	if user == "" {
		user = "admin"
	}
	if len(user) > 64 {
		writeErr(w, http.StatusBadRequest, "用户名过长")
		return
	}
	if err := a.Store.SetSetting("admin_user", user); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := a.Store.SetSetting("admin_password_hash", hashPassword(in.Password)); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := a.Store.SetSetting("admin_initialized", "1"); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	tok := issueToken(a.secret, user, 8*24*time.Hour)
	http.SetCookie(w, &http.Cookie{
		Name: "sp_token", Value: tok, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode,
		MaxAge: 8 * 24 * 3600,
	})
	a.Log.Info("管理员账号已创建", "username", user)
	writeJSON(w, http.StatusOK, map[string]string{"token": tok})
}

func (a *App) handleLogin(w http.ResponseWriter, r *http.Request) {
	if !a.initialized() {
		writeErr(w, http.StatusConflict, "请先创建管理员账号")
		return
	}
	var in struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&in); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	wantUser := a.Store.GetSetting("admin_user", "admin")
	wantHash := a.Store.GetSetting("admin_password_hash", "")
	if in.Username != wantUser || !verifyPassword(in.Password, wantHash) {
		writeErr(w, http.StatusUnauthorized, "用户名或密码错误")
		return
	}
	tok := issueToken(a.secret, wantUser, 8*24*time.Hour)
	http.SetCookie(w, &http.Cookie{
		Name: "sp_token", Value: tok, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode,
		MaxAge: 8 * 24 * 3600,
	})
	writeJSON(w, http.StatusOK, map[string]string{"token": tok})
}

func (a *App) handleLogout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: "sp_token", Value: "", Path: "/", MaxAge: -1})
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// ---------- status ----------

func (a *App) handleStatus(w http.ResponseWriter, r *http.Request) {
	accs, _ := a.Store.ListAccounts()
	libs, _ := a.Store.ListLibraries()
	files, orphans, lastScan, _ := a.Store.Stats()
	writeJSON(w, http.StatusOK, map[string]any{
		"version":   "0.1.0-p0",
		"accounts":  len(accs),
		"libraries": len(libs),
		"files":     files,
		"orphans":   orphans,
		"lastScan":  lastScan,
		"emby":      a.emby().Enabled(),
		"playMode":  a.Cfg.PlayMode,
	})
}

// ---------- accounts ----------

func (a *App) handleAccounts(w http.ResponseWriter, r *http.Request) {
	accs, err := a.Store.ListAccounts()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, accs)
}

func mergeProfile(dst *pan115.Profile, src *pan115.Profile) {
	if src.Name != "" {
		dst.Name = src.Name
	}
	if src.Face != "" {
		dst.Face = src.Face
	}
	if src.UserID != 0 {
		dst.UserID = src.UserID
	}
	if src.Total > 0 {
		dst.Total, dst.Used = src.Total, src.Used
	}
	if src.Expire > 0 {
		dst.Expire, dst.Forever = src.Expire, src.Forever
	}
	if src.VIP != 0 {
		dst.VIP = src.VIP
	}
	if src.Privilege {
		dst.Privilege = true
	}
	if src.Email != "" {
		dst.Email = src.Email
	}
	if src.Mobile != "" {
		dst.Mobile = src.Mobile
	}
}

func (a *App) handleRefreshAccount(w http.ResponseWriter, r *http.Request) {
	acc, err := a.Store.MainAccount()
	if err != nil {
		writeErr(w, http.StatusBadRequest, "还没有 115 账号")
		return
	}
	cl, err := a.Svc.Client(acc.ID)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	p, err := cl.GetProfile(r.Context())
	if err != nil {
		writeErr(w, http.StatusBadGateway, "获取账号信息失败: "+err.Error())
		return
	}
	var prof pan115.Profile
	if acc.Profile != "" {
		_ = json.Unmarshal([]byte(acc.Profile), &prof)
	}
	mergeProfile(&prof, p)
	if b, err := json.Marshal(prof); err == nil {
		acc.Profile = string(b)
	}
	if p.Name != "" {
		acc.Nickname = p.Name
	}
	if p.UserID != 0 {
		acc.UID = fmt.Sprintf("%d", p.UserID)
	}
	_, _ = a.Store.SaveAccount(acc)
	writeJSON(w, http.StatusOK, acc)
}

func (a *App) handleLogout115(w http.ResponseWriter, r *http.Request) {
	if err := a.Store.LogoutMain(); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if acc, err := a.Store.MainAccount(); err == nil {
		a.Svc.Invalidate(acc.ID)
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *App) handleAccountDelete(w http.ResponseWriter, r *http.Request) {
	id, _ := parseInt64(r.PathValue("id"))
	// P0 只允许删除附加账号，主号需先切换；这里简单禁止删除最后一条。
	accs, _ := a.Store.ListAccounts()
	if len(accs) <= 1 {
		writeErr(w, http.StatusBadRequest, "至少保留一个账号")
		return
	}
	if err := a.Store.DeleteAccount(id); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	a.Svc.Invalidate(id)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *App) handleQRStart(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Device string `json:"device"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&in); err != nil && err != io.EOF {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if in.Device == "" {
		in.Device = "web"
	}
	c := pan115.New(pan115.Credential{}, time.Second, 3*time.Second)
	qr, err := c.QRCreate(r.Context())
	if err != nil {
		a.Log.Warn("115 扫码会话创建失败", "err", err)
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	qr.Device = in.Device
	a.qrMu.Lock()
	a.qr[qr.UID] = qr
	a.qrMu.Unlock()
	writeJSON(w, http.StatusOK, qr)
}

func (a *App) handleQRPoll(w http.ResponseWriter, r *http.Request) {
	uid := r.PathValue("uid")
	a.qrMu.Lock()
	qr := a.qr[uid]
	a.qrMu.Unlock()
	if qr == nil {
		// 登录成功后会话会被删除；前端可能还有一次在途轮询，这里按“已结束”返回而不是 404。
		writeJSON(w, http.StatusOK, map[string]any{"status": -1, "message": "扫码会话已结束"})
		return
	}
	c := pan115.New(pan115.Credential{}, time.Second, 3*time.Second)
	st, err := c.QRStatus(r.Context(), qr)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	if st.Status != 2 {
		writeJSON(w, http.StatusOK, map[string]any{"status": st.Status, "message": st.Message})
		return
	}
	// 开放平台账号优先：已配置 AppID 且当前是开放平台账号时，不允许扫码覆盖。
	if cur, err := a.Store.MainAccount(); err == nil && cur.AuthType == "openapi" && a.Store.GetSetting("p115_app_id", "") != "" {
		writeErr(w, http.StatusConflict, "当前是开放平台账号（AppID 权限更高）。如需改用扫码登录，请先在设置中清除 AppID")
		return
	}
	login, err := c.QRLogin(r.Context(), qr, qr.Device)
	if err != nil {
		a.Log.Warn("115 扫码换 Cookie 失败", "device", qr.Device, "err", err)
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}

	// 登录响应本身就带昵称/头像/VIP，小程序的会话也能拿到；容量再用 GetInfo 补充。
	prof := pan115.Profile{
		UserID:    login.UserID,
		Name:      login.UserName,
		Face:      login.Face,
		VIP:       int(login.VIP),
		Privilege: login.VIP > 0,
		Email:     login.Email,
		Mobile:    login.Mobile,
	}
	profBytes, _ := json.Marshal(prof)
	nickname := login.UserName
	if nickname == "" {
		nickname = "115 用户"
	}
	uidText := ""
	if login.UserID != 0 {
		uidText = fmt.Sprintf("%d", login.UserID)
	}
	id, err := a.Store.UpsertMainAccount(&store.Account{
		Name: "115 主账号", Role: "main", AuthType: "cookie",
		Cookie: login.Cookie, Device: qr.Device,
		Nickname: nickname, UID: uidText, Profile: string(profBytes),
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if acc, err := a.Store.GetAccount(id); err == nil {
		if cl, err := a.Svc.Client(id); err == nil {
			if p, err := cl.GetProfile(r.Context()); err == nil {
				if p.Total > 0 {
					prof.Total, prof.Used = p.Total, p.Used
				}
				if p.Expire > 0 {
					prof.Expire, prof.Forever = p.Expire, p.Forever
				}
				if prof.Name == "" {
					prof.Name = p.Name
				}
				if prof.Face == "" {
					prof.Face = p.Face
				}
				if prof.VIP == 0 {
					prof.VIP, prof.Privilege = p.VIP, p.Privilege
				}
				if prof.UserID == 0 {
					prof.UserID = p.UserID
				}
				if b, err := json.Marshal(prof); err == nil {
					acc.Profile = string(b)
				}
				if p.Name != "" {
					acc.Nickname = p.Name
				}
				if p.UserID != 0 {
					acc.UID = fmt.Sprintf("%d", p.UserID)
				}
			} else {
				a.Log.Warn("补充容量信息失败（不影响登录）", "device", qr.Device, "err", err)
				if acc.UID == "" {
					acc.UID = cookieUID(login.Cookie)
				}
			}
			_, _ = a.Store.SaveAccount(acc)
		}
	}
	a.qrMu.Lock()
	delete(a.qr, uid)
	a.qrMu.Unlock()
	a.Svc.Invalidate(id)
	writeJSON(w, http.StatusOK, map[string]any{"status": 2, "accountId": id})
}

func (a *App) handleOpenStart(w http.ResponseWriter, r *http.Request) {
	var in struct {
		AppID string `json:"appId"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&in); err != nil && err != io.EOF {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	appID := strings.TrimSpace(in.AppID)
	if appID != "" {
		_ = a.Store.SetSetting("p115_app_id", appID)
	} else {
		appID = a.Store.GetSetting("p115_app_id", "")
	}
	if appID == "" {
		writeErr(w, http.StatusBadRequest, "请填写 115 开放平台 AppID")
		return
	}
	c := pan115.New(pan115.Credential{}, time.Second, 3*time.Second)
	oa, err := c.OpenLoginStart(r.Context(), appID)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	a.qrMu.Lock()
	a.opena[oa.UID] = oa
	a.qrMu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"uid": oa.UID, "content": oa.Content})
}

func (a *App) handleOpenPoll(w http.ResponseWriter, r *http.Request) {
	uid := r.PathValue("uid")
	a.qrMu.Lock()
	oa := a.opena[uid]
	a.qrMu.Unlock()
	if oa == nil {
		writeErr(w, http.StatusNotFound, "授权会话不存在")
		return
	}
	c := pan115.New(pan115.Credential{}, time.Second, 3*time.Second)
	cr, err := c.OpenLoginPoll(r.Context(), oa, a.Store.GetSetting("p115_app_id", ""))
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	if cr == nil {
		writeJSON(w, http.StatusOK, map[string]any{"status": 1, "message": "等待扫码确认"})
		return
	}
	id, err := a.Store.UpsertMainAccount(&store.Account{
		Name: "115 开放平台", Role: "main", AuthType: "openapi",
		AccessToken: cr.AccessToken, RefreshToken: cr.RefreshToken, ExpiresAt: cr.ExpiresAt,
		AppID: cr.AppID, UID: cr.UID, Nickname: "开放平台",
	})
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	a.qrMu.Lock()
	delete(a.opena, uid)
	a.qrMu.Unlock()
	a.Svc.Invalidate(id)
	writeJSON(w, http.StatusOK, map[string]any{"status": 2, "accountId": id})
}

// ---------- dirs ----------

func (a *App) handleDirs(w http.ResponseWriter, r *http.Request) {
	accountID, _ := parseInt64(r.URL.Query().Get("accountId"))
	cid := r.URL.Query().Get("cid")
	if accountID == 0 {
		acc, err := a.Store.MainAccount()
		if err != nil {
			writeErr(w, http.StatusBadRequest, "还没有 115 账号")
			return
		}
		accountID = acc.ID
	}
	entries, err := a.Svc.ListRemoteDir(r.Context(), accountID, cid)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	out := make([]pan115.Entry, 0)
	for _, e := range entries {
		if e.IsDir {
			out = append(out, e)
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// ---------- libraries ----------

func (a *App) handleListLibraries(w http.ResponseWriter, r *http.Request) {
	libs, err := a.Store.ListLibraries()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, libs)
}

func (a *App) handleGetLibrary(w http.ResponseWriter, r *http.Request) {
	id, _ := parseInt64(r.PathValue("id"))
	lib, err := a.Store.GetLibrary(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "媒体库不存在")
		return
	}
	writeJSON(w, http.StatusOK, lib)
}

func (a *App) handleSaveLibrary(w http.ResponseWriter, r *http.Request) {
	var in store.Library
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&in); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if in.Name == "" || in.RemoteCID == "" || in.LocalDir == "" {
		writeErr(w, http.StatusBadRequest, "name / remoteCid / localDir 必填")
		return
	}
	if in.AccountID == 0 {
		acc, err := a.Store.MainAccount()
		if err != nil {
			writeErr(w, http.StatusBadRequest, "还没有 115 账号")
			return
		}
		in.AccountID = acc.ID
	}
	if in.BaseURL == "" {
		in.BaseURL = a.Store.GetSetting("public_base", "")
	}
	if in.BaseURL == "" {
		writeErr(w, http.StatusBadRequest, "请先在设置页填写播放地址（写入 STRM 的地址）")
		return
	}
	if in.STRMFormat == "" {
		in.STRMFormat = "pick_code"
	}
	if in.ScanMode == "" {
		in.ScanMode = "fast"
	}
	if in.VideoExts == "" {
		in.VideoExts = ".mkv,.mp4,.ts,.m2ts,.iso,.avi,.mov,.wmv,.flv,.rmvb,.webm"
	}
	if in.MetaExts == "" {
		in.MetaExts = ".srt,.ass,.nfo,.jpg,.png"
	}
	in.Enabled = true
	id, err := a.Store.SaveLibrary(&in)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]int64{"id": id})
}

func (a *App) handleDeleteLibrary(w http.ResponseWriter, r *http.Request) {
	id, _ := parseInt64(r.PathValue("id"))
	if err := a.Store.DeleteLibrary(id); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *App) handleScan(w http.ResponseWriter, r *http.Request) {
	id, _ := parseInt64(r.PathValue("id"))
	if _, err := a.Store.GetLibrary(id); err != nil {
		writeErr(w, http.StatusNotFound, "媒体库不存在")
		return
	}
	payload, _ := json.Marshal(scanPayload{LibraryID: id})
	taskID, reused, err := a.Store.EnqueueTask("scan", id, fmt.Sprintf("scan:%d", id), string(payload))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"taskId": taskID, "reused": reused})
}

func (a *App) handleSyncDir(w http.ResponseWriter, r *http.Request) {
	id, _ := parseInt64(r.PathValue("id"))
	if _, err := a.Store.GetLibrary(id); err != nil {
		writeErr(w, http.StatusNotFound, "媒体库不存在")
		return
	}
	var in struct {
		CID string `json:"cid"`
	}
	_ = json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&in)
	if in.CID == "" {
		writeErr(w, http.StatusBadRequest, "cid 必填")
		return
	}
	payload, _ := json.Marshal(syncDirPayload{LibraryID: id, CID: in.CID})
	taskID, reused, err := a.Store.EnqueueTask("sync-dir", id, fmt.Sprintf("syncdir:%d:%s", id, in.CID), string(payload))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"taskId": taskID, "reused": reused})
}

// ---------- sync ----------

func (a *App) handleSyncStatus(w http.ResponseWriter, r *http.Request) {
	if a.Incr == nil {
		writeJSON(w, http.StatusOK, map[string]any{"enabled": false})
		return
	}
	st := a.Incr.Status()
	// 平铺增量状态 + 附加锁占用与 115 通道状态(前端按字段读,向后兼容)
	data, _ := json.Marshal(st)
	var m map[string]any
	_ = json.Unmarshal(data, &m)
	m["lock"] = a.Svc.SyncStatus()
	if ts := a.Svc.ThrottleStatus(); ts != nil {
		m["throttle"] = ts
	}
	writeJSON(w, http.StatusOK, m)
}

func (a *App) handleSyncRounds(w http.ResponseWriter, r *http.Request) {
	if a.Incr == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	writeJSON(w, http.StatusOK, a.Incr.Rounds())
}

// handleOrphans 失效 STRM 预览(只列不删)。
func (a *App) handleOrphans(w http.ResponseWriter, r *http.Request) {
	id, _ := parseInt64(r.PathValue("id"))
	lib, err := a.Store.GetLibrary(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "媒体库不存在")
		return
	}
	files, err := a.Store.ListFiles(lib.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]store.SyncedFile, 0)
	for _, f := range files {
		if f.Status == "orphan" {
			out = append(out, f)
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// handleOrphanClean 确认清理:删本地 STRM + 台账行,回收空目录(库根不动)。
func (a *App) handleOrphanClean(w http.ResponseWriter, r *http.Request) {
	id, _ := parseInt64(r.PathValue("id"))
	lib, err := a.Store.GetLibrary(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "媒体库不存在")
		return
	}
	files, err := a.Store.ListFiles(lib.ID)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	var orphans []store.SyncedFile
	for _, f := range files {
		if f.Status == "orphan" {
			orphans = append(orphans, f)
		}
	}
	if len(orphans) == 0 {
		writeJSON(w, http.StatusOK, map[string]int{"removed": 0, "dirs": 0})
		return
	}
	removed, dirs := scan.CleanOrphans(lib.LocalDir, orphans)
	for _, f := range orphans {
		_ = a.Store.DeleteFile(lib.ID, f.FID)
	}
	a.Log.Info("孤儿清理完成", "library", lib.Name, "removed", removed, "dirs", dirs)
	writeJSON(w, http.StatusOK, map[string]int{"removed": removed, "dirs": dirs})
}

// handleStrmRebase 批量替换 STRM 播放地址(换域名/IP 自救,零 115 请求)。
func (a *App) handleStrmRebase(w http.ResponseWriter, r *http.Request) {
	var in struct {
		From      string `json:"from"`
		To        string `json:"to"`
		LibraryID int64  `json:"libraryId"` // 0 = 全部媒体库
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&in); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	in.From = strings.TrimSpace(in.From)
	in.To = strings.TrimSpace(in.To)
	if !strings.HasPrefix(in.From, "http://") && !strings.HasPrefix(in.From, "https://") ||
		!strings.HasPrefix(in.To, "http://") && !strings.HasPrefix(in.To, "https://") ||
		strings.TrimRight(in.From, "/") == strings.TrimRight(in.To, "/") {
		writeErr(w, http.StatusBadRequest, "from/to 都必须是 http(s) 地址且不相同")
		return
	}
	libs, err := a.Store.ListLibraries()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	changed, scanned := 0, 0
	perLib := map[string]int{}
	for _, lib := range libs {
		if in.LibraryID != 0 && lib.ID != in.LibraryID {
			continue
		}
		c, s, err := strm.Rebase(lib.LocalDir, in.From, in.To)
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			a.Log.Warn("rebase 扫描失败", "library", lib.Name, "err", err)
			continue
		}
		changed += c
		scanned += s
		perLib[lib.Name] = c
	}
	a.Log.Info("STRM 地址替换完成", "from", in.From, "to", in.To, "scanned", scanned, "changed", changed)
	writeJSON(w, http.StatusOK, map[string]any{"scanned": scanned, "changed": changed, "perLibrary": perLib})
}

// ---------- adopt 接管 ----------

// walkForeign 收集媒体库下的全部 .strm(不按台账,别家写的也算)。
func (a *App) walkForeign(lib store.Library) []adopt.Foreign {
	var out []adopt.Foreign
	_ = filepath.Walk(lib.LocalDir, func(p string, info os.FileInfo, err error) error {
		if err != nil || info == nil || info.IsDir() {
			return nil
		}
		if !strings.EqualFold(filepath.Ext(p), ".strm") {
			return nil
		}
		rel, rerr := filepath.Rel(lib.LocalDir, p)
		if rerr != nil {
			return nil
		}
		out = append(out, adopt.Foreign{
			LibraryID: lib.ID,
			Rel:       filepath.ToSlash(rel),
			Path:      p,
		})
		return nil
	})
	return out
}

// planAdopt 对选中的库做接管预演(重新扫描,不信任任何缓存的预演结论)。
func (a *App) planAdopt(libraryIDs []int64) (adopt.Plan, error) {
	var plan adopt.Plan
	libs, err := a.Store.ListLibraries()
	if err != nil {
		return plan, err
	}
	want := map[int64]bool{}
	for _, id := range libraryIDs {
		want[id] = true
	}
	var foreign []adopt.Foreign
	var ledger []store.SyncedFile
	libRoots := map[int64]string{}
	for _, lib := range libs {
		if len(want) > 0 && !want[lib.ID] {
			continue
		}
		foreign = append(foreign, a.walkForeign(lib)...)
		files, err := a.Store.ListFiles(lib.ID)
		if err == nil {
			ledger = append(ledger, files...)
		}
		libRoots[lib.ID] = lib.LocalDir
	}
	return adopt.MatchForeign(foreign, ledger, libRoots), nil
}

func (a *App) handleAdoptPreview(w http.ResponseWriter, r *http.Request) {
	var in struct {
		LibraryIDs []int64 `json:"libraryIds"`
	}
	_ = json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&in)
	plan, err := a.planAdopt(in.LibraryIDs)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if plan.Adoptable == nil {
		plan.Adoptable = []adopt.AdoptItem{}
	}
	if plan.Missing == nil {
		plan.Missing = []adopt.Foreign{}
	}
	writeJSON(w, http.StatusOK, plan)
}

func (a *App) handleAdoptApply(w http.ResponseWriter, r *http.Request) {
	var in struct {
		LibraryIDs []int64 `json:"libraryIds"`
	}
	_ = json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&in)
	if a.Store.GetSetting("public_base", "") == "" {
		writeErr(w, http.StatusBadRequest, "未配置播放地址：接管后 STRM 会指向本站，请先在设置页填写播放地址")
		return
	}
	payload, _ := json.Marshal(adoptPayload{LibraryIDs: in.LibraryIDs})
	taskID, reused, err := a.Store.EnqueueTask("adopt", 0, "adopt", string(payload))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"taskId": taskID, "reused": reused})
}

func (a *App) execAdopt(ctx context.Context, t *store.Task) {
	var p adoptPayload
	_ = json.Unmarshal([]byte(t.Payload), &p)
	// 执行时重新对号,不用预演结论
	plan, err := a.planAdopt(p.LibraryIDs)
	if err != nil {
		_ = a.Store.UpdateTask(t.ID, "failed", err.Error())
		return
	}
	base := a.Store.GetSetting("public_base", "")
	_ = a.Store.SetTaskProgress(t.ID, "接管中")
	n, err := adopt.Apply(base, plan.Adoptable, a.Store)
	if err != nil {
		_ = a.Store.UpdateTask(t.ID, "failed", "接管执行失败: "+err.Error())
		return
	}
	if err := a.emby().RefreshLibrary(ctx, ""); err != nil {
		a.Log.Warn("接管后 Emby 刷新失败", "err", err)
	}
	_ = a.Store.UpdateTask(t.ID, "done",
		fmt.Sprintf("接管完成：成功 %d，跳过 %d（本站格式），对不上号 %d", n, plan.Skipped, len(plan.Missing)))
	a.Log.Info("adopt 完成", "adopted", n, "skipped", plan.Skipped, "missing", len(plan.Missing))
}

func (a *App) handleIncremental(w http.ResponseWriter, r *http.Request) {
	if a.Incr == nil {
		writeErr(w, http.StatusServiceUnavailable, "增量同步未启用")
		return
	}
	res, err := a.Incr.PollOnce(r.Context())
	if err != nil {
		a.Log.Warn("手动增量同步失败", "err", err)
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, res)
}

func (a *App) handleIncrementalTest(w http.ResponseWriter, r *http.Request) {
	if a.Incr == nil {
		writeErr(w, http.StatusServiceUnavailable, "增量同步未启用")
		return
	}
	events, err := a.Incr.TestEvents(r.Context(), 20)
	if err != nil {
		writeErr(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, events)
}

func (a *App) handleSyncSettings(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Enabled     *bool `json:"enabled"`
		IntervalSec int   `json:"intervalSec"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&in); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	settings := map[string]string{}
	if in.IntervalSec != 0 {
		if in.IntervalSec < 15 || in.IntervalSec > 3600 {
			writeErr(w, http.StatusBadRequest, "增量间隔需在 15–3600 秒之间")
			return
		}
		settings["incr_interval_sec"] = fmt.Sprintf("%d", in.IntervalSec)
	}
	if in.Enabled != nil {
		settings["incr_enabled"] = boolText(*in.Enabled)
	}
	if err := a.Store.SetMany(settings); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *App) handleFullSync(w http.ResponseWriter, r *http.Request) {
	var in struct {
		LibraryIDs []int64 `json:"libraryIds"`
	}
	_ = json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&in)
	libs, err := a.Store.ListLibraries()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	want := map[int64]bool{}
	for _, id := range in.LibraryIDs {
		want[id] = true
	}
	var selected []int64
	names := []string{}
	for i := range libs {
		if !libs[i].Enabled {
			continue
		}
		if len(want) == 0 || want[libs[i].ID] {
			selected = append(selected, libs[i].ID)
			names = append(names, libs[i].Name)
		}
	}
	if len(selected) == 0 {
		writeErr(w, http.StatusBadRequest, "没有可同步的媒体库")
		return
	}
	payload, _ := json.Marshal(fullSyncPayload{LibraryIDs: selected})
	taskID, reused, err := a.Store.EnqueueTask("full-sync", 0, "full-sync", string(payload))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	_ = a.Store.SetTaskProgress(taskID, fmt.Sprintf("全量同步排队（%d 个媒体库）", len(selected)))
	writeJSON(w, http.StatusAccepted, map[string]any{"taskId": taskID, "reused": reused, "libraries": names})
}

// ---------- 任务执行器（worker 串行调用） ----------

type scanPayload struct {
	LibraryID int64 `json:"libraryId"`
}

type syncDirPayload struct {
	LibraryID int64  `json:"libraryId"`
	CID       string `json:"cid"`
}

type fullSyncPayload struct {
	LibraryIDs []int64 `json:"libraryIds"`
}

type scrapePayload struct {
	LibraryID int64 `json:"libraryId"`
}

type adoptPayload struct {
	LibraryIDs []int64 `json:"libraryIds"`
}

func (a *App) registerExecutors() {
	a.executors = map[string]func(ctx context.Context, t *store.Task){
		"scan":      a.execScan,
		"sync-dir":  a.execSyncDir,
		"full-sync": a.execFullSync,
		"scrape":    a.execScrape,
		"adopt":     a.execAdopt,
	}
	// 同步完成(该库开了刮削且配了 Key)→ 自动入队刮削
	a.bus.Subscribe(eventbus.EventSyncDone, func(payload any) {
		ev, ok := payload.(eventbus.SyncDoneEvent)
		if !ok || ev.Written <= 0 {
			return
		}
		lib, err := a.Store.GetLibrary(ev.LibraryID)
		if err != nil || !lib.Scrape {
			return
		}
		if a.Store.GetSetting("tmdb_api_key", "") == "" {
			return
		}
		payload2, _ := json.Marshal(scrapePayload{LibraryID: lib.ID})
		_, _, _ = a.Store.EnqueueTask("scrape", lib.ID, fmt.Sprintf("scrape:%d", lib.ID), string(payload2))
	})
}

func (a *App) execScan(ctx context.Context, t *store.Task) {
	var p scanPayload
	_ = json.Unmarshal([]byte(t.Payload), &p)
	lib, err := a.Store.GetLibrary(p.LibraryID)
	if err != nil {
		_ = a.Store.UpdateTask(t.ID, "failed", "媒体库不存在（可能已被删除）")
		return
	}
	_ = a.Store.SetTaskProgress(t.ID, "扫描中 "+lib.Name)
	start := time.Now()
	res, err := a.Svc.ScanLibrary(ctx, lib)
	if err != nil {
		_ = a.Store.UpdateTask(t.ID, "failed", err.Error())
		a.Log.Error("扫描失败", "library", lib.Name, "err", err)
		return
	}
	if err := a.emby().RefreshLibrary(ctx, ""); err != nil {
		a.Log.Warn("Emby 刷新失败", "err", err)
	}
	msg := fmt.Sprintf("扫描 %d，写入 %d，跳过 %d，改名 %d，附属 %d，失效 %d，耗时 %.0fs",
		res.Scanned, res.Written, res.Skipped, res.Renamed, res.Meta, res.Orphans, time.Since(start).Seconds())
	_ = a.Store.UpdateTask(t.ID, "done", msg)
	a.saveLibStat(lib, res)
	a.Log.Info("扫描完成", "library", lib.Name, "message", msg)
	a.bus.Publish(eventbus.EventSyncDone, eventbus.SyncDoneEvent{
		LibraryID: lib.ID, LibraryName: lib.Name, Written: res.Written,
	})
}

// saveLibStat 把库级同步结果写进 lib_sync_stats setting(库卡片展示用)。
func (a *App) saveLibStat(lib *store.Library, res scan.Result) {
	stats := map[string]map[string]any{}
	if raw := a.Store.GetSetting("lib_sync_stats", ""); raw != "" {
		_ = json.Unmarshal([]byte(raw), &stats)
	}
	stats[fmt.Sprintf("%d", lib.ID)] = map[string]any{
		"name": lib.Name, "lastSync": time.Now().Unix(),
		"scanned": res.Scanned, "written": res.Written, "orphans": res.Orphans,
	}
	if b, err := json.Marshal(stats); err == nil {
		_ = a.Store.SetSetting("lib_sync_stats", string(b))
	}
}

func (a *App) execSyncDir(ctx context.Context, t *store.Task) {
	var p syncDirPayload
	_ = json.Unmarshal([]byte(t.Payload), &p)
	lib, err := a.Store.GetLibrary(p.LibraryID)
	if err != nil {
		_ = a.Store.UpdateTask(t.ID, "failed", "媒体库不存在（可能已被删除）")
		return
	}
	_ = a.Store.SetTaskProgress(t.ID, "同步目录 "+p.CID)
	res, err := a.Svc.ScanDir(ctx, lib, p.CID)
	if err != nil {
		_ = a.Store.UpdateTask(t.ID, "failed", err.Error())
		return
	}
	_ = a.Store.UpdateTask(t.ID, "done", fmt.Sprintf("目录同步完成：%d 个视频，写入 %d", res.Scanned, res.Written))
}

func (a *App) execFullSync(ctx context.Context, t *store.Task) {
	var p fullSyncPayload
	if err := json.Unmarshal([]byte(t.Payload), &p); err != nil || len(p.LibraryIDs) == 0 {
		_ = a.Store.UpdateTask(t.ID, "failed", "任务参数无效")
		return
	}
	var scanned, written, skipped, orphans, failed int
	for i, libID := range p.LibraryIDs {
		if ctx.Err() != nil {
			_ = a.Store.UpdateTask(t.ID, "failed", "已取消")
			return
		}
		lib, err := a.Store.GetLibrary(libID)
		if err != nil {
			failed++
			continue
		}
		_ = a.Store.SetTaskProgress(t.ID, fmt.Sprintf("全量同步 %d/%d：%s", i+1, len(p.LibraryIDs), lib.Name))
		res, err := a.Svc.ScanLibrary(ctx, lib)
		if err != nil {
			failed++
			a.Log.Warn("全量同步失败", "library", lib.Name, "err", err)
			continue
		}
		scanned += res.Scanned
		written += res.Written
		skipped += res.Skipped
		orphans += res.Orphans
		a.saveLibStat(lib, res)
		a.bus.Publish(eventbus.EventSyncDone, eventbus.SyncDoneEvent{
			LibraryID: lib.ID, LibraryName: lib.Name, Written: res.Written,
		})
	}
	// 全量闭环:至少一个库成功 → 推进事件游标并清空 pending,
	// 全量补齐的文件不再被增量重扫。
	if failed < len(p.LibraryIDs) {
		if a.Incr != nil {
			a.Incr.AdvanceCursorPastPending()
		}
	}
	if err := a.emby().RefreshLibrary(ctx, ""); err != nil {
		a.Log.Warn("Emby 刷新失败", "err", err)
	}
	msg := fmt.Sprintf("全量同步完成：扫描 %d，写入 %d，跳过 %d，失效 %d，失败 %d", scanned, written, skipped, orphans, failed)
	status := "done"
	if failed > 0 && written == 0 && scanned == 0 {
		status = "failed"
	}
	_ = a.Store.UpdateTask(t.ID, status, msg)
	a.Log.Info("全量同步结束", "message", msg)
}

// ---------- tasks ----------

func (a *App) handleTasks(w http.ResponseWriter, r *http.Request) {
	tasks, err := a.Store.ListTasks(50)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, tasks)
}


// ---------- settings ----------

func (a *App) handleGetSettings(w http.ResponseWriter, r *http.Request) {
	e := a.Store.GetEmbyConfig()
	writeJSON(w, http.StatusOK, map[string]any{
		"embyBase":            e.Base,
		"embyApiKeySet":       e.APIKey != "",
		"embyWebhookTokenSet": e.WebhookToken != "",
		"embyDeleteRemote":    e.DeleteRemote,
		"p115AppId":           a.Store.GetSetting("p115_app_id", ""),
		"p115AppSecretSet":    a.Store.GetSetting("p115_app_secret", "") != "",
		"adminUser":           a.Store.GetSetting("admin_user", "admin"),
		"apiWaitSec":          a.Store.GetSetting("api_wait_sec", "1"),
		"publicBase":          a.Store.GetSetting("public_base", ""),
		"tmdbApiKeySet":       a.Store.GetSetting("tmdb_api_key", "") != "",
		"tmdbLanguage":        a.Store.GetSetting("tmdb_language", "zh-CN"),
	})
}

// handleSaveSettings 保存 Emby 与 115 开放平台配置。
// 密钥类字段为空表示"保持不变"；要清空请显式传 clearXxx=true。
func (a *App) handleSaveSettings(w http.ResponseWriter, r *http.Request) {
	var in struct {
		EmbyBase              string `json:"embyBase"`
		EmbyApiKey            string `json:"embyApiKey"`
		EmbyWebhookToken      string `json:"embyWebhookToken"`
		EmbyDeleteRemote      bool   `json:"embyDeleteRemote"`
		P115AppId             string `json:"p115AppId"`
		P115AppSecret         string `json:"p115AppSecret"`
		AdminUser             string `json:"adminUser"`
		PublicBase            string `json:"publicBase"`
		ApiWaitSec            int    `json:"apiWaitSec"`
		TmdbApiKey            string `json:"tmdbApiKey"`
		TmdbLanguage          string `json:"tmdbLanguage"`
		NewPassword           string `json:"newPassword"`
		ClearEmbyApiKey       bool   `json:"clearEmbyApiKey"`
		ClearEmbyWebhookToken bool   `json:"clearEmbyWebhookToken"`
		ClearP115AppSecret    bool   `json:"clearP115AppSecret"`
		ClearTmdbApiKey       bool   `json:"clearTmdbApiKey"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&in); err != nil {
		writeErr(w, http.StatusBadRequest, "请求格式错误")
		return
	}
	if in.NewPassword != "" && len(in.NewPassword) < 8 {
		writeErr(w, http.StatusBadRequest, "新密码至少 8 位")
		return
	}
	if in.ApiWaitSec != 0 && (in.ApiWaitSec < 1 || in.ApiWaitSec > 60) {
		writeErr(w, http.StatusBadRequest, "API 等待时间需在 1–60 秒之间")
		return
	}

	e := a.Store.GetEmbyConfig()
	e.Base = strings.TrimRight(strings.TrimSpace(in.EmbyBase), "/")
	switch {
	case in.ClearEmbyApiKey:
		e.APIKey = ""
	case strings.TrimSpace(in.EmbyApiKey) != "":
		e.APIKey = strings.TrimSpace(in.EmbyApiKey)
	}
	switch {
	case in.ClearEmbyWebhookToken:
		e.WebhookToken = ""
	case strings.TrimSpace(in.EmbyWebhookToken) != "":
		e.WebhookToken = strings.TrimSpace(in.EmbyWebhookToken)
	}
	e.DeleteRemote = in.EmbyDeleteRemote

	secret := a.Store.GetSetting("p115_app_secret", "")
	switch {
	case in.ClearP115AppSecret:
		secret = ""
	case strings.TrimSpace(in.P115AppSecret) != "":
		secret = strings.TrimSpace(in.P115AppSecret)
	}

	settings := map[string]string{
		"emby_base":          e.Base,
		"emby_api_key":       e.APIKey,
		"emby_webhook_token": e.WebhookToken,
		"emby_delete_remote": boolText(e.DeleteRemote),
		"public_base":        strings.TrimRight(strings.TrimSpace(in.PublicBase), "/"),
		"p115_app_id":        strings.TrimSpace(in.P115AppId),
		"p115_app_secret":    secret,
	}
	// TMDB:留空保持不变,显式 clearTmdbApiKey 清空
	switch {
	case in.ClearTmdbApiKey:
		settings["tmdb_api_key"] = ""
	case strings.TrimSpace(in.TmdbApiKey) != "":
		settings["tmdb_api_key"] = strings.TrimSpace(in.TmdbApiKey)
	}
	if lang := strings.TrimSpace(in.TmdbLanguage); lang != "" {
		settings["tmdb_language"] = lang
	}
	if in.ApiWaitSec > 0 {
		settings["api_wait_sec"] = fmt.Sprintf("%d", in.ApiWaitSec)
	}
	if u := strings.TrimSpace(in.AdminUser); u != "" {
		settings["admin_user"] = u
	}
	if in.NewPassword != "" {
		settings["admin_password_hash"] = hashPassword(in.NewPassword)
	}
	start := time.Now()
	if err := a.Store.SetMany(settings); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if d := time.Since(start); d > 300*time.Millisecond {
		a.Log.Warn("保存设置较慢", "duration", d)
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func boolText(v bool) string {
	if v {
		return "1"
	}
	return "0"
}

// ---------- emby ----------

func (a *App) emby() *emby.Client {
	e := a.Store.GetEmbyConfig()
	return emby.New(e.Base, e.APIKey)
}

func (a *App) handleEmbyStatus(w http.ResponseWriter, r *http.Request) {
	c := a.emby()
	if !c.Enabled() {
		writeJSON(w, http.StatusOK, map[string]any{"enabled": false})
		return
	}
	err := c.Ping(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{"enabled": true, "ok": err == nil, "error": errString(err)})
}

func (a *App) handleEmbyWebhook(w http.ResponseWriter, r *http.Request) {
	token := a.Store.GetEmbyConfig().WebhookToken
	if token != "" {
		if r.URL.Query().Get("token") != token && r.Header.Get("X-Emby-Token") != token {
			a.noteWebhookSeen("reject", "token 校验失败")
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	wh, err := emby.ParseWebhook(body)
	if err != nil {
		a.noteWebhookSeen("reject", "payload 解析失败")
		http.Error(w, "bad payload", http.StatusBadRequest)
		return
	}
	a.noteWebhookSeen(wh.Event, "")
	a.Log.Info("Emby webhook", "event", wh.Event, "type", wh.Item.Type, "name", wh.Item.Name)
	switch {
	case strings.Contains(wh.Event, "library.new"):
		// Emby 触发 library.new 说明它自己刚扫过库,这里只做兜底刷新;
		// 10 分钟节流,防 Emby 实时监控与我们自己的刷库互相打环。
		a.embyMu.Lock()
		dupe := time.Now().Unix()-a.lastRefresh["__webhook__"] < 600
		if !dupe {
			a.lastRefresh["__webhook__"] = time.Now().Unix()
		}
		a.embyMu.Unlock()
		if dupe {
			break
		}
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
			defer cancel()
			_ = a.emby().RefreshLibrary(ctx, "")
		}()
	case strings.Contains(wh.Event, "library.deleted"):
		if a.Deep == nil {
			a.Log.Warn("收到删除事件，但深度删除未启用", "name", wh.Item.Name)
			break
		}
		item := deepdel.Item{Type: wh.Item.Type, Name: wh.Item.Name, Path: wh.Item.Path}
		a.noteWebhookSeen("delete", "")
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
			defer cancel()
			res, err := a.Deep.Handle(ctx, item)
			if err != nil {
				a.Log.Error("深度删除失败", "name", item.Name, "path", item.Path, "err", err)
				return
			}
			a.Log.Info("深度删除", "name", item.Name, "matched", res.Matched,
				"local", res.DeletedLocal, "remote", res.DeletedRemote,
				"dirs", res.RemovedDirs, "rejected", res.Rejected)
		}()
	}
	w.WriteHeader(http.StatusNoContent)
}

// noteWebhookSeen 反向记录"最近收到过什么 webhook"(Emby 的 REST 查不到它
// 的 webhook 配置,用户配错时这里就是唯一线索)。any 类 10 分钟限频,
// 播放事件一分钟可能来好几条;删除/被拒每次都记。
func (a *App) noteWebhookSeen(kind, rejectWhy string) {
	seen := map[string]any{}
	if raw := a.Store.GetSetting("emby_webhook_seen", ""); raw != "" {
		_ = json.Unmarshal([]byte(raw), &seen)
	}
	now := time.Now().Unix()
	isAny := kind != "reject" && kind != "delete"
	if isAny {
		if last, _ := seen["anyAt"].(float64); now-int64(last) < 600 {
			return
		}
		seen["anyAt"] = now
	} else {
		seen[kind+"At"] = now
		if rejectWhy != "" {
			seen["rejectWhy"] = rejectWhy
		}
	}
	seen["kind"] = kind
	if b, err := json.Marshal(seen); err == nil {
		_ = a.Store.SetSetting("emby_webhook_seen", string(b))
	}
}

// handleWebhookStatus 深删页展示"Emby webhook 到底通没通"。
func (a *App) handleWebhookStatus(w http.ResponseWriter, r *http.Request) {
	seen := map[string]any{}
	if raw := a.Store.GetSetting("emby_webhook_seen", ""); raw != "" {
		_ = json.Unmarshal([]byte(raw), &seen)
	}
	e := a.Store.GetEmbyConfig()
	writeJSON(w, http.StatusOK, map[string]any{
		"tokenConfigured": e.WebhookToken != "",
		"seen":            seen,
	})
}

// handleDeepDelRecords 深删记录区:列表 + 状态筛选 + 近 30 天统计。
func (a *App) handleDeepDelRecords(w http.ResponseWriter, r *http.Request) {
	status := r.URL.Query().Get("status")
	records, err := a.Store.ListDeepDeleteRecords(status, 100)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	counts, videos30, remote30, err := a.Store.DeepDeleteStats()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if records == nil {
		records = []store.DeepDeleteRecord{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"records":  records,
		"counts":   counts,
		"videos30": videos30,
		"remote30": remote30,
	})
}

// ---------- helpers ----------

func cookieUID(cookie string) string {
	for _, part := range strings.Split(cookie, ";") {
		part = strings.TrimSpace(part)
		if strings.HasPrefix(part, "UID=") {
			return strings.TrimPrefix(part, "UID=")
		}
	}
	return ""
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func parseInt64(s string) (int64, error) {
	var n int64
	_, err := fmt.Sscan(s, &n)
	return n, err
}

func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

var _ = errors.New
