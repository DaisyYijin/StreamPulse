package stream

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

type fakeProvider struct {
	url   string
	calls int32
}

func (f *fakeProvider) DownloadURL(_ context.Context, pickcode string) (string, error) {
	atomic.AddInt32(&f.calls, 1)
	return f.url, nil
}

func TestRedirectAndCache(t *testing.T) {
	p := &fakeProvider{url: "https://cdn.example/1.mkv"}
	s := New(p, "redirect", nil)
	ts := httptest.NewServer(s.Handler())
	defer ts.Close()

	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	for _, path := range []string{"/d/pc1", "/d/pc1.mkv", "/d/100~pc1"} {
		resp, err := client.Get(ts.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != http.StatusFound {
			t.Fatalf("%s status = %d", path, resp.StatusCode)
		}
		if loc := resp.Header.Get("Location"); loc != p.url {
			t.Fatalf("%s location = %q", path, loc)
		}
		resp.Body.Close()
	}
	if got := atomic.LoadInt32(&p.calls); got != 1 {
		t.Fatalf("cache not working: calls = %d", got)
	}
}

func TestProxyMode(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Range") != "bytes=0-3" {
			t.Errorf("range = %q", r.Header.Get("Range"))
		}
		w.Header().Set("Content-Type", "video/mp4")
		w.Header().Set("Accept-Ranges", "bytes")
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write([]byte("data"))
	}))
	defer up.Close()

	p := &fakeProvider{url: up.URL + "/v.mkv"}
	s := New(p, "proxy", nil)
	ts := httptest.NewServer(s.Handler())
	defer ts.Close()

	req, _ := http.NewRequest(http.MethodGet, ts.URL+"/d/pc9", nil)
	req.Header.Set("Range", "bytes=0-3")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusPartialContent || string(b) != "data" {
		t.Fatalf("status=%d body=%q", resp.StatusCode, b)
	}
}

func TestHealth(t *testing.T) {
	s := New(&fakeProvider{}, "redirect", nil)
	ts := httptest.NewServer(s.Handler())
	defer ts.Close()
	resp, err := http.Get(ts.URL + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatal(resp.StatusCode)
	}
}
