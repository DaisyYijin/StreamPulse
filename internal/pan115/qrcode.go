package pan115

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	driver "github.com/SheltonZhu/115driver/pkg/driver"
)

// DeviceApp 把控制台的设备类型映射成 115 的 app 短名。
// 115 的扫码 token 固定走 web；只有换 Cookie 时的 app 路径不同。
func DeviceApp(device string) string {
	switch device {
	case "web":
		return "web"
	case "115android":
		return "android"
	case "115ios":
		return "ios"
	case "tv":
		return "tv"
	case "alipaymini":
		return "alipaymini"
	case "wechatmini":
		return "wechatmini"
	case "qandroid":
		return "qandroid"
	default:
		return "web"
	}
}

// QRCreate 创建扫码会话。二维码内容为 https://115.com/scan/dg-{uid}。
func (c *Client) QRCreate(ctx context.Context) (*QR, error) {
	if c.useDriver() {
		s, err := c.driverClient().QRCodeStart()
		if err != nil {
			return nil, fmt.Errorf("115 扫码 token 获取失败: %w", err)
		}
		return &QR{UID: s.UID, Time: s.Time, Sign: s.Sign, Content: s.QrcodeContent}, nil
	}
	var r struct {
		State   flexBool `json:"state"`
		Error   string   `json:"error"`
		Message string   `json:"message"`
		Data    struct {
			UID    string `json:"uid"`
			Time   int64  `json:"time"`
			Sign   string `json:"sign"`
			QRCode string `json:"qrcode"`
		} `json:"data"`
	}
	if err := c.do(ctx, http.MethodGet, c.QRAPI+"/api/1.0/web/1.0/token/", nil, false, &r); err != nil {
		return nil, err
	}
	if !bool(r.State) || r.Data.UID == "" {
		msg := r.Error
		if msg == "" {
			msg = r.Message
		}
		return nil, fmt.Errorf("115 扫码 token 获取失败: %s", msg)
	}
	content := r.Data.QRCode
	if content == "" {
		content = "https://115.com/scan/dg-" + r.Data.UID
	}
	return &QR{
		UID:     r.Data.UID,
		Time:    r.Data.Time,
		Sign:    r.Data.Sign,
		Content: content,
	}, nil
}

// QRStatus 轮询扫码状态：0 未扫，1 已扫待确认，2 已确认，-1 过期，-2 取消。
func (c *Client) QRStatus(ctx context.Context, qr *QR) (*QRState, error) {
	if c.useDriver() {
		s := &driver.QRCodeSession{UID: qr.UID, Time: qr.Time, Sign: qr.Sign}
		st, err := c.driverClient().QRCodeStatus(s)
		if err != nil {
			return nil, err
		}
		return &QRState{Status: st.Status, Message: st.Msg, Version: st.Version}, nil
	}
	q := url.Values{}
	q.Set("uid", qr.UID)
	q.Set("time", strconv.FormatInt(qr.Time, 10))
	q.Set("sign", qr.Sign)
	var r struct {
		State flexBool `json:"state"`
		Error string   `json:"error"`
		Data  struct {
			Status  int    `json:"status"`
			Message string `json:"msg"`
			Version string `json:"version"`
		} `json:"data"`
	}
	if err := c.do(ctx, http.MethodGet, c.QRAPI+"/get/status/?"+q.Encode(), nil, false, &r); err != nil {
		return nil, err
	}
	if !bool(r.State) {
		return &QRState{Status: -1, Message: r.Error}, nil
	}
	return &QRState{Status: r.Data.Status, Message: r.Data.Message, Version: r.Data.Version}, nil
}

// QRLogin 在扫码确认后换取 Cookie。
// 端点：POST qrcodeapi.115.com/app/1.0/{app}/1.0/login/qrcode/，表单只带 account=uid。
// cookieValue 兼容 115 的两种返回：
//   "cookie": "UID=...; CID=..."
//   "cookie": {"UID":"...","CID":"...","SEID":"...","KID":"..."}
type cookieValue struct {
	Text string
}

