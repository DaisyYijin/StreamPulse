package store

import (
	"database/sql"
	"fmt"
)

// 迁移框架:SQLite PRAGMA user_version 记录当前版本,按序执行增量迁移。
// 每个迁移独立事务;旧库(表已存在但 user_version=0)靠 IF NOT EXISTS 与
// 可忽略的 ALTER 幂等对齐到 v1,之后只走真正的增量。

type migration struct {
	version int
	name    string
	fn      func(tx *sql.Tx) error
}

// migrations 必须按 version 严格递增;追加新迁移只往尾部加。
var migrations = []migration{
	{1, "init schema", migrateV1},
	{2, "task queue columns", migrateV2},
	{3, "event suppress / path cache / event lifecycle", migrateV3},
	{4, "deep delete records", migrateV4},
}

func (s *Store) migrate() error {
	var v int
	if err := s.db.QueryRow(`PRAGMA user_version`).Scan(&v); err != nil {
		return fmt.Errorf("read user_version: %w", err)
	}
	for _, m := range migrations {
		if m.version <= v {
			continue
		}
		tx, err := s.db.Begin()
		if err != nil {
			return err
		}
		if err := m.fn(tx); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("migration %d %s: %w", m.version, m.name, err)
		}
		// user_version 不能参数绑定;version 是代码内常量,拼接安全
		if _, err := tx.Exec(fmt.Sprintf(`PRAGMA user_version = %d`, m.version)); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("migration %d set user_version: %w", m.version, err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("migration %d commit: %w", m.version, err)
		}
	}
	return nil
}

// v1 是 P0 骨架的完整 schema。对全新库与旧库(已建表)都幂等。
func migrateV1(tx *sql.Tx) error {
	if _, err := tx.Exec(schema); err != nil {
		return err
	}
	// 旧库补列:失败(已存在)忽略。
	_, _ = tx.Exec(`ALTER TABLE accounts ADD COLUMN device TEXT NOT NULL DEFAULT 'web'`)
	_, _ = tx.Exec(`ALTER TABLE accounts ADD COLUMN profile TEXT NOT NULL DEFAULT ''`)
	return nil
}

// v2 任务队列化:dedupe_key 合并重复入队;payload 存执行参数 JSON。
func migrateV2(tx *sql.Tx) error {
	_, err := tx.Exec(`ALTER TABLE tasks ADD COLUMN dedupe_key TEXT NOT NULL DEFAULT ''`)
	if err != nil {
		_ = err // 列已存在(理论上只在手工改过的库发生)则跳过
	}
	_, err = tx.Exec(`ALTER TABLE tasks ADD COLUMN payload TEXT NOT NULL DEFAULT ''`)
	_ = err
	// 同一 dedupe_key 只允许一条排队中的任务
	_, err = tx.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_dedupe ON tasks(dedupe_key) WHERE status='queued' AND dedupe_key <> ''`)
	return err
}

// v3 同步可靠性三张地基:
//   event_suppress  整理/删除自产的 115 事件登记,增量遇到直接跳过(self)
//   path_cache      cid → 路径缓存(生活事件只有 parent_id,要还原路径)
//   sync_events 补列 note/pickcode,事件两阶段消费(pending→done)
func migrateV3(tx *sql.Tx) error {
	if _, err := tx.Exec(`CREATE TABLE IF NOT EXISTS event_suppress (
	  file_id   TEXT PRIMARY KEY,
	  op        TEXT NOT NULL DEFAULT '',
	  expire_at INTEGER NOT NULL
	)`); err != nil {
		return err
	}
	if _, err := tx.Exec(`CREATE TABLE IF NOT EXISTS path_cache (
	  cid        TEXT PRIMARY KEY,
	  parent_cid TEXT NOT NULL DEFAULT '',
	  name       TEXT NOT NULL DEFAULT '',
	  path       TEXT NOT NULL DEFAULT '',
	  updated_at INTEGER NOT NULL
	)`); err != nil {
		return err
	}
	_, _ = tx.Exec(`ALTER TABLE sync_events ADD COLUMN note TEXT NOT NULL DEFAULT ''`)
	_, _ = tx.Exec(`ALTER TABLE sync_events ADD COLUMN pickcode TEXT NOT NULL DEFAULT ''`)
	_, _ = tx.Exec(`ALTER TABLE sync_events ADD COLUMN applied_at INTEGER NOT NULL DEFAULT 0`)
	_, err := tx.Exec(`CREATE INDEX IF NOT EXISTS idx_events_status ON sync_events(account_id, status)`)
	return err
}

// v4 深删记录区:每次执行的完整凭据(fids 是 115 回收站还原的唯一凭据)。
func migrateV4(tx *sql.Tx) error {
	_, err := tx.Exec(`CREATE TABLE IF NOT EXISTS deep_delete_records (
	  id           INTEGER PRIMARY KEY AUTOINCREMENT,
	  item_id      TEXT NOT NULL DEFAULT '',
	  item_type    TEXT NOT NULL DEFAULT '',
	  item_name    TEXT NOT NULL DEFAULT '',
	  media_type   TEXT NOT NULL DEFAULT '',
	  episode_label TEXT NOT NULL DEFAULT '',
	  rel_paths    TEXT NOT NULL DEFAULT '[]',
	  fids         TEXT NOT NULL DEFAULT '[]',
	  status       TEXT NOT NULL DEFAULT 'done',
	  message      TEXT NOT NULL DEFAULT '',
	  video_count  INTEGER NOT NULL DEFAULT 0,
	  remote_count INTEGER NOT NULL DEFAULT 0,
	  created_at   INTEGER NOT NULL
	)`)
	return err
}
