package emby

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Client struct {
	Base string
	Key  string
	HTTP *http.Client
}

func New(base, key string) *Client {
	return &Client{
		Base: strings.TrimRight(base, "/"),
		Key:  key,
		HTTP: &http.Client{Timeout: 20 * time.Second},
	}
}

func (c *Client) Enabled() bool { return c.Base != "" && c.Key != "" }

func (c *Client) do(ctx context.Context, method, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, method, c.Base+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("X-Emby-Token", c.Key)
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("Emby %s HTTP %d", path, resp.StatusCode)
	}
	if out != nil {
		return json.NewDecoder(resp.Body).Decode(out)
	}
	return nil
}

// RefreshLibrary 刷新全部媒体库；id 为空时刷全库。
func (c *Client) RefreshLibrary(ctx context.Context, id string) error {
	if !c.Enabled() {
		return nil
	}
	q := url.Values{}
	if id != "" {
		q.Set("Recursive", "true")
	}
	path := "/emby/Library/Refresh"
	if id != "" {
		path = "/emby/Items/" + url.PathEscape(id) + "/Refresh"
	}
	if len(q) > 0 {
		path += "?" + q.Encode()
	}
	return c.do(ctx, http.MethodPost, path, nil)
}

// Ping 验证地址与 Key。
func (c *Client) Ping(ctx context.Context) error {
	var v map[string]any
	return c.do(ctx, http.MethodGet, "/emby/System/Info", &v)
}

// Webhook 只解析我们关心的字段，保持对 Emby / Jellyfin 的宽松兼容。
type Webhook struct {
	Event string `json:"Event"`
	Item  struct {
		ID   string `json:"Id"`
		Name string `json:"Name"`
		Type string `json:"Type"`
		Path string `json:"Path"`
	} `json:"Item"`
}

// ParseWebhook 兼容 Emby 原生与 Jellyfin 扁平载荷。
func ParseWebhook(body []byte) (*Webhook, error) {
	var w Webhook
	if err := json.Unmarshal(body, &w); err != nil {
		return nil, err
	}
	if w.Event == "" {
		var flat map[string]any
		if err := json.Unmarshal(body, &flat); err != nil {
			return nil, err
		}
		if v, ok := flat["NotificationType"].(string); ok {
			w.Event = v
		}
	}
	return &w, nil
}
