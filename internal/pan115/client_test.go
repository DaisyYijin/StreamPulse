package pan115

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestListDirPaginationAndDownload(t *testing.T) {
	var calls int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasPrefix(r.URL.Path, "/files"):
			calls++
			offset := r.URL.Query().Get("offset")
			w.Header().Set("Content-Type", "application/json")
			if offset == "0" {
				_, _ = w.Write([]byte(`{"state":true,"count":3,"data":[
					{"fid":"f1","cid":"c1","pid":"0","n":"Movie","s":0,"pc":"","sha":"","te":1},
					{"fid":"f2","cid":"c1","pid":"0","n":"a.mkv","s":100,"pc":"pcA","sha":"shaA","te":2}]}`))
			} else {
				_, _ = w.Write([]byte(`{"state":true,"count":3,"data":[
					{"fid":"f3","cid":"c1","pid":"0","n":"b.srt","s":10,"pc":"pcB","sha":"shaB","te":3}]}`))
			}
		case r.URL.Path == "/app/chrome/downurl":
			_ = r.ParseForm()
			var payload map[string]string
			_ = json.Unmarshal([]byte(r.Form.Get("data")), &payload)
			if payload["pickcode"] != "pcA" {
				t.Errorf("pickcode = %q", payload["pickcode"])
			}
			_, _ = w.Write([]byte(`{"state":true,"data":{"pcA":{"url":{"url":"https://cdn/1.mkv"}}}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	c := New(Credential{Cookie: "UID=1"}, time.Millisecond, time.Millisecond)
	c.WebAPI = srv.URL
	c.ProAPI = srv.URL

	entries, err := c.ListDir(context.Background(), "0")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 3 || calls != 2 {
		t.Fatalf("entries=%d calls=%d", len(entries), calls)
	}
	if !entries[0].IsDir || entries[0].Name != "Movie" {
		t.Fatalf("entry0 = %+v", entries[0])
	}
	if entries[1].Pickcode != "pcA" {
		t.Fatalf("entry1 = %+v", entries[1])
	}

	u, err := c.DownloadURL(context.Background(), "pcA")
	if err != nil {
		t.Fatal(err)
	}
	if u != "https://cdn/1.mkv" {
		t.Fatalf("url = %q", u)
	}
}

func TestQRFlow(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/1.0/web/1.0/token", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"state":true,"data":{"uid":"u1","time":123,"sign":"s1"}}`))
	})
	mux.HandleFunc("/get/status/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("uid") != "u1" {
			t.Errorf("uid = %q", r.URL.Query().Get("uid"))
		}
		_, _ = w.Write([]byte(`{"state":true,"data":{"status":2,"msg":"确认","version":"1"}}`))
	})
	mux.HandleFunc("/app/1.0/web/1.0/check/sso", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if r.Form.Get("account") != "u1" {
			t.Errorf("account = %q", r.Form.Get("account"))
		}
		http.SetCookie(w, &http.Cookie{Name: "UID", Value: "100"})
		http.SetCookie(w, &http.Cookie{Name: "CID", Value: "abc"})
		_, _ = w.Write([]byte(`{"state":true,"data":{"uid":"100"}}`))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	c := New(Credential{}, time.Millisecond, time.Millisecond)
	c.QRAPI = srv.URL
	c.Passport = srv.URL

	qr, err := c.QRCreate(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if qr.Content != "https://115.com/scan/dg-u1" {
		t.Fatalf("content = %q", qr.Content)
	}
	st, err := c.QRStatus(context.Background(), qr)
	if err != nil || st.Status != 2 {
		t.Fatalf("status: %v %+v", err, st)
	}
	cookie, err := c.QRLogin(context.Background(), qr)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(cookie, "UID=100") || !strings.Contains(cookie, "CID=abc") {
		t.Fatalf("cookie = %q", cookie)
	}
}

func TestOpenAPIFlow(t *testing.T) {
	var gotVerifier string
	mux := http.NewServeMux()
	mux.HandleFunc("/open/authDeviceCode", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if r.Form.Get("client_id") != "app1" {
			t.Errorf("client_id = %q", r.Form.Get("client_id"))
		}
		if r.Form.Get("code_challenge_method") != "S256" {
			t.Errorf("method = %q", r.Form.Get("code_challenge_method"))
		}
		_, _ = w.Write([]byte(`{"state":true,"data":{"uid":"ou","time":1,"sign":"os","qrcode":"https://qr"}}`))
	})
	mux.HandleFunc("/open/deviceCodeToToken", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		gotVerifier = r.Form.Get("code_verifier")
		_, _ = w.Write([]byte(`{"state":true,"data":{"access_token":"at","refresh_token":"rt","expires_in":7200,"uid":"100"}}`))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	c := New(Credential{}, time.Millisecond, time.Millisecond)
	c.Passport = srv.URL

	oa, err := c.OpenLoginStart(context.Background(), "app1")
	if err != nil {
		t.Fatal(err)
	}
	if oa.Verifier == "" || oa.Content != "https://qr" {
		t.Fatalf("auth = %+v", oa)
	}
	cr, err := c.OpenLoginPoll(context.Background(), oa, "app1")
	if err != nil {
		t.Fatal(err)
	}
	if cr == nil || cr.AccessToken != "at" || cr.RefreshToken != "rt" {
		t.Fatalf("cred = %+v", cr)
	}
	if gotVerifier != oa.Verifier {
		t.Fatalf("verifier mismatch")
	}
	if cr.ExpiresAt <= time.Now().Unix() {
		t.Fatal("expires_at not set")
	}
}

func TestRateLimitReadInterval(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"state":true,"count":0,"data":[]}`))
	}))
	defer srv.Close()

	c := New(Credential{Cookie: "x"}, 40*time.Millisecond, 40*time.Millisecond)
	c.WebAPI = srv.URL
	start := time.Now()
	for i := 0; i < 3; i++ {
		if _, err := c.ListDir(context.Background(), "0"); err != nil {
			t.Fatal(err)
		}
	}
	if d := time.Since(start); d < 75*time.Millisecond {
		t.Fatalf("读写节流未生效: %v", d)
	}
}

func TestSTRMFormat(t *testing.T) {
	id := STRMID("", "pc1", ".mkv", true, false)
	if id != "pc1.mkv" {
		t.Fatalf("id = %q", id)
	}
	u := STRM("http://h:6086/", "pick_code_name", id, "a b.mkv")
	if !strings.HasPrefix(u, "http://h:6086/d/pc1.mkv?/") || !strings.Contains(u, "a%20b.mkv") {
		t.Fatalf("url = %q", u)
	}
	iso := STRMID("", "pc2", ".mkv", false, true)
	if iso != "pc2.mkv" {
		t.Fatalf("iso id = %q", iso)
	}
	extra := STRMID("100", "pc3", "", false, false)
	if extra != "100~pc3" {
		t.Fatalf("extra id = %q", extra)
	}
}
