package pan115

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// QRCreate 创建扫码会话。二维码内容为 https://115.com/scan/dg-{uid}。
func (c *Client) QRCreate(ctx context.Context) (*QR, error) {
	var r struct {
		State bool   `json:"state"`
		Error string `json:"error"`
		Data  struct {
			UID  string `json:"uid"`
			Time int64  `json:"time"`
			Sign string `json:"sign"`
		} `json:"data"`
	}
	if err := c.do(ctx, http.MethodGet, c.QRAPI+"/api/1.0/web/1.0/token", nil, false, &r); err != nil {
		return nil, err
	}
	if !r.State || r.Data.UID == "" {
		return nil, fmt.Errorf("115 扫码 token 获取失败: %s", r.Error)
	}
	return &QR{
		UID:     r.Data.UID,
		Time:    r.Data.Time,
		Sign:    r.Data.Sign,
		Content: "https://115.com/scan/dg-" + r.Data.UID,
	}, nil
}

// QRStatus 轮询扫码状态：0 未扫，1 已扫待确认，2 已确认，-1 过期。
func (c *Client) QRStatus(ctx context.Context, qr *QR) (*QRState, error) {
	q := url.Values{}
	q.Set("uid", qr.UID)
	q.Set("time", strconv.FormatInt(qr.Time, 10))
	q.Set("sign", qr.Sign)
	var r struct {
		State bool   `json:"state"`
		Error string `json:"error"`
		Data  struct {
			Status  int    `json:"status"`
			Message string `json:"msg"`
			Version string `json:"version"`
		} `json:"data"`
	}
	if err := c.do(ctx, http.MethodGet, c.QRAPI+"/get/status/?"+q.Encode(), nil, false, &r); err != nil {
		return nil, err
	}
	if !r.State {
		return &QRState{Status: -1, Message: r.Error}, nil
	}
	return &QRState{Status: r.Data.Status, Message: r.Data.Message, Version: r.Data.Version}, nil
}

// QRLogin 在扫码确认后换取 Cookie。
// 115 的通行做法是 passport check/sso 携带 account=uid，响应 Set-Cookie 即登录态。
func (c *Client) QRLogin(ctx context.Context, qr *QR) (string, error) {
	form := url.Values{}
	form.Set("account", qr.UID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.Passport+"/app/1.0/web/1.0/check/sso", strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", c.UserAgent)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := c.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var r struct {
		State bool   `json:"state"`
		Error string `json:"error"`
		Data  struct {
			UID string `json:"uid"`
		} `json:"data"`
	}
	_ = json.Unmarshal(body, &r)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("115 登录失败 HTTP %d: %s", resp.StatusCode, truncate(string(body), 200))
	}
	var parts []string
	for _, ck := range resp.Cookies() {
		if ck.Name == "" || ck.Value == "" {
			continue
		}
		parts = append(parts, ck.Name+"="+ck.Value)
	}
	cookie := strings.Join(parts, "; ")
	if cookie == "" {
		return "", fmt.Errorf("115 登录未返回 Cookie: %s", truncate(string(body), 200))
	}
	return cookie, nil
}
