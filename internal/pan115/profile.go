package pan115

import (
	"context"
	"fmt"
	"strings"
	"time"
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
	Email     string `json:"email"`
	Mobile    string `json:"mobile"`
}

// GetProfile 读取账号昵称、会员与容量。
// GetUser 和 GetInfo 独立调用：某些设备会话没有 nav 权限，但容量接口仍可能可用。
func (c *Client) GetProfile(ctx context.Context) (*Profile, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	d := c.driverClient()
	var p Profile
	var errs []string

	if u, err := d.GetUser(); err == nil {
		p.UserID = u.UserID
		p.Name = u.UserName
		p.Face = u.Face
		p.VIP = u.Vip
		p.Expire = u.Expire
		p.Forever = u.Forever
		p.Privilege = u.IsPrivilege
	} else {
		errs = append(errs, "user: "+err.Error())
	}

	for attempt := 0; attempt < 3; attempt++ {
		if info, err := d.GetInfo(); err == nil {
			p.Total = info.SpaceInfo.AllTotal.Size
			p.Used = info.SpaceInfo.AllUse.Size
			break
		} else {
			if attempt == 2 {
				errs = append(errs, "info: "+err.Error())
			}
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(500 * time.Millisecond):
			}
		}
	}

	if p.Name == "" && p.Total == 0 {
		return nil, fmt.Errorf("%s", strings.Join(errs, "; "))
	}
	return &p, nil
}
