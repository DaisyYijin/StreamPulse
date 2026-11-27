package pan115

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// LifeEvent 是 115「生活」事件流的一条记录。
// 事件 id 单调递增；浏览/标星类事件与媒体库无关，读取时就丢弃。
type LifeEvent struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	FileID   string `json:"fileId"`
	FileName string `json:"fileName"`
	CID      string `json:"cid"`
	Pickcode string `json:"pickcode"`
	Time     string `json:"time"`
	Size     int64  `json:"size"`
}

var ignoreLifeTypes = map[string]bool{
	"3": true, "star_image": true,
	"4": true, "star_file": true,
	"7": true, "browse_image": true,
	"8": true, "browse_video": true,
	"9": true, "browse_audio": true,
	"10": true, "browse_document": true,
	"19": true, "folder_label": true,
}

// ListBehavior 拉一页生活事件。先走 proapi（快，但易 405），失败切 webapi。
func (c *Client) ListBehavior(ctx context.Context, limit int) ([]LifeEvent, error) {
	if limit <= 0 || limit > 1000 {
		limit = 64
	}
	q := url.Values{}
	q.Set("limit", strconv.Itoa(limit))
	q.Set("offset", "0")

	endpoints := []string{
		c.ProAPI + "/android/behavior/detail",
		c.WebAPI + "/behavior/detail",
	}
	var lastErr error
	for _, ep := range endpoints {
		var r struct {
			State flexBool `json:"state"`
			Error string `json:"error"`
			Data  struct {
				Count json.RawMessage            `json:"count"`
				List  []map[string]interface{}   `json:"list"`
			} `json:"data"`
		}
		err := c.do(ctx, http.MethodGet, ep+"?"+q.Encode(), nil, false, &r)
		if err != nil {
			lastErr = err
			// 405 / 风控时换下一个通道
			if strings.Contains(err.Error(), "405") || strings.Contains(err.Error(), "429") {
				continue
			}
			continue
		}
		if !bool(r.State) {
			lastErr = fmt.Errorf("生活事件被拒绝: %s", r.Error)
			continue
		}
		out := make([]LifeEvent, 0, len(r.Data.List))
		for _, d := range r.Data.List {
			ev := LifeEvent{
				ID:       firstStr(d, "id"),
				Type:     firstStr(d, "type"),
				FileID:   firstStr(d, "file_id", "fid"),
				FileName: firstStr(d, "file_name", "n", "name"),
				CID:      firstStr(d, "parent_id", "cid", "pid"),
				Pickcode: firstStr(d, "pick_code", "pickcode", "pc"),
				Time:     firstStr(d, "update_time", "time", "create_time"),
			}
			if v, ok := d["file_size"].(float64); ok {
				ev.Size = int64(v)
			}
			if ev.ID == "" || ignoreLifeTypes[strings.ToLower(ev.Type)] {
				continue
			}
			out = append(out, ev)
		}
		return out, nil
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("生活事件不可用")
	}
	return nil, lastErr
}

func firstStr(m map[string]interface{}, keys ...string) string {
	for _, k := range keys {
		v, ok := m[k]
		if !ok || v == nil {
			continue
		}
		switch t := v.(type) {
		case string:
			if t != "" {
				return t
			}
		case float64:
			return strconv.FormatInt(int64(t), 10)
		case json.Number:
			return t.String()
		}
	}
	return ""
}
