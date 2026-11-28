package pan115

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

// ErrDirGone 表示 cid 已不存在(被删/进回收站/id 无效)。
// 115 对不存在的 cid 不报错:返回 200 + state:true,但 path 只剩根一级、
// 列出来的是网盘根内容——必须校验响应里末级 cid 等于请求 cid,否则
// 一个已删除的目录会被解析成"网盘根"。
var ErrDirGone = errors.New("115 目录已不存在")

// PathNode 是祖先链上的一级(根在最前,末元素是请求的 cid)。
type PathNode struct {
	CID       string `json:"cid"`
	ParentCID string `json:"parentCid"`
	Name      string `json:"name"`
}

// Ancestors 一次请求取整条祖先链:GET {webapi}/files?cid=..&limit=1&hide_data=1。
// 响应里的 path 数组就是从根到该目录的每一级。每一级都应写进 path_cache,
// 后续同目录的事件零请求。
func (c *Client) Ancestors(ctx context.Context, cid string) ([]PathNode, error) {
	if cid == "" {
		return nil, errors.New("cid 为空")
	}
	q := url.Values{}
	q.Set("aid", "1")
	q.Set("cid", cid)
	q.Set("limit", "1")
	q.Set("offset", "0")
	q.Set("show_dir", "1")
	q.Set("hide_data", "1") // 只要 path,不要 data
	q.Set("cur", "1")
	q.Set("nf", "1")
	var r struct {
		State flexBool `json:"state"`
		Error string   `json:"error"`
		Path  []struct {
			CID  flexStr `json:"cid"`
			PID  flexStr `json:"pid"`
			Name string  `json:"name"`
		} `json:"path"`
	}
	if err := c.do(ctx, http.MethodGet, c.WebAPI+"/files?"+q.Encode(), nil, false, &r); err != nil {
		return nil, err
	}
	if !bool(r.State) {
		return nil, fmt.Errorf("115 取祖先链失败: %s", r.Error)
	}
	if len(r.Path) == 0 {
		return nil, ErrDirGone
	}
	last := r.Path[len(r.Path)-1]
	if last.CID.Text() != cid {
		// 响应末级不是请求的 cid → 115 把它当成了网盘根,目录实际已不存在
		return nil, ErrDirGone
	}
	out := make([]PathNode, 0, len(r.Path))
	for _, p := range r.Path {
		out = append(out, PathNode{CID: p.CID.Text(), ParentCID: p.PID.Text(), Name: p.Name})
	}
	return out, nil
}

// flexStr 兼容 115 返回的字符串/数字两种形态(同一字段不同通道会变形)。
type flexStr string

func (s *flexStr) UnmarshalJSON(data []byte) error {
	t := strings.TrimSpace(string(data))
	if t == "" || t == "null" {
		*s = ""
		return nil
	}
	if t[0] == '"' {
		var str string
		if err := json.Unmarshal(data, &str); err != nil {
			return err
		}
		*s = flexStr(str)
		return nil
	}
	var n json.Number
	if err := json.Unmarshal(data, &n); err != nil {
		return err
	}
	*s = flexStr(n.String())
	return nil
}

func (s flexStr) Text() string { return string(s) }
