package embyproxy

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type fakeResolver struct{ url string }

func (f fakeResolver) DownloadURL(_ context.Context, pick string) (string, error) {
	return "http://115cdn/" + pick, nil
}

func newTestProxy(t *testing.T, origin *httptest.Server, mediaDir string) http.Handler {
	t.Helper()
	s := New(func() Config { return Config{Base: origin.URL, Key: "testkey"} }, fakeResolver{}, mediaDir, nil)
	return s.Handler()
}

func TestPlaybackInfoRewrite(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(strings.ToLower(r.URL.Path), "playbackinfo") {
			_, _ = w.Write([]byte(`{"MediaSources":[
				{"Id":"ms1","Path":"/media/Movies/a.strm","SupportsTranscoding":true,"TranscodingUrl":"/videos/1/master.m3u8","Protocol":"File"},
				{"Id":"ms2","Path":"/media/Movies/local.mp4","SupportsTranscoding":true,"TranscodingUrl":"/videos/2/master.m3u8"}
			]}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer origin.Close()
	h := newTestProxy(t, origin, "")

	req := httptest.NewRequest(http.MethodPost, "/emby/Items/42/PlaybackInfo?api_key=k", strings.NewReader("{}"))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("code = %d", w.Code)
	}
	var doc struct {
		MediaSources []map[string]any `json:"MediaSources"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &doc); err != nil {
		t.Fatal(err)
	}
	if len(doc.MediaSources) != 2 {
		t.Fatalf("sources = %d", len(doc.MediaSources))
	}
	strm := doc.MediaSources[0]
	if strm["SupportsTranscoding"] != false || strm["SupportsDirectPlay"] != true {
		t.Fatalf("strm source = %+v", strm)
	}
	if _, has := strm["TranscodingUrl"]; has {
		t.Fatal("TranscodingUrl should be removed")
	}
	if got, _ := strm["DirectStreamUrl"].(string); !strings.Contains(got, "/emby/videos/42/stream") {
		t.Fatalf("DirectStreamUrl = %q", got)
	}
	// 本地媒体不动
	local := doc.MediaSources[1]
	if local["SupportsTranscoding"] != true {
		t.Fatalf("local source touched: %+v", local)
	}
	if _, has := local["TranscodingUrl"]; !has {
		t.Fatal("local TranscodingUrl should stay")
	}
}

func TestVideoStream302(t *testing.T) {
	media := t.TempDir()
	strmPath := filepath.Join(media, "Movies", "a.strm")
	if err := os.MkdirAll(filepath.Dir(strmPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(strmPath, []byte("http://h:2048/d/pc1.iso\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.RawQuery, "Ids=77") {
			b, _ := json.Marshal(map[string]any{"Items": []map[string]any{{"Path": strmPath}}})
			_, _ = w.Write(b)
			return
		}
		http.NotFound(w, r)
	}))
	defer origin.Close()
	h := newTestProxy(t, origin, media)

	req := httptest.NewRequest(http.MethodGet, "/emby/videos/77/stream?Static=true", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusFound {
		t.Fatalf("code = %d body=%s", w.Code, w.Body.String())
	}
	if loc := w.Header().Get("Location"); loc != "http://115cdn/pc1" {
		t.Fatalf("location = %q (ext should be stripped)", loc)
	}
}

func TestVideoStreamFallsBackOnFailure(t *testing.T) {
	media := t.TempDir()
	strmPath := filepath.Join(media, "a.strm")
	if err := os.WriteFile(strmPath, []byte("http://h:2048/d/pc1\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.RawQuery, "Ids=77") {
			b, _ := json.Marshal(map[string]any{"Items": []map[string]any{{"Path": strmPath}}})
			_, _ = w.Write(b)
			return
		}
		// 源站有这个路径(回源成功)
		if strings.Contains(strings.ToLower(r.URL.Path), "/videos/77/stream") {
			_, _ = w.Write([]byte("origin-video"))
			return
		}
		http.NotFound(w, r)
	}))
	defer origin.Close()
	s := New(func() Config { return Config{Base: origin.URL, Key: "k"} },
		failingResolver{}, media, nil)
	h := s.Handler()

	req := httptest.NewRequest(http.MethodGet, "/emby/videos/77/stream", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusOK || w.Body.String() != "origin-video" {
		t.Fatalf("fallback = %d %q", w.Code, w.Body.String())
	}
}

type failingResolver struct{}

func (failingResolver) DownloadURL(_ context.Context, _ string) (string, error) {
	return "", context.DeadlineExceeded
}

func TestPassthroughOtherRequests(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(strings.ToLower(r.URL.Path), "system/info") {
			_, _ = w.Write([]byte(`{"ServerName":"test"}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer origin.Close()
	h := newTestProxy(t, origin, "")

	req := httptest.NewRequest(http.MethodGet, "/emby/System/Info", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "test") {
		t.Fatalf("passthrough = %d %q", w.Code, w.Body.String())
	}
}

func TestPickcodeFromStrmFile(t *testing.T) {
	media := t.TempDir()
	s := New(func() Config { return Config{} }, fakeResolver{}, media, nil)
	cases := map[string]string{
		"http://h:2048/d/pc1":            "pc1",
		"http://h:2048/d/pc1.iso":        "pc1",
		"http://h:2048/d/pc1?/name.mkv":  "pc1",
		"http://h:2048/d/u1~pc2.mkv":     "pc2",
		"http://h:2048/other/pc3":        "", // 非 /d/ 格式不解析
	}
	for content, want := range cases {
		p := filepath.Join(media, "x.strm")
		if err := os.WriteFile(p, []byte(content+"\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		if got := s.pickcodeFromStrmFile(p); got != want {
			t.Fatalf("content %q → %q, want %q", content, got, want)
		}
	}
	// 路径穿越防护
	if got := s.pickcodeFromStrmFile("C:\\Windows\\evil.strm"); got != "" {
		t.Fatalf("traversal should be rejected, got %q", got)
	}
}
