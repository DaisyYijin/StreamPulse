package pan115

import (
	"context"
)

// Profile 是 115 账号的展示信息。
type Profile struct {
	UserID    int64  `json:"userId"`
	Name      string `json:"name"`
	Face      string `json:"face"`
	VIP       int    `json:"vip"`
	Expire    int    `json:"expire"`
	Forever   int    `json:"forever"`
	Privilege bool   `json:"privilege"`
	Total     int64  `json:"total"`
	Used      int64  `json:"used"`
}

// GetProfile 读取账号昵称、会员与容量。失败时返回错误，由调用方决定是否忽略。
func (c *Client) GetProfile(ctx context.Context) (*Profile, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	d := c.driverClient()
	u, err := d.GetUser()
	if err != nil {
		return nil, err
	}
	p := &Profile{
		UserID:    u.UserID,
		Name:      u.UserName,
		Face:      u.Face,
		VIP:       u.Vip,
		Expire:    u.Expire,
		Forever:   u.Forever,
		Privilege: u.IsPrivilege,
	}
	if info, err := d.GetInfo(); err == nil {
		p.Total = info.SpaceInfo.AllTotal.Size
		p.Used = info.SpaceInfo.AllUse.Size
	}
	return p, nil
}
