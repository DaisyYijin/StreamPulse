package pan115

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"streampulse/internal/ratelimit"
)

// Default* 是线上端点；测试可整体替换。
const (
	DefaultWebAPI    = "https://webapi.115.com"
	DefaultProAPI    = "https://proapi.115.com"
	DefaultQRAPI     = "https://qrcodeapi.115.com"
	DefaultPassport  = "https://passportapi.115.com"
	// 115 的 Cookie 会话与 UA 绑定：登录、列目录、取直链必须全程同一个 UA。
	DefaultUserAgent = "Mozilla/5.0 115Browser/36.0.0"
)

type Client struct {
	http *http.Client

	WebAPI   string
	ProAPI   string
	QRAPI    string
	Passport string

	UserAgent string

	read  *ratelimit.Limiter
	write *ratelimit.Limiter

	mu        sync.RWMutex
	cred      Credential
	pageLimit int
}

func New(cred Credential, readEvery, writeEvery time.Duration) *Client {
	return &Client{
		http:      &http.Client{Timeout: 30 * time.Second},
		WebAPI:    DefaultWebAPI,
		ProAPI:    DefaultProAPI,
		QRAPI:     DefaultQRAPI,
		Passport:  DefaultPassport,
		UserAgent: DefaultUserAgent,
		read:      ratelimit.New(readEvery),
		write:     ratelimit.New(writeEvery),
		cred:      cred,
	}
}

func (c *Client) Credential() Credential {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.cred
}

func (c *Client) SetCredential(cr Credential) {
	c.mu.Lock()
	c.cred = cr
	c.mu.Unlock()
}

// SetPageLimit 控制列目录每页条数：快速模式 1000，标准模式 200。
func (c *Client) SetPageLimit(n int) {
	c.mu.Lock()
	if n > 0 {
		c.pageLimit = n
	}
	c.mu.Unlock()
}

func (c *Client) PageLimit() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.pageLimit > 0 {
		return c.pageLimit
	}
	return 1000
}

func (c *Client) SetIntervals(readEvery, writeEvery time.Duration) {
	c.read.SetEvery(readEvery)
	c.write.SetEvery(writeEvery)
}

var ErrNotLoggedIn = errors.New("115 未登录或凭据为空")

// flexBool 兼容 115 返回的 true/false 与 1/0（扫码 token 返回的是数字 1）。
type flexBool bool

func (b *flexBool) UnmarshalJSON(data []byte) error {
	s := strings.Trim(strings.TrimSpace(string(data)), `"`)
	switch strings.ToLower(s) {
	case "true", "1":
		*b = true
	case "false", "0", "null", "":
		*b = false
	default:
		return fmt.Errorf("invalid bool %q", s)
	}
	return nil
}

// ---------- low level ----------

func (c *Client) cookieHeader() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.cred.Cookie
}

