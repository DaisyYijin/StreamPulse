package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"time"

	_ "modernc.org/sqlite"
)

// Store 封装 SQLite。台账以 fid 为自然键，路径只是派生列。
type Store struct {
	db   *sql.DB
	path string
}

func Open(dataDir string) (*Store, error) {
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return nil, err
	}
	// 目录可能是旧版本以 0755 创建的，显式收紧
	_ = os.Chmod(dataDir, 0o700)
	p := filepath.Join(dataDir, "streampulse.db")
	db, err := sql.Open("sqlite", "file:"+p+
		"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(10000)&_pragma=foreign_keys(1)&_pragma=synchronous(NORMAL)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db, path: p}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	secureDBFiles(p)
	return s, nil
}

func (s *Store) Close() error {
	secureDBFiles(s.path)
	return s.db.Close()
}

// secureDBFiles 把数据库及 WAL/SHM 收紧到 0600（Linux 生效）。
func secureDBFiles(p string) {
	if p == "" {
		return
	}
	for _, f := range []string{p, p + "-wal", p + "-shm"} {
		if _, err := os.Stat(f); err == nil {
			_ = os.Chmod(f, 0o600)
		}
	}
}

const schema = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'main',      -- main | extra
  auth_type     TEXT NOT NULL,                     -- cookie | openapi
  cookie        TEXT NOT NULL DEFAULT '',
  access_token  TEXT NOT NULL DEFAULT '',
  refresh_token TEXT NOT NULL DEFAULT '',
  expires_at    INTEGER NOT NULL DEFAULT 0,
  app_id        TEXT NOT NULL DEFAULT '',
  uid           TEXT NOT NULL DEFAULT '',
  device        TEXT NOT NULL DEFAULT 'web',
  profile       TEXT NOT NULL DEFAULT '',
  nickname      TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS libraries (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  account_id     INTEGER NOT NULL,
  remote_cid     TEXT NOT NULL,
  local_dir      TEXT NOT NULL,
  base_url       TEXT NOT NULL,
  strm_format    TEXT NOT NULL DEFAULT 'pick_code', -- pick_code | pick_code_name
  keep_ext       INTEGER NOT NULL DEFAULT 0,
  video_exts     TEXT NOT NULL,
  meta_exts      TEXT NOT NULL,
  min_size       INTEGER NOT NULL DEFAULT 0,
  scan_mode      TEXT NOT NULL DEFAULT 'fast',      -- fast | normal
  cron           TEXT NOT NULL DEFAULT '',
  enabled        INTEGER NOT NULL DEFAULT 1,
  last_scan_at   INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dirs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  library_id INTEGER NOT NULL,
  cid        TEXT NOT NULL,
  parent_cid TEXT NOT NULL,
  name       TEXT NOT NULL,
  rel_path   TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(library_id, cid)
);

CREATE TABLE IF NOT EXISTS synced_files (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  library_id INTEGER NOT NULL,
  fid        TEXT NOT NULL,
  pickcode   TEXT NOT NULL,
  cid        TEXT NOT NULL,
  name       TEXT NOT NULL,
  rel_path   TEXT NOT NULL,
  strm_path  TEXT NOT NULL,
  size       INTEGER NOT NULL DEFAULT 0,
  sha1       TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'ok',            -- ok | orphan
  updated_at INTEGER NOT NULL,
  UNIQUE(library_id, fid)
);
CREATE INDEX IF NOT EXISTS idx_files_lib_cid ON synced_files(library_id, cid);

CREATE TABLE IF NOT EXISTS sync_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  event_id   TEXT NOT NULL,
  kind       TEXT NOT NULL,
  payload    TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'pending',       -- pending | done | skipped
  created_at INTEGER NOT NULL,
  UNIQUE(account_id, event_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,
  library_id INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'queued',        -- queued | running | done | failed
  message    TEXT NOT NULL DEFAULT '',
  started_at INTEGER NOT NULL DEFAULT 0,
  ended_at   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS local_dirs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  library_id INTEGER NOT NULL,
  cid        TEXT NOT NULL,
  rel_path   TEXT NOT NULL,
  moved_at   INTEGER NOT NULL,
  UNIQUE(library_id, cid)
);
`

// migrate 已迁移到 migrate.go(版本化迁移框架);schema 常量保留在那里使用。

// ---------- settings ----------

func (s *Store) GetSetting(key, def string) string {
	var v string
	err := s.db.QueryRow(`SELECT value FROM settings WHERE key = ?`, key).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return def
	}
	return v
}

func (s *Store) SetSetting(key, value string) error {
	_, err := s.db.Exec(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, value)
	return err
}

// ---------- accounts ----------

type Account struct {
	ID           int64  `json:"id"`
	Name         string `json:"name"`
	Role         string `json:"role"`
	AuthType     string `json:"authType"`
	Cookie       string `json:"-"`
	AccessToken  string `json:"-"`
	RefreshToken string `json:"-"`
	ExpiresAt    int64  `json:"expiresAt"`
	AppID        string `json:"appId"`
	UID          string `json:"uid"`
	Device       string `json:"device"`
	Profile      string `json:"profile"`
	Nickname     string `json:"nickname"`
	CreatedAt    int64  `json:"createdAt"`
	UpdatedAt    int64  `json:"updatedAt"`
}

func (s *Store) SaveAccount(a *Account) (int64, error) {
	now := time.Now().Unix()
	if a.CreatedAt == 0 {
		a.CreatedAt = now
	}
	a.UpdatedAt = now
	if a.ID == 0 {
		res, err := s.db.Exec(`INSERT INTO accounts(name,role,auth_type,cookie,access_token,refresh_token,expires_at,app_id,uid,device,profile,nickname,created_at,updated_at)
			VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			a.Name, a.Role, a.AuthType, a.Cookie, a.AccessToken, a.RefreshToken, a.ExpiresAt, a.AppID, a.UID, a.deviceOrDefault(), a.Profile, a.Nickname, a.CreatedAt, a.UpdatedAt)
		if err != nil {
			return 0, err
		}
		return res.LastInsertId()
	}
	_, err := s.db.Exec(`UPDATE accounts SET name=?,role=?,auth_type=?,cookie=?,access_token=?,refresh_token=?,expires_at=?,app_id=?,uid=?,device=?,profile=?,nickname=?,updated_at=? WHERE id=?`,
		a.Name, a.Role, a.AuthType, a.Cookie, a.AccessToken, a.RefreshToken, a.ExpiresAt, a.AppID, a.UID, a.deviceOrDefault(), a.Profile, a.Nickname, a.UpdatedAt, a.ID)
	return a.ID, err
}

