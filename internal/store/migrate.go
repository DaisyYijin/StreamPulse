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