func (c *Client) do(ctx context.Context, method, rawURL string, form url.Values, write bool, out any) error {
	lim := c.read
	if write {
		lim = c.write
	}
	if err := lim.Wait(ctx); err != nil {
		return err
	}
	var body io.Reader
	if form != nil {
		body = strings.NewReader(form.Encode())
	}
	req, err := http.NewRequestWithContext(ctx, method, rawURL, body)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", c.UserAgent)
	if form != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	if ck := c.cookieHeader(); ck != "" {
		req.Header.Set("Cookie", ck)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode == http.StatusTooManyRequests {
		return fmt.Errorf("115 限流 429: %s", truncate(string(b), 200))
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("115 HTTP %d: %s", resp.StatusCode, truncate(string(b), 200))
	}
	if out != nil {
		if err := json.Unmarshal(b, out); err != nil {
			return fmt.Errorf("115 响应不是 JSON: %w (%s)", err, truncate(string(b), 200))
		}
	}
	return nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

// ---------- directory ----------

type listResp struct {
	State flexBool `json:"state"`
	Error string `json:"error"`
	Count int    `json:"count"`
	Data  []struct {
		FID  string `json:"fid"`
		CID  string `json:"cid"`
		PID  string `json:"pid"`
		Name string `json:"n"`
		Size int64  `json:"s"`
		PC   string `json:"pc"`
		SHA  string `json:"sha"`
		TE   int64  `json:"te"`
	} `json:"data"`
}

// ListDir 拉取一个目录的直接子项（自动翻页）。cid=0 为根目录。
func (c *Client) ListDir(ctx context.Context, cid string) ([]Entry, error) {
	if cid == "" {
		cid = "0"
	}
	var out []Entry
	offset := 0
	for {
		q := url.Values{}
		q.Set("aid", "1")
		q.Set("cid", cid)
		q.Set("o", "user_ptime")
		q.Set("asc", "0")
		q.Set("show_dir", "1")
		q.Set("limit", strconv.Itoa(c.PageLimit()))
		q.Set("offset", strconv.Itoa(offset))
		q.Set("fc_mix", "1")
		var r listResp
		if err := c.do(ctx, http.MethodGet, c.WebAPI+"/files?"+q.Encode(), nil, false, &r); err != nil {
			return nil, err
		}
		if !bool(r.State) {
			return nil, fmt.Errorf("115 列目录失败: %s", r.Error)
		}
		for _, it := range r.Data {
			e := Entry{
				FID:      it.FID,
				CID:      it.CID,
				ParentID: it.PID,
				Name:     it.Name,
				Size:     it.Size,
				Pickcode: it.PC,
				SHA1:     it.SHA,
				PTime:    it.TE,
			}
			// 115 的目录项没有 pickcode；文件一定有（极少数异常项除外）。
			// fid 在目录项上可能为 "0" 或与 cid 相同，不能单独用来判目录。
			if e.FID == "" || it.PC == "" {
				e.IsDir = true
			}
			out = append(out, e)
		}
		if len(r.Data) == 0 || len(out) >= r.Count {
			break
		}
		offset += len(r.Data)
	}
	return out, nil
}

// FileDetail 查单个文件。
func (c *Client) FileDetail(ctx context.Context, fid string) (*FileDetail, error) {
	q := url.Values{}
	q.Set("fid", fid)
	q.Set("aid", "1")
	var r struct {
		State flexBool `json:"state"`
		Error string `json:"error"`
		Data  []struct {
			FID  string `json:"fid"`
			Name string `json:"n"`
			Size int64  `json:"s"`
			PC   string `json:"pc"`
			SHA  string `json:"sha"`
		} `json:"data"`
	}
	if err := c.do(ctx, http.MethodGet, c.WebAPI+"/files?"+q.Encode(), nil, false, &r); err != nil {
		return nil, err
	}
	if !bool(r.State) || len(r.Data) == 0 {
		return nil, fmt.Errorf("115 文件不存在: %s", r.Error)
	}
	d := r.Data[0]
	return &FileDetail{FID: d.FID, Name: d.Name, Size: d.Size, Pickcode: d.PC, SHA1: d.SHA}, nil
}

// ---------- download ----------

// DownloadURL 用 pickcode 换直链。write=false（读操作），但会用写间隔？不，取链接算读。
func (c *Client) DownloadURL(ctx context.Context, pickcode string) (string, error) {
	if pickcode == "" {
		return "", errors.New("pickcode 为空")
	}
	payload, _ := json.Marshal(map[string]string{"pickcode": pickcode})
	form := url.Values{}
	form.Set("data", string(payload))
	var r struct {
		State flexBool `json:"state"`
		Error string `json:"error"`
		Data  map[string]struct {
			URL struct {
				URL string `json:"url"`
			} `json:"url"`
		} `json:"data"`
	}
	if err := c.do(ctx, http.MethodPost, c.ProAPI+"/app/chrome/downurl", form, false, &r); err != nil {
		return "", err
	}
	if !bool(r.State) {
		return "", fmt.Errorf("115 取直链失败: %s", r.Error)
	}
	for _, v := range r.Data {
		if v.URL.URL != "" {
			return v.URL.URL, nil
		}
	}
	return "", errors.New("115 取直链响应里没有 url")
}

// ---------- naming ----------

// STRMID 返回 STRM URL 里的 ID 段。extra 账号的文件用 {uid}~{pickcode}。
func STRMID(uid, pickcode, ext string, keepExt, iso bool) string {
	id := pickcode
	if uid != "" {
		id = uid + "~" + pickcode
	}
	if iso || (keepExt && ext != "") {
		id += ext
	}
	return id
}

// STRM 生成一行播放 URL。format: pick_code | pick_code_name。
func STRM(base, format, id, name string) string {
	base = strings.TrimRight(base, "/")
	if format == "pick_code_name" {
		return base + "/d/" + id + "?/" + url.PathEscape(name)
	}
	return base + "/d/" + id
}

// SHA1Hex 给本地测试与指纹用。
func SHA1Hex(s string) string {
	h := sha1.Sum([]byte(s))
	return hex.EncodeToString(h[:])
}