func (s *Store) GetAccount(id int64) (*Account, error) {
	a := &Account{}
	err := s.db.QueryRow(`SELECT id,name,role,auth_type,cookie,access_token,refresh_token,expires_at,app_id,uid,device,profile,nickname,created_at,updated_at FROM accounts WHERE id=?`, id).
		Scan(&a.ID, &a.Name, &a.Role, &a.AuthType, &a.Cookie, &a.AccessToken, &a.RefreshToken, &a.ExpiresAt, &a.AppID, &a.UID, &a.Device, &a.Profile, &a.Nickname, &a.CreatedAt, &a.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return a, nil
}

func (s *Store) MainAccount() (*Account, error) {
	a := &Account{}
	err := s.db.QueryRow(`SELECT id,name,role,auth_type,cookie,access_token,refresh_token,expires_at,app_id,uid,device,profile,nickname,created_at,updated_at FROM accounts ORDER BY CASE role WHEN 'main' THEN 0 ELSE 1 END, id LIMIT 1`).
		Scan(&a.ID, &a.Name, &a.Role, &a.AuthType, &a.Cookie, &a.AccessToken, &a.RefreshToken, &a.ExpiresAt, &a.AppID, &a.UID, &a.Device, &a.Profile, &a.Nickname, &a.CreatedAt, &a.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return a, nil
}

// UpsertMainAccount 保证只有一个主账号行：已有则原地更新，保留 ID 与媒体库关联。
func (s *Store) UpsertMainAccount(a *Account) (int64, error) {
	if cur, err := s.MainAccount(); err == nil {
		a.ID = cur.ID
		a.CreatedAt = cur.CreatedAt
	}
	id, err := s.SaveAccount(a)
	if err == nil {
		// 单账号模式：保留当前主账号，清掉历史遗留的其它账号行。
		_, _ = s.db.Exec(`DELETE FROM accounts WHERE id <> ?`, id)
	}
	return id, err
}

func (s *Store) ListAccounts() ([]Account, error) {
	rows, err := s.db.Query(`SELECT id,name,role,auth_type,expires_at,app_id,uid,device,profile,nickname,created_at,updated_at FROM accounts ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Account, 0)
	for rows.Next() {
		var a Account
		if err := rows.Scan(&a.ID, &a.Name, &a.Role, &a.AuthType, &a.ExpiresAt, &a.AppID, &a.UID, &a.Device, &a.Profile, &a.Nickname, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// ---------- libraries ----------

type Library struct {
	ID         int64  `json:"id"`
	Name       string `json:"name"`
	AccountID  int64  `json:"accountId"`
	RemoteCID  string `json:"remoteCid"`
	LocalDir   string `json:"localDir"`
	BaseURL    string `json:"baseUrl"`
	STRMFormat string `json:"strmFormat"`
	KeepExt    bool   `json:"keepExt"`
	VideoExts  string `json:"videoExts"`
	MetaExts   string `json:"metaExts"`
	MinSize    int64  `json:"minSize"`
	ScanMode   string `json:"scanMode"`
	Cron       string `json:"cron"`
	Enabled    bool   `json:"enabled"`
	Scrape     bool   `json:"scrape"`
	LastScanAt int64  `json:"lastScanAt"`
	CreatedAt  int64  `json:"createdAt"`
	UpdatedAt  int64  `json:"updatedAt"`
}

func (s *Store) SaveLibrary(l *Library) (int64, error) {
	now := time.Now().Unix()
	if l.CreatedAt == 0 {
		l.CreatedAt = now
	}
	l.UpdatedAt = now
	if l.ID == 0 {
		res, err := s.db.Exec(`INSERT INTO libraries(name,account_id,remote_cid,local_dir,base_url,strm_format,keep_ext,video_exts,meta_exts,min_size,scan_mode,cron,enabled,scrape,created_at,updated_at)
			VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			l.Name, l.AccountID, l.RemoteCID, l.LocalDir, l.BaseURL, l.STRMFormat, b2i(l.KeepExt), l.VideoExts, l.MetaExts, l.MinSize, l.ScanMode, l.Cron, b2i(l.Enabled), b2i(l.Scrape), l.CreatedAt, l.UpdatedAt)
		if err != nil {
			return 0, err
		}
		return res.LastInsertId()
	}
	_, err := s.db.Exec(`UPDATE libraries SET name=?,account_id=?,remote_cid=?,local_dir=?,base_url=?,strm_format=?,keep_ext=?,video_exts=?,meta_exts=?,min_size=?,scan_mode=?,cron=?,enabled=?,scrape=?,updated_at=? WHERE id=?`,
		l.Name, l.AccountID, l.RemoteCID, l.LocalDir, l.BaseURL, l.STRMFormat, b2i(l.KeepExt), l.VideoExts, l.MetaExts, l.MinSize, l.ScanMode, l.Cron, b2i(l.Enabled), b2i(l.Scrape), l.UpdatedAt, l.ID)
	return l.ID, err
}

func (s *Store) GetLibrary(id int64) (*Library, error) {
	l := &Library{}
	var keep, enabled, scrape int
	err := s.db.QueryRow(`SELECT id,name,account_id,remote_cid,local_dir,base_url,strm_format,keep_ext,video_exts,meta_exts,min_size,scan_mode,cron,enabled,scrape,last_scan_at,created_at,updated_at FROM libraries WHERE id=?`, id).
		Scan(&l.ID, &l.Name, &l.AccountID, &l.RemoteCID, &l.LocalDir, &l.BaseURL, &l.STRMFormat, &keep, &l.VideoExts, &l.MetaExts, &l.MinSize, &l.ScanMode, &l.Cron, &enabled, &scrape, &l.LastScanAt, &l.CreatedAt, &l.UpdatedAt)
	if err != nil {
		return nil, err
	}
	l.KeepExt = keep != 0
	l.Enabled = enabled != 0
	l.Scrape = scrape != 0
	return l, nil
}

func (s *Store) ListLibraries() ([]Library, error) {
	rows, err := s.db.Query(`SELECT id,name,account_id,remote_cid,local_dir,base_url,strm_format,keep_ext,video_exts,meta_exts,min_size,scan_mode,cron,enabled,scrape,last_scan_at,created_at,updated_at FROM libraries ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Library, 0)
	for rows.Next() {
		var l Library
		var keep, enabled, scrape int
		if err := rows.Scan(&l.ID, &l.Name, &l.AccountID, &l.RemoteCID, &l.LocalDir, &l.BaseURL, &l.STRMFormat, &keep, &l.VideoExts, &l.MetaExts, &l.MinSize, &l.ScanMode, &l.Cron, &enabled, &scrape, &l.LastScanAt, &l.CreatedAt, &l.UpdatedAt); err != nil {
			return nil, err
		}
		l.KeepExt = keep != 0
		l.Enabled = enabled != 0
		l.Scrape = scrape != 0
		out = append(out, l)
	}
	return out, rows.Err()
}

func (s *Store) SetLibraryScanned(id int64) error {
	_, err := s.db.Exec(`UPDATE libraries SET last_scan_at=? WHERE id=?`, time.Now().Unix(), id)
	return err
}

// ---------- files / dirs ----------

type SyncedFile struct {
	ID        int64  `json:"id"`
	LibraryID int64  `json:"libraryId"`
	FID       string `json:"fid"`
	Pickcode  string `json:"pickcode"`
	CID       string `json:"cid"`
	Name      string `json:"name"`
	RelPath   string `json:"relPath"`
	STRMPath  string `json:"strmPath"`
	Size      int64  `json:"size"`
	SHA1      string `json:"sha1"`
	Status    string `json:"status"`
	UpdatedAt int64  `json:"updatedAt"`
}

func (s *Store) UpsertFile(f *SyncedFile) error {
	_, err := s.db.Exec(`INSERT INTO synced_files(library_id,fid,pickcode,cid,name,rel_path,strm_path,size,sha1,status,updated_at)
		VALUES(?,?,?,?,?,?,?,?,?,?,?)
		ON CONFLICT(library_id,fid) DO UPDATE SET pickcode=excluded.pickcode,cid=excluded.cid,name=excluded.name,
		rel_path=excluded.rel_path,strm_path=excluded.strm_path,size=excluded.size,sha1=excluded.sha1,
		status=excluded.status,updated_at=excluded.updated_at`,
		f.LibraryID, f.FID, f.Pickcode, f.CID, f.Name, f.RelPath, f.STRMPath, f.Size, f.SHA1, f.Status, time.Now().Unix())
	return err
}

func (s *Store) ListFiles(libraryID int64) ([]SyncedFile, error) {
	rows, err := s.db.Query(`SELECT id,library_id,fid,pickcode,cid,name,rel_path,strm_path,size,sha1,status,updated_at FROM synced_files WHERE library_id=?`, libraryID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SyncedFile
	for rows.Next() {
		var f SyncedFile
		if err := rows.Scan(&f.ID, &f.LibraryID, &f.FID, &f.Pickcode, &f.CID, &f.Name, &f.RelPath, &f.STRMPath, &f.Size, &f.SHA1, &f.Status, &f.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

func (s *Store) ListFilesByCID(libraryID int64, cid string) ([]SyncedFile, error) {
	rows, err := s.db.Query(`SELECT id,library_id,fid,pickcode,cid,name,rel_path,strm_path,size,sha1,status,updated_at FROM synced_files WHERE library_id=? AND cid=?`, libraryID, cid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SyncedFile
	for rows.Next() {
		var f SyncedFile
		if err := rows.Scan(&f.ID, &f.LibraryID, &f.FID, &f.Pickcode, &f.CID, &f.Name, &f.RelPath, &f.STRMPath, &f.Size, &f.SHA1, &f.Status, &f.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

func (s *Store) MarkOrphan(libraryID int64, fid string) error {
	_, err := s.db.Exec(`UPDATE synced_files SET status='orphan',updated_at=? WHERE library_id=? AND fid=?`, time.Now().Unix(), libraryID, fid)
	return err
}

func (s *Store) DeleteFile(libraryID int64, fid string) error {
	_, err := s.db.Exec(`DELETE FROM synced_files WHERE library_id=? AND fid=?`, libraryID, fid)
	return err
}

func (s *Store) UpsertDir(libraryID int64, cid, parentCID, name, relPath string) error {
	_, err := s.db.Exec(`INSERT INTO dirs(library_id,cid,parent_cid,name,rel_path,updated_at) VALUES(?,?,?,?,?,?)
		ON CONFLICT(library_id,cid) DO UPDATE SET parent_cid=excluded.parent_cid,name=excluded.name,rel_path=excluded.rel_path,updated_at=excluded.updated_at`,
		libraryID, cid, parentCID, name, relPath, time.Now().Unix())
	return err
}

type Dir struct {
	CID       string `json:"cid"`
	ParentCID string `json:"parentCid"`
	Name      string `json:"name"`
	RelPath   string `json:"relPath"`
}

func (s *Store) ListDirs(libraryID int64) ([]Dir, error) {
	rows, err := s.db.Query(`SELECT cid,parent_cid,name,rel_path FROM dirs WHERE library_id=?`, libraryID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Dir
	for rows.Next() {
		var d Dir
		if err := rows.Scan(&d.CID, &d.ParentCID, &d.Name, &d.RelPath); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// ---------- tasks ----------

type Task struct {
	ID        int64  `json:"id"`
	Kind      string `json:"kind"`
	LibraryID int64  `json:"libraryId"`
	Status    string `json:"status"`
	Message   string `json:"message"`
	DedupeKey string `json:"dedupeKey,omitempty"`
	Payload   string `json:"payload,omitempty"`
	StartedAt int64  `json:"startedAt"`
	EndedAt   int64  `json:"endedAt"`
	CreatedAt int64  `json:"createdAt"`
}

func (s *Store) CreateTask(kind string, libraryID int64) (int64, error) {
	res, err := s.db.Exec(`INSERT INTO tasks(kind,library_id,status,created_at) VALUES(?,?,'queued',?)`, kind, libraryID, time.Now().Unix())
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// EnqueueTask 入队一条任务;dedupeKey 非空且已有同键排队任务时返回既有任务
// (reused=true),不产生重复排队。payload 是执行参数 JSON。
func (s *Store) EnqueueTask(kind string, libraryID int64, dedupeKey, payload string) (id int64, reused bool, err error) {
	now := time.Now().Unix()
	if dedupeKey != "" {
		res, err := s.db.Exec(`INSERT INTO tasks(kind,library_id,status,dedupe_key,payload,created_at)
			VALUES(?,?,'queued',?,?,?)
			ON CONFLICT(dedupe_key) WHERE status='queued' AND dedupe_key <> '' DO NOTHING`,
			kind, libraryID, dedupeKey, payload, now)
		if err == nil {
			if n, _ := res.RowsAffected(); n > 0 {
				id, _ := res.LastInsertId()
				return id, false, nil
			}
			// 冲突(已有排队任务):查出那条返回
			var exist int64
			qerr := s.db.QueryRow(`SELECT id FROM tasks WHERE dedupe_key=? AND status='queued' LIMIT 1`, dedupeKey).Scan(&exist)
			if qerr == nil {
				return exist, true, nil
			}
			// 查不到说明并发下刚被取走,落回普通插入
		}
	}
	res, err := s.db.Exec(`INSERT INTO tasks(kind,library_id,status,dedupe_key,payload,created_at) VALUES(?,?,'queued',?,?,?)`,
		kind, libraryID, dedupeKey, payload, now)
	if err != nil {
		return 0, false, err
	}
	id, err = res.LastInsertId()
	return id, false, err
}

// ClaimNextTask 原子取出最早一条排队任务并置为 running;无任务返回 (nil, nil)。
func (s *Store) ClaimNextTask() (*Task, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }() // Commit 后 Rollback 无效,安全
	var t Task
	err = tx.QueryRow(`SELECT id,kind,library_id,dedupe_key,payload FROM tasks WHERE status='queued' ORDER BY id LIMIT 1`).
		Scan(&t.ID, &t.Kind, &t.LibraryID, &t.DedupeKey, &t.Payload)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	now := time.Now().Unix()
	if _, err := tx.Exec(`UPDATE tasks SET status='running',message='',started_at=CASE WHEN started_at=0 THEN ? ELSE started_at END WHERE id=?`, now, t.ID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	t.Status = "running"
	return &t, nil
}

// SetTaskProgress 运行中刷新 message(不动 started_at/ended_at)。
func (s *Store) SetTaskProgress(id int64, message string) error {
	_, err := s.db.Exec(`UPDATE tasks SET message=? WHERE id=? AND status='running'`, message, id)
	return err
}

func (s *Store) UpdateTask(id int64, status, message string) error {
	now := time.Now().Unix()
	var started int64
	if status == "running" {
		started = now
	}
	_, err := s.db.Exec(`UPDATE tasks SET status=?,message=?,started_at=CASE WHEN ? > 0 THEN ? ELSE started_at END,
		ended_at=CASE WHEN ? IN ('done','failed') THEN ? ELSE ended_at END WHERE id=?`,
		status, message, started, started, status, now, id)
	return err
}

// RecoverStuckTasks 启动自愈:上次进程中断遗留的 running 任务标为 failed。
func (s *Store) RecoverStuckTasks() error {
	_, err := s.db.Exec(`UPDATE tasks SET status='failed',message='进程中断',ended_at=? WHERE status='running'`, time.Now().Unix())
	return err
}

func (s *Store) ListTasks(limit int) ([]Task, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.db.Query(`SELECT id,kind,library_id,status,message,dedupe_key,payload,started_at,ended_at,created_at FROM tasks ORDER BY id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Task, 0)
	for rows.Next() {
		var t Task
		if err := rows.Scan(&t.ID, &t.Kind, &t.LibraryID, &t.Status, &t.Message, &t.DedupeKey, &t.Payload, &t.StartedAt, &t.EndedAt, &t.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (a *Account) deviceOrDefault() string {
	if a.Device == "" {
		return "web"
	}
	return a.Device
}

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}

func (s *Store) DeleteAccount(id int64) error {
	_, err := s.db.Exec(`DELETE FROM accounts WHERE id=?`, id)
	return err
}

func (s *Store) DeleteLibrary(id int64) error {
	if _, err := s.db.Exec(`DELETE FROM libraries WHERE id=?`, id); err != nil {
		return err
	}
	if _, err := s.db.Exec(`DELETE FROM dirs WHERE library_id=?`, id); err != nil {
		return err
	}
	_, err := s.db.Exec(`DELETE FROM synced_files WHERE library_id=?`, id)
	return err
}

// ---------- sync events ----------

// ---------- sync events ----------
//
// 两阶段消费:事件先落库 pending(中断/重启后原样重放),本轮处理完成后
// 批量标 done 并写 note(self=整理自产 / outside=不涉及媒体库)。

// AddEventPending 记录一条生活事件(pending);已存在时返回既有行 id 与 isNew=false
// (游标未推进的重放轮里,旧事件仍要能标 done)。
func (s *Store) AddEventPending(accountID int64, eventID, kind, payload, pickcode string) (int64, bool, error) {
	res, err := s.db.Exec(`INSERT OR IGNORE INTO sync_events(account_id,event_id,kind,payload,pickcode,status,created_at)
		VALUES(?,?,?,?,?,'pending',?)`, accountID, eventID, kind, payload, pickcode, time.Now().Unix())
	if err != nil {
		return 0, false, err
	}
	if n, _ := res.RowsAffected(); n > 0 {
		id, _ := res.LastInsertId()
		return id, true, nil
	}
	var exist int64
	qerr := s.db.QueryRow(`SELECT id FROM sync_events WHERE account_id=? AND event_id=?`, accountID, eventID).Scan(&exist)
	if qerr != nil {
		return 0, false, qerr
	}
	return exist, false, nil
}

// ApplyEvents 把本轮已处理的事件标 done 并写 note。
func (s *Store) ApplyEvents(ids []int64, note string) error {
	if len(ids) == 0 {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	stmt, err := tx.Prepare(`UPDATE sync_events SET status='done', note=?, applied_at=? WHERE id=?`)
	if err != nil {
		_ = tx.Rollback()
		return err
	}
	defer stmt.Close()
	now := time.Now().Unix()
	for _, id := range ids {
		if _, err := stmt.Exec(note, now, id); err != nil {
			_ = tx.Rollback()
			return err
		}
	}
	return tx.Commit()
}

// ListPendingEvents 返回遗留的 pending 事件(重启/中断恢复用),按 id 正序。
func (s *Store) ListPendingEvents(accountID int64) ([]SyncEvent, error) {
	rows, err := s.db.Query(`SELECT id,event_id,kind,payload,pickcode FROM sync_events WHERE account_id=? AND status='pending' ORDER BY id`, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SyncEvent
	for rows.Next() {
		var e SyncEvent
		if err := rows.Scan(&e.ID, &e.EventID, &e.Kind, &e.Payload, &e.Pickcode); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

type SyncEvent struct {
	ID       int64
	EventID  string
	Kind     string
	Payload  string
	Pickcode string
}

// CountPendingEvents 返回待处理事件数(状态页"积压")。
func (s *Store) CountPendingEvents(accountID int64) (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM sync_events WHERE account_id=? AND status='pending'`, accountID).Scan(&n)
	return n, err
}

// MaxEventID 返回台账里最大的数字事件 id(全量推游标用);非纯数字事件存在时返回空。
func (s *Store) MaxEventID(accountID int64) string {
	var max any
	err := s.db.QueryRow(`SELECT MAX(CAST(event_id AS INTEGER)) FROM sync_events
		WHERE account_id=? AND event_id GLOB '[0-9]*' AND event_id NOT GLOB '*[^0-9]*'`, accountID).Scan(&max)
	if err != nil || max == nil {
		return ""
	}
	sid, _ := max.(int64)
	if sid == 0 {
		return ""
	}
	return strconv.FormatInt(sid, 10)
}

// MarkAllEventsApplied 把 pending 事件全部标 done(全量同步已覆盖窗口)。
func (s *Store) MarkAllEventsApplied(accountID int64, note string) error {
	_, err := s.db.Exec(`UPDATE sync_events SET status='done', note=?, applied_at=? WHERE account_id=? AND status='pending'`,
		note, time.Now().Unix(), accountID)
	return err
}

// PruneAppliedEvents 清理已消费的旧事件(每日维护调用)。
func (s *Store) PruneAppliedEvents(days int) (int64, error) {
	if days <= 0 {
		days = 30
	}
	res, err := s.db.Exec(`DELETE FROM sync_events WHERE status='done' AND applied_at > 0 AND applied_at < ?`,
		time.Now().Unix()-int64(days)*86400)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

func (s *Store) CountEvents(accountID int64) (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM sync_events WHERE account_id=?`, accountID).Scan(&n)
	return n, err
}

// ---------- event suppress ----------
//
// 整理/删除等自产 115 写操作的事件登记:TTL 内增量遇到直接跳过(self)。
// peek 只查不删——增量遇目录暂时读不到会整轮重来,查时消费的话下一轮
// 没标记可命中;事件标 done 后由维护统一清过期行。

func (s *Store) MarkSuppressed(fileIDs []string, op string, ttl time.Duration) error {
	if len(fileIDs) == 0 {
		return nil
	}
	expire := time.Now().Add(ttl).Unix()
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	stmt, err := tx.Prepare(`INSERT INTO event_suppress(file_id,op,expire_at) VALUES(?,?,?)
		ON CONFLICT(file_id) DO UPDATE SET op=excluded.op, expire_at=excluded.expire_at`)
	if err != nil {
		_ = tx.Rollback()
		return err
	}
	defer stmt.Close()
	for _, id := range fileIDs {
		if id == "" {
			continue
		}
		if _, err := stmt.Exec(id, op, expire); err != nil {
			_ = tx.Rollback()
			return err
		}
	}
	return tx.Commit()
}

// PeekSuppressed 批量查:哪些 fid 在抑制期内。只查不删。
func (s *Store) PeekSuppressed(fileIDs []string) (map[string]bool, error) {
	out := map[string]bool{}
	if len(fileIDs) == 0 {
		return out, nil
	}
	now := time.Now().Unix()
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	stmt, err := tx.Prepare(`SELECT 1 FROM event_suppress WHERE file_id=? AND expire_at > ?`)
	if err != nil {
		_ = tx.Rollback()
		return nil, err
	}
	defer stmt.Close()
	for _, id := range fileIDs {
		if id == "" {
			continue
		}
		var one int
		if err := stmt.QueryRow(id, now).Scan(&one); err == nil {
			out[id] = true
		}
	}
	_ = tx.Rollback() // 只读事务
	return out, nil
}

func (s *Store) CleanupSuppressed() (int64, error) {
	res, err := s.db.Exec(`DELETE FROM event_suppress WHERE expire_at <= ?`, time.Now().Unix())
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

// ---------- path cache ----------
//
// cid → 路径缓存。生活事件只带 parent_id,move/rename 的旧路径也只能从
// 这里拿。它是有失效要求的缓存:网盘目录删除/移动后必须 ForgetDirSubtree,
// 否则"已删目录"永久算在媒体库里。

type PathRow struct {
	CID       string
	ParentCID string
	Name      string
	Path      string
}

func (s *Store) UpsertPathRows(rows []PathRow) error {
	if len(rows) == 0 {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	stmt, err := tx.Prepare(`INSERT INTO path_cache(cid,parent_cid,name,path,updated_at) VALUES(?,?,?,?,?)
		ON CONFLICT(cid) DO UPDATE SET parent_cid=excluded.parent_cid,name=excluded.name,path=excluded.path,updated_at=excluded.updated_at`)
	if err != nil {
		_ = tx.Rollback()
		return err
	}
	defer stmt.Close()
	now := time.Now().Unix()
	for _, r := range rows {
		if r.CID == "" {
			continue
		}
		if _, err := stmt.Exec(r.CID, r.ParentCID, r.Name, r.Path, now); err != nil {
			_ = tx.Rollback()
			return err
		}
	}
	return tx.Commit()
}

// GetPath 查缓存;found=false 表示未命中(调用方回源接口)。
func (s *Store) GetPath(cid string) (row PathRow, found bool) {
	err := s.db.QueryRow(`SELECT cid,parent_cid,name,path FROM path_cache WHERE cid=?`, cid).
		Scan(&row.CID, &row.ParentCID, &row.Name, &row.Path)
	return row, err == nil
}

// ForgetDirSubtree 删除 cid 子树的所有缓存行(目录删除/移动后失效用)。
// 行数不大,全量载入内存走 BFS。
func (s *Store) ForgetDirSubtree(rootCID string) (int64, error) {
	if rootCID == "" {
		return 0, nil
	}
	rows, err := s.db.Query(`SELECT cid, parent_cid FROM path_cache`)
	if err != nil {
		return 0, err
	}
	parents := map[string][]string{}
	defer rows.Close()
	for rows.Next() {
		var cid, parent string
		if err := rows.Scan(&cid, &parent); err != nil {
			return 0, err
		}
		parents[parent] = append(parents[parent], cid)
	}
	kill := map[string]bool{rootCID: true}
	queue := []string{rootCID}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		for _, child := range parents[cur] {
			if !kill[child] {
				kill[child] = true
				queue = append(queue, child)
			}
		}
	}
	if len(kill) == 0 {
		return 0, nil
	}
	ids := make([]string, 0, len(kill))
	for cid := range kill {
		ids = append(ids, cid)
	}
	var n int64
	for _, cid := range ids {
		res, err := s.db.Exec(`DELETE FROM path_cache WHERE cid=?`, cid)
		if err == nil {
			nn, _ := res.RowsAffected()
			n += nn
		}
	}
	return n, nil
}

// ---------- emby settings ----------

type EmbyConfig struct {
	Base         string `json:"base"`
	APIKey       string `json:"apiKey"`
	WebhookToken string `json:"webhookToken"`
	DeleteRemote bool   `json:"deleteRemote"`
}

func (s *Store) GetEmbyConfig() EmbyConfig {
	return EmbyConfig{
		Base:         s.GetSetting("emby_base", ""),
		APIKey:       s.GetSetting("emby_api_key", ""),
		WebhookToken: s.GetSetting("emby_webhook_token", ""),
		DeleteRemote: s.GetSetting("emby_delete_remote", "0") == "1",
	}
}

func (s *Store) SaveEmbyConfig(c EmbyConfig) error {
	if err := s.SetSetting("emby_base", c.Base); err != nil {
		return err
	}
	if err := s.SetSetting("emby_api_key", c.APIKey); err != nil {
		return err
	}
	if err := s.SetSetting("emby_webhook_token", c.WebhookToken); err != nil {
		return err
	}
	v := "0"
	if c.DeleteRemote {
		v = "1"
	}
	return s.SetSetting("emby_delete_remote", v)
}

// Stats 返回台账统计与最近扫描时间。
func (s *Store) Stats() (files, orphans int, lastScan int64, err error) {
	err = s.db.QueryRow(`SELECT COUNT(*), COALESCE(SUM(CASE WHEN status='orphan' THEN 1 ELSE 0 END),0) FROM synced_files`).Scan(&files, &orphans)
	if err != nil {
		return
	}
	_ = s.db.QueryRow(`SELECT COALESCE(MAX(last_scan_at),0) FROM libraries`).Scan(&lastScan)
	return
}

// LogoutMain 清空主账号凭据但保留账号行，媒体库关联不变。
func (s *Store) LogoutMain() error {
	_, err := s.db.Exec(`UPDATE accounts SET cookie='', access_token='', refresh_token='', expires_at=0,
		auth_type='none', profile='', nickname='未登录', updated_at=?`, time.Now().Unix())
	return err
}

// SetMany 在一个事务里写入多条设置，避免十几次独立提交在扫描占锁时排队。
func (s *Store) SetMany(m map[string]string) error {
	if len(m) == 0 {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	stmt, err := tx.Prepare(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`)
	if err != nil {
		_ = tx.Rollback()
		return err
	}
	defer stmt.Close()
	for k, v := range m {
		if _, err := stmt.Exec(k, v); err != nil {
			_ = tx.Rollback()
			return err
		}
	}
	return tx.Commit()
}

// ---------- deep delete records ----------
//
// 一次删除 = 一条记录;Fids 是 115 回收站还原的唯一凭据(台账行已随之删除,
// 事后要还原只能靠这里),Status done/rejected/failed。

type DeepDeleteRecord struct {
	ID           int64    `json:"id"`
	ItemID       string   `json:"itemId"`
	ItemType     string   `json:"itemType"`
	ItemName     string   `json:"itemName"`
	MediaType    string   `json:"mediaType"`
	EpisodeLabel string   `json:"episodeLabel"`
	RelPaths     []string `json:"relPaths"`
	FIDs         []string `json:"fids"`
	Status       string   `json:"status"`
	Message      string   `json:"message"`
	VideoCount   int      `json:"videoCount"`
	RemoteCount  int      `json:"remoteCount"`
	CreatedAt    int64    `json:"createdAt"`
}

func (s *Store) SaveDeepDeleteRecord(r *DeepDeleteRecord) error {
	if r.CreatedAt == 0 {
		r.CreatedAt = time.Now().Unix()
	}
	paths, _ := jsonMarshal(r.RelPaths)
	fids, _ := jsonMarshal(r.FIDs)
	res, err := s.db.Exec(`INSERT INTO deep_delete_records(item_id,item_type,item_name,media_type,episode_label,rel_paths,fids,status,message,video_count,remote_count,created_at)
		VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
		r.ItemID, r.ItemType, r.ItemName, r.MediaType, r.EpisodeLabel, paths, fids, r.Status, r.Message, r.VideoCount, r.RemoteCount, r.CreatedAt)
	if err != nil {
		return err
	}
	r.ID, _ = res.LastInsertId()
	return nil
}

func (s *Store) ListDeepDeleteRecords(status string, limit int) ([]DeepDeleteRecord, error) {
	if limit <= 0 {
		limit = 100
	}
	q := `SELECT id,item_id,item_type,item_name,media_type,episode_label,rel_paths,fids,status,message,video_count,remote_count,created_at
		FROM deep_delete_records`
	var args []any
	if status != "" {
		q += ` WHERE status=?`
		args = append(args, status)
	}
	q += ` ORDER BY id DESC LIMIT ?`
	args = append(args, limit)
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]DeepDeleteRecord, 0)
	for rows.Next() {
		var r DeepDeleteRecord
		var paths, fids string
		if err := rows.Scan(&r.ID, &r.ItemID, &r.ItemType, &r.ItemName, &r.MediaType, &r.EpisodeLabel,
			&paths, &fids, &r.Status, &r.Message, &r.VideoCount, &r.RemoteCount, &r.CreatedAt); err != nil {
			return nil, err
		}
		r.RelPaths = jsonUnmarshalStrings(paths)
		r.FIDs = jsonUnmarshalStrings(fids)
		out = append(out, r)
	}
	return out, rows.Err()
}

// DeepDeleteStats 状态计数与近 30 天删除量。
func (s *Store) DeepDeleteStats() (counts map[string]int, videos30 int, remote30 int, err error) {
	counts = map[string]int{}
	rows, err := s.db.Query(`SELECT status, COUNT(*) FROM deep_delete_records GROUP BY status`)
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var st string
		var n int
		if err := rows.Scan(&st, &n); err != nil {
			return counts, 0, 0, err
		}
		counts[st] = n
	}
	cutoff := time.Now().Unix() - 30*86400
	err = s.db.QueryRow(`SELECT COALESCE(SUM(video_count),0), COALESCE(SUM(remote_count),0)
		FROM deep_delete_records WHERE status='done' AND created_at >= ?`, cutoff).Scan(&videos30, &remote30)
	return
}

// PruneDeepDeleteRecords 清理过期记录(默认 90 天)。
func (s *Store) PruneDeepDeleteRecords(days int) (int64, error) {
	if days <= 0 {
		days = 90
	}
	res, err := s.db.Exec(`DELETE FROM deep_delete_records WHERE created_at < ?`,
		time.Now().Unix()-int64(days)*86400)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

func jsonMarshal(v any) (string, error) {
	b, err := json.Marshal(v)
	return string(b), err
}

func jsonUnmarshalStrings(s string) []string {
	if s == "" {
		return nil
	}
	var out []string
	if err := json.Unmarshal([]byte(s), &out); err != nil {
		return nil
	}
	return out
}

// ---------- scrape records ----------

type ScrapeRecord struct {
	ID        int64  `json:"id"`
	LibraryID int64  `json:"libraryId"`
	OK        int    `json:"ok"`
	Failed    int    `json:"failed"`
	Skipped   int    `json:"skipped"`
	Message   string `json:"message"`
	CreatedAt int64  `json:"createdAt"`
}

func (s *Store) SaveScrapeRecord(r *ScrapeRecord) error {
	if r.CreatedAt == 0 {
		r.CreatedAt = time.Now().Unix()
	}
	res, err := s.db.Exec(`INSERT INTO scrape_records(library_id,ok,failed,skipped,message,created_at) VALUES(?,?,?,?,?,?)`,
		r.LibraryID, r.OK, r.Failed, r.Skipped, r.Message, r.CreatedAt)
	if err != nil {
		return err
	}
	r.ID, _ = res.LastInsertId()
	return nil
}

func (s *Store) ListScrapeRecords(limit int) ([]ScrapeRecord, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.db.Query(`SELECT id,library_id,ok,failed,skipped,message,created_at FROM scrape_records ORDER BY id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]ScrapeRecord, 0)
	for rows.Next() {
		var r ScrapeRecord
		if err := rows.Scan(&r.ID, &r.LibraryID, &r.OK, &r.Failed, &r.Skipped, &r.Message, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
