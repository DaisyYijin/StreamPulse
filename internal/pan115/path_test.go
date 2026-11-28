package pan115

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestFlexStr(t *testing.T) {
	var s flexStr
	if err := s.UnmarshalJSON([]byte(`"123"`)); err != nil || s.Text() != "123" {
		t.Fatalf("string form: %v %q", err, s.Text())
	}
	if err := s.UnmarshalJSON([]byte(`123`)); err != nil || s.Text() != "123" {
		t.Fatalf("number form: %v %q", err, s.Text())
	}
	if err := s.UnmarshalJSON([]byte(`null`)); err != nil || s.Text() != "" {
		t.Fatalf("null form: %v %q", err, s.Text())
	}
}

func TestAncestorsValidatesLastCID(t *testing.T) {
	// 115 的坑:已删除的 cid 返回 200 + state:true,但 path 只剩根一级。
	// 必须校验末级 cid == 请求 cid,否则把网盘根当目标。
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.URL.Path, "/files") {
			http.NotFound(w, r)
			return
		}
		cid := r.URL.Query().Get("cid")
		if cid == "gone" {
			// 已删除目录:返回网盘根
			_, _ = w.Write([]byte(`{"state":true,"path":[{"cid":"0","pid":"","name":"根"}],"data":[]}`))
			return
		}
		_, _ = w.Write([]byte(`{"state":true,"path":[{"cid":"0","pid":"","name":"根"},{"cid":"a1","pid":"0","name":"影视"},{"cid":"b2","pid":"a1","name":"电影"}],"data":[]}`))
	}))
	defer srv.Close()

	c := New(Credential{Cookie: "UID=x"}, time.Millisecond, time.Millisecond)
	c.SetDriver(false)
	c.WebAPI = srv.URL

	nodes, err := c.Ancestors(context.Background(), "b2")
	if err != nil {
		t.Fatal(err)
	}
	if len(nodes) != 3 || nodes[0].Name != "根" || nodes[2].CID != "b2" {
		t.Fatalf("nodes = %+v", nodes)
	}
	_, err = c.Ancestors(context.Background(), "gone")
	if !errors.Is(err, ErrDirGone) {
		t.Fatalf("gone cid should be ErrDirGone, got %v", err)
	}
}
