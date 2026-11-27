package pan115

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
)

// DeleteToRecycle 把文件/目录移入 115 回收站（可还原），不是彻底抹除。
// 端点与字段：POST /rb/delete，fid[0]、fid[1]…
func (c *Client) DeleteToRecycle(ctx context.Context, fids []string) error {
	if len(fids) == 0 {
		return nil
	}
	form := url.Values{}
	for i, fid := range fids {
		form.Set(fmt.Sprintf("fid[%d]", i), fid)
	}
	var r struct {
		State bool   `json:"state"`
		Error string `json:"error"`
		ErrMs string `json:"errMsg"`
	}
	if err := c.do(ctx, http.MethodPost, c.WebAPI+"/rb/delete", form, true, &r); err != nil {
		return err
	}
	if !r.State {
		msg := r.Error
		if msg == "" {
			msg = r.ErrMs
		}
		return fmt.Errorf("115 删除失败: %s", msg)
	}
	return nil
}
