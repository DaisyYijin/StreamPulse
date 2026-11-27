package api

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"streampulse/internal/config"
	"streampulse/internal/emby"
	"streampulse/internal/p115svc"
	"streampulse/internal/store"
)

func newTestApp(t *testing.T) (*App, *store.Store) {
	t.Helper()
	dir := t.TempDir()
	cfg := &config.Config{
		Port: 6060, StreamPort: 6086, DataDir: dir, ConfigDir: dir, MediaDir: dir, LogDir: dir,
		AdminUser: "admin", AdminPass: "pass", PlayMode: "redirect",
		PublicBase: "http://h:6086", ReadEvery: time.Millisecond, WriteEvery: time.Millisecond,
	}
	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	svc := p115svc.New(st, cfg)
	app, err := New(cfg, st, svc, emby.New("", ""), nil, slog.Default())
	if err != nil {
		t.Fatal(err)
	}
	return app, st
}

func doJSON(t *testing.T, h http.Handler, method, path, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var r *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	} else {
		r = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, r)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

func TestLoginAndAuth(t *testing.T) {
	app, _ := newTestApp(t)
	h := app.Handler()

	if w := doJSON(t, h, http.MethodGet, "/api/status", "", nil); w.Code != 401 {
		t.Fatalf("unauth status = %d", w.Code)
	}
	if w := doJSON(t, h, http.MethodPost, "/api/login", "", map[string]string{"username": "admin", "password": "bad"}); w.Code != 401 {
		t.Fatalf("bad password = %d", w.Code)
	}
	w := doJSON(t, h, http.MethodPost, "/api/login", "", map[string]string{"username": "admin", "password": "pass"})
	if w.Code != 200 {
		t.Fatalf("login = %d %s", w.Code, w.Body.String())
	}
	var resp struct {
		Token string `json:"token"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Token == "" {
		t.Fatal("empty token")
	}

	w = doJSON(t, h, http.MethodGet, "/api/status", resp.Token, nil)
	if w.Code != 200 {
		t.Fatalf("status = %d", w.Code)
	}
	var st map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &st)
	if st["version"] == "" {
		t.Fatalf("status body = %v", st)
	}
}

func TestLibraryCRUD(t *testing.T) {
	app, st := newTestApp(t)
	h := app.Handler()
	accID, err := st.SaveAccount(&store.Account{Name: "main", Role: "main", AuthType: "cookie", Cookie: "UID=1"})
	if err != nil {
		t.Fatal(err)
	}

	w := doJSON(t, h, http.MethodPost, "/api/login", "", map[string]string{"username": "admin", "password": "pass"})
	var login struct {
		Token string `json:"token"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &login)

	lib := map[string]any{
		"name": "movies", "accountId": accID, "remoteCid": "0",
		"localDir": t.TempDir(), "baseUrl": "http://h:6086",
	}
	w = doJSON(t, h, http.MethodPost, "/api/libraries", login.Token, lib)
	if w.Code != 200 {
		t.Fatalf("create = %d %s", w.Code, w.Body.String())
	}
	var created struct {
		ID int64 `json:"id"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &created)
	if created.ID == 0 {
		t.Fatal("no id")
	}

	w = doJSON(t, h, http.MethodGet, "/api/libraries", login.Token, nil)
	var list []store.Library
	_ = json.Unmarshal(w.Body.Bytes(), &list)
	if len(list) != 1 || list[0].Name != "movies" {
		t.Fatalf("list = %+v", list)
	}
	if list[0].ScanMode != "fast" || list[0].STRMFormat != "pick_code" {
		t.Fatalf("defaults = %+v", list[0])
	}
}

func TestEmbyWebhookAndIndex(t *testing.T) {
	app, _ := newTestApp(t)
	h := app.Handler()

	req := httptest.NewRequest(http.MethodPost, "/api/emby/webhook",
		bytes.NewBufferString(`{"Event":"library.new","Item":{"Name":"a","Type":"Movie"}}`))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusNoContent {
		t.Fatalf("webhook = %d %s", w.Code, w.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/", nil)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 200 || !bytes.Contains(w.Body.Bytes(), []byte("StreamPulse")) {
		t.Fatalf("index = %d", w.Code)
	}
}

func TestPasswordHash(t *testing.T) {
	h := hashPassword("secret")
	if h == "secret" || !verifyPassword("secret", h) || verifyPassword("wrong", h) {
		t.Fatal("password hash/verify failed")
	}
}