func (v *cookieValue) UnmarshalJSON(data []byte) error {
	trimmed := strings.TrimSpace(string(data))
	if strings.HasPrefix(trimmed, `"`) {
		var s string
		if err := json.Unmarshal(data, &s); err != nil {
			return err
		}
		v.Text = s
		return nil
	}
	if trimmed == "null" || trimmed == "" {
		return nil
	}
	var m map[string]string
	if err := json.Unmarshal(data, &m); err != nil {
		return err
	}
	get := func(keys ...string) string {
		for _, k := range keys {
			if s := strings.TrimSpace(m[k]); s != "" {
				return s
			}
		}
		return ""
	}
	var parts []string
	for _, kv := range []struct {
		name string
		keys []string
	}{
		{"UID", []string{"UID", "uid"}},
		{"CID", []string{"CID", "cid"}},
		{"SEID", []string{"SEID", "seid"}},
		{"KID", []string{"KID", "kid"}},
	} {
		if val := get(kv.keys...); val != "" {
			parts = append(parts, kv.name+"="+val)
		}
	}
	v.Text = strings.Join(parts, "; ")
	return nil
}

// QRLoginResult 是扫码换 Cookie 的结果。115 的登录响应同时带昵称/头像/VIP，
// 小程序等没有 user/info 权限的会话也能从这里拿到账号资料。
type QRLoginResult struct {
	Cookie   string
	UserName string
	UserID   int64
	Face     string
	VIP      int64
	Email    string
	Mobile   string
}

// QRLogin 在扫码确认后换取 Cookie。
// 端点：POST qrcodeapi.115.com/app/1.0/{app}/1.0/login/qrcode/，表单带 account + app。
func (c *Client) QRLogin(ctx context.Context, qr *QR, device string) (*QRLoginResult, error) {
	app := DeviceApp(device)
	form := url.Values{}
	form.Set("account", qr.UID)
	form.Set("app", app)

	var r struct {
		State flexBool `json:"state"`
		Error string   `json:"error"`
		ErrNo int      `json:"errno"`
		Code  int      `json:"code"`
		Data  struct {
			Cookie   cookieValue `json:"cookie"`
			UserName string `json:"user_name"`
			UserID   int64  `json:"user_id"`
			IsVip    int64  `json:"is_vip"`
			Email    string `json:"email"`
			Mobile   string `json:"mobile"`
			Face     struct {
				FaceL string `json:"face_l"`
				FaceM string `json:"face_m"`
				FaceS string `json:"face_s"`
			} `json:"face"`
		} `json:"data"`
	}
	endpoint := c.QRAPI + "/app/1.0/" + app + "/1.0/login/qrcode/"
	if err := c.do(ctx, http.MethodPost, endpoint, form, false, &r); err != nil {
		return nil, err
	}
	if !bool(r.State) || r.Data.Cookie.Text == "" {
		msg := r.Error
		if msg == "" {
			msg = "登录成功但未返回 Cookie"
		}
		code := r.ErrNo
		if code == 0 {
			code = r.Code
		}
		if code != 0 {
			msg += fmt.Sprintf("（%d）", code)
		}
		if code == 40101004 {
			msg += "。IP 被 115 临时风控：请停止重试，等待数小时或更换出口 IP 后再扫码"
		}
		return nil, fmt.Errorf("115 登录失败: %s", msg)
	}
	face := r.Data.Face.FaceL
	if face == "" {
		face = r.Data.Face.FaceM
	}
	if face == "" {
		face = r.Data.Face.FaceS
	}
	return &QRLoginResult{
		Cookie:   r.Data.Cookie.Text,
		UserName: r.Data.UserName,
		UserID:   r.Data.UserID,
		Face:     face,
		VIP:      r.Data.IsVip,
		Email:    r.Data.Email,
		Mobile:   r.Data.Mobile,
	}, nil
}
