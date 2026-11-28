package backup

import (
	"archive/zip"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// 备份包 = SQLite 快照(VACUUM INTO,运行中可安全导出)+ config 目录密钥 + manifest。
// 恢复不替换运行中的文件:上传包 → 校验 → 解到 restore-pending → 下次启动
// 在开库之前应用(先打 prerestore 备份)→ 结果写 .restore-result.json 给页面看。

const manifestName = "manifest.json"

// Export 打包备份 zip。snapshot 是 store.SnapshotTo 产出的 SQLite 快照文件;
// configDir 第一层的密钥/配置文件一并打包(可选文件缺失则跳过)。
func Export(dst, snapshot, configDir string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o700); err != nil {
		return err
	}
	if _, err := os.Stat(snapshot); err != nil {
		return fmt.Errorf("数据库快照不存在: %w", err)
	}
	defer os.Remove(snapshot)
	zf, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer zf.Close()
	zw := zip.NewWriter(zf)
	addFile := func(name, src string) error {
		f, err := os.Open(src)
		if err != nil {
			if os.IsNotExist(err) {
				return nil // 可选文件
			}
			return err
		}
		defer f.Close()
		w, err := zw.Create(name)
		if err != nil {
			return err
		}
		_, err = io.Copy(w, f)
		return err
	}
	if err := addFile("streampulse.db", snapshot); err != nil {
		zw.Close()
		return err
	}
	// config 第一层(密钥/配置),不递归
	if entries, err := os.ReadDir(configDir); err == nil {
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			if err := addFile("config/"+e.Name(), filepath.Join(configDir, e.Name())); err != nil {
				zw.Close()
				return err
			}
		}
	}
	manifest := fmt.Sprintf(`{"created_at":%d,"created":"%s"}`, time.Now().Unix(), time.Now().Format(time.RFC3339))
	if w, err := zw.Create(manifestName); err == nil {
		_, _ = w.Write([]byte(manifest))
	}
	return zw.Close()
}

// VacuumInto 由 store 层执行(这里避免 import store 造成环)。

// StageRestore 校验上传的备份包并解到 restorePending 目录,下次启动应用。
func StageRestore(zipPath, restorePending string) error {
	zf, err := os.Open(zipPath)
	if err != nil {
		return err
	}
	defer zf.Close()
	zr, err := zip.NewReader(zf, fileSize(zipPath))
	if err != nil {
		return fmt.Errorf("不是有效的备份包: %w", err)
	}
	if err := os.MkdirAll(restorePending, 0o700); err != nil {
		return err
	}
	allowed := map[string]bool{
		"streampulse.db": true, manifestName: true,
	}
	for _, f := range zr.File {
		name := filepath.ToSlash(f.Name)
		if strings.Contains(name, "..") || strings.HasPrefix(name, "/") {
			continue
		}
		cfgFile := strings.HasPrefix(name, "config/")
		if !allowed[name] && !cfgFile {
			continue // 白名单外直接丢弃
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		dstName := name
		if cfgFile {
			dstName = strings.TrimPrefix(name, "config/")
		}
		dst := filepath.Join(restorePending, filepath.Base(dstName))
		out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
		if err != nil {
			rc.Close()
			return err
		}
		_, err = io.Copy(out, rc)
		rc.Close()
		out.Close()
		if err != nil {
			return err
		}
	}
	if _, err := os.Stat(filepath.Join(restorePending, "streampulse.db")); err != nil {
		os.RemoveAll(restorePending)
		return fmt.Errorf("备份包里没有数据库快照")
	}
	return nil
}

// ApplyPendingRestore 启动时调用(开库之前):把待恢复文件换进正式位置。
// 结果写 .restore-result.json。
func ApplyPendingRestore(dataDir, configDir, restorePending string, log *slog.Logger) {
	if log == nil {
		log = slog.Default()
	}
	dbPending := filepath.Join(restorePending, "streampulse.db")
	if _, err := os.Stat(dbPending); err != nil {
		return // 没有待恢复内容
	}
	result := func(ok bool, msg string) {
		m := fmt.Sprintf(`{"ok":%v,"message":%q,"at":%d}`, ok, msg, time.Now().Unix())
		_ = os.WriteFile(filepath.Join(dataDir, ".restore-result.json"), []byte(m), 0o600)
	}
	dbPath := filepath.Join(dataDir, "streampulse.db")
	// 现库先备份
	if _, err := os.Stat(dbPath); err == nil {
		pre := dbPath + ".prerestore"
		_ = os.Remove(pre)
		if err := os.Rename(dbPath, pre); err != nil {
			result(false, "现数据库改名失败: "+err.Error())
			return
		}
	}
	if err := os.Rename(dbPending, dbPath); err != nil {
		result(false, "恢复数据库失败: "+err.Error())
		return
	}
	// WAL/SHM 一并清掉(旧快照的伴随文件无效)
	for _, suf := range []string{"-wal", "-shm"} {
		_ = os.Remove(dbPath + suf)
	}
	// 密钥/配置
	if entries, err := os.ReadDir(restorePending); err == nil {
		for _, e := range entries {
			name := e.Name()
			if name == "streampulse.db" || name == manifestName {
				continue
			}
			_ = os.Rename(filepath.Join(restorePending, name), filepath.Join(configDir, name))
		}
	}
	os.RemoveAll(restorePending)
	log.Info("备份恢复完成", "dataDir", dataDir)
	result(true, "恢复完成，请重新登录并检查账号")
}

func fileSize(p string) int64 {
	st, err := os.Stat(p)
	if err != nil {
		return 0
	}
	return st.Size()
}
