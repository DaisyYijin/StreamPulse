package stream

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
)

type countingProvider struct {
	calls atomic.Int64
	url   string
	err   error
}

func (f *countingProvider) DownloadURL(_ context.Context, _ string) (string, error) {
	f.calls.Add(1)
	return f.url, f.err
}

func TestSingleflightMergesConcurrent(t *testing.T) {
	p := &countingProvider{url: "http://cdn/file"}
	s := New(p, "redirect", nil)
	h := s.Handler()

	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			req := httptest.NewRequest(http.MethodGet, "/d/pc1", nil)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, req)
			if w.Code != http.StatusFound {
				t.Errorf("code = %d", w.Code)
			}
		}()
	}
	wg.Wait()
	if n := p.calls.Load(); n != 1 {
		t.Fatalf("upstream calls = %d, want 1 (singleflight)", n)
	}
}

func TestHeadValidationRefetches(t *testing.T) {
	// 直链服务:第一次给的地址 HEAD 404 → 触发重取
	var phase atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead {
			if phase.Load() == 0 {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			w.WriteHeader(http.StatusOK)
			return
		}
		_, _ = w.Write([]byte("data"))
	}))
	defer upstream.Close()

	p := &countingProvider{url: upstream.URL}
	s := New(p, "redirect", nil)
	h := s.Handler()

	req := httptest.NewRequest(http.MethodGet, "/d/pc1", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusFound {
		t.Fatalf("first play = %d", w.Code)
	}
	if n := p.calls.Load(); n != 1 {
		t.Fatalf("first play calls = %d, want 1", n)
	}
	// 第二次播放:缓存命中但 HEAD 404 → 失效重取
	req = httptest.NewRequest(http.MethodGet, "/d/pc1", nil)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusFound {
		t.Fatalf("second play = %d", w.Code)
	}
	if n := p.calls.Load(); n != 2 {
		t.Fatalf("calls = %d, want 2 (HEAD 404 → refetch)", n)
	}
	phase.Store(1)
	// 第三次播放:HEAD 200,缓存生效不再取链
	req = httptest.NewRequest(http.MethodGet, "/d/pc1", nil)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusFound {
		t.Fatalf("third play = %d", w.Code)
	}
	if n := p.calls.Load(); n != 2 {
		t.Fatalf("calls after cache hit = %d, want 2", n)
	}
}

func TestResolveErrorNotCached(t *testing.T) {
	p := &countingProvider{err: errors.New("115 down")}
	s := New(p, "redirect", nil)
	h := s.Handler()
	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodGet, "/d/pc1", nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != http.StatusBadGateway {
			t.Fatalf("code = %d", w.Code)
		}
	}
	if n := p.calls.Load(); n != 2 {
		t.Fatalf("errors should not be cached, calls = %d", n)
	}
}
