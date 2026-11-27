package pan115

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
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
func (c *Client) QRLogin(ctx context.Context, qr *QR, device string) (string, error) {
	app := DeviceApp(device)
	form := url.Values{}
	form.Set("account", qr.UID)

	var r struct {
		State flexBool `json:"state"`
		Error string   `json:"error"`
		ErrNo int      `json:"errno"`
		Code  int      `json:"code"`
		Data  struct {
			Cookie   string `json:"cookie"`
			UserName string `json:"user_name"`
		} `json:"data"`
	}
	endpoint := c.QRAPI + "/app/1.0/" + app + "/1.0/login/qrcode/"
	if err := c.do(ctx, http.MethodPost, endpoint, form, true, &r); err != nil {
		return "", err
	}
	if !bool(r.State) || r.Data.Cookie == "" {
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
		return "", fmt.Errorf("115 登录失败: %s", msg)
	}
	return r.Data.Cookie, nil
}
