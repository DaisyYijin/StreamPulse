package pan115

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestListBehaviorParsesAndIgnores(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("limit") != "10" {
			t.Errorf("limit = %q", r.URL.Query().Get("limit"))
		}
		_, _ = w.Write([]byte(`{"state":true,"data":{"count":4,"list":[
			{"id":"300","type":"1","file_id":"f1","file_name":"a.mkv","parent_id":"c1","pick_code":"pc1","file_size":100,"update_time":"1700000000"},
			{"id":"299","type":"browse_video","file_id":"f2","file_name":"b.mkv","parent_id":"c1"},
			{"id":"298","type":"2","fid":"f3","n":"c.mkv","cid":"c2","pc":"pc3"},
			{"id":"297","type":"star_file","file_id":"f4"}]}}`))
	}))
	defer srv.Close()

	c := New(Credential{Cookie: "x"}, time.Millisecond, time.Millisecond)
	c.ProAPI = srv.URL
	c.WebAPI = srv.URL

	evs, err := c.ListBehavior(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(evs) != 2 {
		t.Fatalf("events = %+v", evs)
	}
	if evs[0].ID != "300" || evs[0].FileID != "f1" || evs[0].CID != "c1" || evs[0].Pickcode != "pc1" || evs[0].Size != 100 {
		t.Fatalf("event0 = %+v", evs[0])
	}
	if evs[1].ID != "298" || evs[1].FileName != "c.mkv" || evs[1].Pickcode != "pc3" {
		t.Fatalf("event1 = %+v", evs[1])
	}
}

func TestListBehaviorFallsBackToWeb(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/android/behavior/detail", func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "too many requests", http.StatusTooManyRequests)
	})
	mux.HandleFunc("/behavior/detail", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"state":true,"data":{"list":[{"id":"9","type":"1","file_id":"f","parent_id":"c"}]}}`))
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	c := New(Credential{Cookie: "x"}, time.Millisecond, time.Millisecond)
	c.ProAPI = srv.URL
	c.WebAPI = srv.URL

	evs, err := c.ListBehavior(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(evs) != 1 || evs[0].ID != "9" {
		t.Fatalf("events = %+v", evs)
	}
}

func TestDeleteToRecycle(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/rb/delete" {
			t.Errorf("path = %q", r.URL.Path)
		}
		_ = r.ParseForm()
		if r.Form.Get("fid[0]") != "a" || r.Form.Get("fid[1]") != "b" {
			t.Errorf("form = %v", r.Form)
		}
		_, _ = w.Write([]byte(`{"state":true}`))
	}))
	defer srv.Close()

	c := New(Credential{Cookie: "x"}, time.Millisecond, time.Millisecond)
	c.WebAPI = srv.URL
	if err := c.DeleteToRecycle(context.Background(), []string{"a", "b"}); err != nil {
		t.Fatal(err)
	}
}
