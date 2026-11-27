package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

// Config 是进程级配置。环境变量优先，缺省值面向 Docker / fnOS 单机部署。
type Config struct {
	Port       int // 管理后台与 API 端口
	StreamPort int // 播放解析端口（与 Port 必须不同）

	DataDir   string // 数据库、台账
	ConfigDir string // 密钥、账号凭据
	MediaDir  string // STRM 与附属文件输出根
	LogDir    string

	AdminUser string
	AdminPass string

	EmbyBase string
	EmbyKey  string

	// 115 开放平台（用户自备 AppID）
	OpenAppID  string
	OpenSecret string

	// 默认写进 STRM 的播放域名，如 http://192.168.1.10:6086
	PublicBase string
	// redirect: 302 直连；proxy: 本机中转
	PlayMode string

	ReadEvery  time.Duration
	WriteEvery time.Duration

	// 生活事件增量
	IncrEnabled  bool
	IncrInterval time.Duration

	// Emby 删除联动（默认只删本地，不删网盘）
	EmbyDeleteRemote bool
	EmbyWebhookToken string

	TrustProxy bool
}

func Load() *Config {
	c := &Config{
		Port:       envInt("PORT", 6060),
		StreamPort: envInt("STREAM_PORT", 6086),
		DataDir:    envStr("DATA_DIR", "/data"),
		ConfigDir:  envStr("CONFIG_DIR", "/config"),
		MediaDir:   envStr("MEDIA_DIR", "/media"),
		LogDir:     envStr("LOG_DIR", "/logs"),
		AdminUser:  envStr("AUTH_USER", "admin"),
		AdminPass:  envStr("AUTH_PASSWORD", ""),
		EmbyBase:   strings.TrimRight(envStr("EMBY_BASE", ""), "/"),
		EmbyKey:    envStr("EMBY_API_KEY", ""),
		OpenAppID:  envStr("P115_APP_ID", ""),
		OpenSecret: envStr("P115_APP_SECRET", ""),
		PublicBase: strings.TrimRight(envStr("PUBLIC_BASE", ""), "/"),
		PlayMode:   envStr("PLAY_MODE", "redirect"),
		ReadEvery:  envMillis("P115_READ_INTERVAL_MS", 1000),
		WriteEvery: envMillis("P115_WRITE_INTERVAL_MS", 3000),
		TrustProxy: envBool("TRUST_PROXY", false),

		IncrEnabled:      envBool("INCR_ENABLED", true),
		IncrInterval:     envMillis("INCR_INTERVAL_MS", 30000),
		EmbyDeleteRemote: envBool("EMBY_DELETE_REMOTE", false),
		EmbyWebhookToken: envStr("EMBY_WEBHOOK_TOKEN", ""),
	}
	if c.PublicBase == "" {
		c.PublicBase = "http://127.0.0.1:" + strconv.Itoa(c.StreamPort)
	}
	return c
}

// Validate 返回非空错误字符串表示配置不可用。
func (c *Config) Validate() string {
	if c.Port == c.StreamPort {
		return "PORT 与 STREAM_PORT 不能相同"
	}
	if c.AdminPass == "" {
		// 允许首次启动自动生成，由调用方处理；这里不阻断。
		return ""
	}
	return ""
}

func envStr(k, def string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return def
}

func envInt(k string, def int) int {
	v := strings.TrimSpace(os.Getenv(k))
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		return def
	}
	return n
}

func envMillis(k string, def int) time.Duration {
	n := envInt(k, def)
	return time.Duration(n) * time.Millisecond
}

func envBool(k string, def bool) bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv(k)))
	switch v {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	}
	return def
}
