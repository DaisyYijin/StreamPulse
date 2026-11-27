package emby

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestParseWebhook(t *testing.T) {
	w, err := ParseWebhook([]byte(`{"Event":"library.deleted","Item":{"Id":"1","Name":"a","Type":"Movie","Path":"/m/a.mkv"}}`))
	if err != nil {
		t.Fatal(err)
	}
	if w.Event != "library.deleted" || w.Item.Type != "Movie" {
		t.Fatalf("%+v", w)
	}

	w2, err := ParseWebhook([]byte(`{"NotificationType":"library.new","Item":{"Name":"b"}}`))
	if err != nil {
		t.Fatal(err)
	}
	if w2.Event != "library.new" || w2.Item.Name != "b" {
		t.Fatalf("%+v", w2)
	}
}

func TestRefreshLibrary(t *testing.T) {
	var gotPath, gotToken string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotToken = r.Header.Get("X-Emby-Token")
		_, _ = w.Write([]byte(`{}`))
	}))
	defer ts.Close()

	c := New(ts.URL, "key1")
	if err := c.RefreshLibrary(context.Background(), ""); err != nil {
		t.Fatal(err)
	}
	if gotPath != "/emby/Library/Refresh" || gotToken != "key1" {
		t.Fatalf("path=%q token=%q", gotPath, gotToken)
	}
	if err := c.RefreshLibrary(context.Background(), "42"); err != nil {
		t.Fatal(err)
	}
	if gotPath != "/emby/Items/42/Refresh" {
		t.Fatalf("path=%q", gotPath)
	}
}
