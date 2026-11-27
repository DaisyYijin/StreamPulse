package pan115

// Entry 是 115 目录列表的一项。目录只有 CID，文件才有 FID/Pickcode。
type Entry struct {
	FID      string `json:"fid"`
	CID      string `json:"cid"`
	ParentID string `json:"parentId"`
	Name     string `json:"name"`
	IsDir    bool   `json:"isDir"`
	Size     int64  `json:"size"`
	Pickcode string `json:"pickcode"`
	SHA1     string `json:"sha1"`
	PTime    int64  `json:"ptime"`
}

// Credential 是一个账号的凭据。Cookie 与 OpenAPI token 可同时存在，按优先级使用。
type Credential struct {
	Cookie       string
	AccessToken  string
	RefreshToken string
	ExpiresAt    int64
	AppID        string
	UID          string
}

// QR 是扫码登录会话。
type QR struct {
	UID     string `json:"uid"`
	Time    int64  `json:"time"`
	Sign    string `json:"sign"`
	Content string `json:"content"` // 二维码内容，前端据此生成图片
	Device  string `json:"device"`  // web / 115android / 115ios / tv / alipaymini / wechatmini
}

// QRState 是轮询结果。
type QRState struct {
	Status  int    // 0 未扫；1 已扫待确认；2 已确认；-1 过期
	Message string
	Version string
}

// FileDetail 是文件详情（用于取链前的校验）。
type FileDetail struct {
	FID      string
	Name     string
	Size     int64
	Pickcode string
	SHA1     string
}
