package pan115

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// OpenAuth 是一次开放平台设备码授权会话。
type OpenAuth struct {
	UID      string
	Time     int64
	Sign     string
	Verifier string
	Content  string
}

// OpenLoginStart 发起 DeviceCode + PKCE 授权。
// 开源项目需自备 AppID；没有 AppID 时只能走扫码 Cookie 通道。
func (c *Client) OpenLoginStart(ctx context.Context, appID string) (*OpenAuth, error) {
	if appID == "" {
		return nil, fmt.Errorf("未配置 115 开放平台 AppID")
	}
	verifier := randomVerifier()
	sum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])

	form := url.Values{}
	form.Set("client_id", appID)
	form.Set("code_challenge", challenge)
	form.Set("code_challenge_method", "S256")
	var r struct {
		State bool   `json:"state"`
		Error string `json:"error"`
		Data  struct {
			UID   string `json:"uid"`
			Time  int64  `json:"time"`
			Sign  string `json:"sign"`
			QRCode string `json:"qrcode"`
		} `json:"data"`
	}
	if err := c.do(ctx, http.MethodPost, c.Passport+"/open/authDeviceCode", form, true, &r); err != nil {
		return nil, err
	}
	if !r.State || r.Data.UID == "" {
		return nil, fmt.Errorf("115 设备码获取失败: %s", r.Error)
	}
	return &OpenAuth{
		UID:      r.Data.UID,
		Time:     r.Data.Time,
		Sign:     r.Data.Sign,
		Verifier: verifier,
		Content:  r.Data.QRCode,
	}, nil
}

// OpenLoginPoll 轮询设备码授权结果。未确认时返回 (nil, nil)。
func (c *Client) OpenLoginPoll(ctx context.Context, a *OpenAuth, appID string) (*Credential, error) {
	form := url.Values{}
	form.Set("uid", a.UID)
	form.Set("time", strconv.FormatInt(a.Time, 10))
	form.Set("sign", a.Sign)
	form.Set("code_verifier", a.Verifier)
	var r struct {
		State bool   `json:"state"`
		Error string `json:"error"`
		Data  struct {
			AccessToken  string `json:"access_token"`
			RefreshToken string `json:"refresh_token"`
			ExpiresIn    int64  `json:"expires_in"`
			UID          string `json:"uid"`
		} `json:"data"`
	}
	if err := c.do(ctx, http.MethodPost, c.Passport+"/open/deviceCodeToToken", form, true, &r); err != nil {
		return nil, err
	}
	if !r.State || r.Data.AccessToken == "" {
		// 未扫码/未确认通常不是错误，交给上层继续轮询；真实错误带 error 文本。
		if r.Error != "" && !strings.Contains(r.Error, "等待") {
			return nil, fmt.Errorf("115 设备码轮询失败: %s", r.Error)
		}
		return nil, nil
	}
	exp := time.Now().Add(time.Duration(r.Data.ExpiresIn) * time.Second).Unix()
	if r.Data.ExpiresIn == 0 {
		exp = time.Now().Add(2 * time.Hour).Unix()
	}
	return &Credential{
		AccessToken:  r.Data.AccessToken,
		RefreshToken: r.Data.RefreshToken,
		ExpiresAt:    exp,
		AppID:        appID,
		UID:          r.Data.UID,
	}, nil
}

// RefreshOpenToken 刷新开放平台 token。
func (c *Client) RefreshOpenToken(ctx context.Context) error {
	cr := c.Credential()
	if cr.RefreshToken == "" {
		return fmt.Errorf("没有可用的 refresh_token")
	}
	form := url.Values{}
	form.Set("refresh_token", cr.RefreshToken)
	form.Set("client_id", cr.AppID)
	var r struct {
		State bool   `json:"state"`
		Error string `json:"error"`
		Data  struct {
			AccessToken  string `json:"access_token"`
			RefreshToken string `json:"refresh_token"`
			ExpiresIn    int64  `json:"expires_in"`
		} `json:"data"`
	}
	if err := c.do(ctx, http.MethodPost, c.Passport+"/open/refreshToken", form, true, &r); err != nil {
		return err
	}
	if !r.State || r.Data.AccessToken == "" {
		return fmt.Errorf("115 token 刷新失败: %s", r.Error)
	}
	cr.AccessToken = r.Data.AccessToken
	if r.Data.RefreshToken != "" {
		cr.RefreshToken = r.Data.RefreshToken
	}
	cr.ExpiresAt = time.Now().Add(time.Duration(r.Data.ExpiresIn) * time.Second).Unix()
	c.SetCredential(cr)
	return nil
}

func randomVerifier() string {
	b := make([]byte, 48)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// CookieFromResponse 供测试或特殊登录流程复用：拼装 Set-Cookie。
func CookieFromResponse(resp *http.Response) string {
	var parts []string
	for _, ck := range resp.Cookies() {
		if ck.Name != "" && ck.Value != "" {
			parts = append(parts, ck.Name+"="+ck.Value)
		}
	}
	return strings.Join(parts, "; ")
}

// DrainJSON 小工具：读取并丢弃响应体（测试用）。
func DrainJSON(resp *http.Response, out any) error {
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return err
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(b, out)
}
