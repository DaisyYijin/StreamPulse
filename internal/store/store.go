package store

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
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
	db, err := sql.Open("sqlite", "file:"+p+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(10000)&_pragma=foreign_keys(1)")
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

func (s *Store) migrate() error {
	if _, err := s.db.Exec(schema); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	// 旧库补列：失败（已存在）忽略。
	_, _ = s.db.Exec(`ALTER TABLE accounts ADD COLUMN device TEXT NOT NULL DEFAULT 'web'`)
	return nil
}

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
		res, err := s.db.Exec(`INSERT INTO accounts(name,role,auth_type,cookie,access_token,refresh_token,expires_at,app_id,uid,device,nickname,created_at,updated_at)
			VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			a.Name, a.Role, a.AuthType, a.Cookie, a.AccessToken, a.RefreshToken, a.ExpiresAt, a.AppID, a.UID, a.deviceOrDefault(), a.Nickname, a.CreatedAt, a.UpdatedAt)
		if err != nil {
			return 0, err
		}
		return res.LastInsertId()
	}
	_, err := s.db.Exec(`UPDATE accounts SET name=?,role=?,auth_type=?,cookie=?,access_token=?,refresh_token=?,expires_at=?,app_id=?,uid=?,device=?,nickname=?,updated_at=? WHERE id=?`,
		a.Name, a.Role, a.AuthType, a.Cookie, a.AccessToken, a.RefreshToken, a.ExpiresAt, a.AppID, a.UID, a.deviceOrDefault(), a.Nickname, a.UpdatedAt, a.ID)
	return a.ID, err
}

func (s *Store) GetAccount(id int64) (*Account, error) {
	a := &Account{}
	err := s.db.QueryRow(`SELECT id,name,role,auth_type,cookie,access_token,refresh_token,expires_at,app_id,uid,device,nickname,created_at,updated_at FROM accounts WHERE id=?`, id).
		Scan(&a.ID, &a.Name, &a.Role, &a.AuthType, &a.Cookie, &a.AccessToken, &a.RefreshToken, &a.ExpiresAt, &a.AppID, &a.UID, &a.Device, &a.Nickname, &a.CreatedAt, &a.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return a, nil
}

func (s *Store) MainAccount() (*Account, error) {
	a := &Account{}
	err := s.db.QueryRow(`SELECT id,name,role,auth_type,cookie,access_token,refresh_token,expires_at,app_id,uid,device,nickname,created_at,updated_at FROM accounts ORDER BY CASE role WHEN 'main' THEN 0 ELSE 1 END, id LIMIT 1`).
		Scan(&a.ID, &a.Name, &a.Role, &a.AuthType, &a.Cookie, &a.AccessToken, &a.RefreshToken, &a.ExpiresAt, &a.AppID, &a.UID, &a.Device, &a.Nickname, &a.CreatedAt, &a.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return a, nil
}

func (s *Store) ListAccounts() ([]Account, error) {
	rows, err := s.db.Query(`SELECT id,name,role,auth_type,expires_at,app_id,uid,device,nickname,created_at,updated_at FROM accounts ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Account, 0)
	for rows.Next() {
		var a Account
		if err := rows.Scan(&a.ID, &a.Name, &a.Role, &a.AuthType, &a.ExpiresAt, &a.AppID, &a.UID, &a.Device, &a.Nickname, &a.CreatedAt, &a.UpdatedAt); err != nil {
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
		res, err := s.db.Exec(`INSERT INTO libraries(name,account_id,remote_cid,local_dir,base_url,strm_format,keep_ext,video_exts,meta_exts,min_size,scan_mode,cron,enabled,created_at,updated_at)
			VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
			l.Name, l.AccountID, l.RemoteCID, l.LocalDir, l.BaseURL, l.STRMFormat, b2i(l.KeepExt), l.VideoExts, l.MetaExts, l.MinSize, l.ScanMode, l.Cron, b2i(l.Enabled), l.CreatedAt, l.UpdatedAt)
		if err != nil {
			return 0, err
		}
		return res.LastInsertId()
	}
	_, err := s.db.Exec(`UPDATE libraries SET name=?,account_id=?,remote_cid=?,local_dir=?,base_url=?,strm_format=?,keep_ext=?,video_exts=?,meta_exts=?,min_size=?,scan_mode=?,cron=?,enabled=?,updated_at=? WHERE id=?`,
		l.Name, l.AccountID, l.RemoteCID, l.LocalDir, l.BaseURL, l.STRMFormat, b2i(l.KeepExt), l.VideoExts, l.MetaExts, l.MinSize, l.ScanMode, l.Cron, b2i(l.Enabled), l.UpdatedAt, l.ID)
	return l.ID, err
}

func (s *Store) GetLibrary(id int64) (*Library, error) {
	l := &Library{}
	var keep, enabled int
	err := s.db.QueryRow(`SELECT id,name,account_id,remote_cid,local_dir,base_url,strm_format,keep_ext,video_exts,meta_exts,min_size,scan_mode,cron,enabled,last_scan_at,created_at,updated_at FROM libraries WHERE id=?`, id).
		Scan(&l.ID, &l.Name, &l.AccountID, &l.RemoteCID, &l.LocalDir, &l.BaseURL, &l.STRMFormat, &keep, &l.VideoExts, &l.MetaExts, &l.MinSize, &l.ScanMode, &l.Cron, &enabled, &l.LastScanAt, &l.CreatedAt, &l.UpdatedAt)
	if err != nil {
		return nil, err
	}
	l.KeepExt = keep != 0
	l.Enabled = enabled != 0
	return l, nil
}

func (s *Store) ListLibraries() ([]Library, error) {
	rows, err := s.db.Query(`SELECT id,name,account_id,remote_cid,local_dir,base_url,strm_format,keep_ext,video_exts,meta_exts,min_size,scan_mode,cron,enabled,last_scan_at,created_at,updated_at FROM libraries ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Library, 0)
	for rows.Next() {
		var l Library
		var keep, enabled int
		if err := rows.Scan(&l.ID, &l.Name, &l.AccountID, &l.RemoteCID, &l.LocalDir, &l.BaseURL, &l.STRMFormat, &keep, &l.VideoExts, &l.MetaExts, &l.MinSize, &l.ScanMode, &l.Cron, &enabled, &l.LastScanAt, &l.CreatedAt, &l.UpdatedAt); err != nil {
			return nil, err
		}
		l.KeepExt = keep != 0
		l.Enabled = enabled != 0
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

func (s *Store) ListTasks(limit int) ([]Task, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.db.Query(`SELECT id,kind,library_id,status,message,started_at,ended_at,created_at FROM tasks ORDER BY id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Task, 0)
	for rows.Next() {
		var t Task
		if err := rows.Scan(&t.ID, &t.Kind, &t.LibraryID, &t.Status, &t.Message, &t.StartedAt, &t.EndedAt, &t.CreatedAt); err != nil {
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

// AddEvent 记录一条生活事件；重复 event_id 返回 false。
func (s *Store) AddEvent(accountID int64, eventID, kind, payload string) (bool, error) {
	res, err := s.db.Exec(`INSERT OR IGNORE INTO sync_events(account_id,event_id,kind,payload,status,created_at)
		VALUES(?,?,?,?,'done',?)`, accountID, eventID, kind, payload, time.Now().Unix())
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

func (s *Store) CountEvents(accountID int64) (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM sync_events WHERE account_id=?`, accountID).Scan(&n)
	return n, err
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
