package scrape

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"streampulse/internal/store"
)

// fakeTMDB 模拟 TMDB search + season + 图片。
func fakeTMDB() *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.Contains(r.URL.Path, "/search/movie"):
			_, _ = w.Write([]byte(`{"results":[{"id":111,"title":"沙丘 2","poster_path":"/p1.jpg","backdrop_path":"/b1.jpg","overview":"剧情简介","release_date":"2024-03-01"}]}`))
		case strings.Contains(r.URL.Path, "/search/tv"):
			_, _ = w.Write([]byte(`{"results":[{"id":222,"name":"漫长的季节","poster_path":"/p2.jpg","overview":"东北故事","first_air_date":"2023-04-01"}]}`))
		case strings.Contains(r.URL.Path, "/season/"):
			_, _ = w.Write([]byte(`{"poster_path":"/sp.jpg"}`))
		case strings.HasPrefix(r.URL.Path, "/img/"):
			_, _ = w.Write([]byte("PNGDATA"))
		default:
			http.NotFound(w, r)
		}
	}))
}

func setupScrapeLib(t *testing.T) (*store.Store, *store.Library, string) {
	t.Helper()
	st, err := store.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	root := t.TempDir()
	accID, _ := st.SaveAccount(&store.Account{Name: "main", Role: "main", AuthType: "cookie", Cookie: "UID=1"})
	libID, _ := st.SaveLibrary(&store.Library{
		Name: "m", AccountID: accID, RemoteCID: "0", LocalDir: root,
		BaseURL: "http://h:2048", VideoExts: ".mkv", Enabled: true,
	})
	_ = st.SetSetting("tmdb_api_key", "testkey")
	_ = st.SetSetting("tmdb_language", "zh-CN")

	// 台账:一部电影 + 一部剧集
	movie := filepath.Join(root, "Movies", "沙丘 2 (2024)", "沙丘 2 (2024).mkv")
	if err := os.MkdirAll(filepath.Dir(movie), 0o755); err != nil {
		t.Fatal(err)
	}
	_ = st.UpsertFile(&store.SyncedFile{LibraryID: libID, FID: "f1", Pickcode: "pc1", CID: "c1",
		Name: "movie.mkv", RelPath: "Movies/沙丘 2 (2024)/movie.mkv", STRMPath: movie, Status: "ok"})
	tv := filepath.Join(root, "Shows", "漫长的季节 (2023)", "Season 1", "ep1.mkv")
	if err := os.MkdirAll(filepath.Dir(tv), 0o755); err != nil {
		t.Fatal(err)
	}
	_ = st.UpsertFile(&store.SyncedFile{LibraryID: libID, FID: "f2", Pickcode: "pc2", CID: "c2",
		Name: "ep1.mkv", RelPath: "Shows/漫长的季节 (2023)/Season 1/漫长的季节 S01E03.mkv", STRMPath: tv, Status: "ok"})
	lib, _ := st.GetLibrary(libID)
	return st, lib, root
}

func TestScrapeLibraryWritesNFOAndImages(t *testing.T) {
	st, lib, root := setupScrapeLib(t)
	ts := fakeTMDB()
	defer ts.Close()

	s := &Service{Store: st, Log: slog.Default()}
	sum, err := s.ScrapeLibrary(context.Background(), lib.ID, ts.URL)
	if err != nil {
		t.Fatal(err)
	}
	if sum.OK != 2 || sum.Failed != 0 {
		t.Fatalf("summary = %+v", sum)
	}
	// 电影产物
	nfo, err := os.ReadFile(filepath.Join(root, "Movies", "沙丘 2 (2024)", "movie.nfo"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(nfo), "<tmdbid>111</tmdbid>") || !strings.Contains(string(nfo), "<movie>") {
		t.Fatalf("movie.nfo = %s", string(nfo))
	}
	poster := filepath.Join(root, "Movies", "沙丘 2 (2024)", "poster.jpg")
	if st0, err := os.Stat(poster); err != nil || st0.Size() == 0 {
		t.Fatal("movie poster missing")
	}
	// 剧集产物 + 季海报
	showNfo, err := os.ReadFile(filepath.Join(root, "Shows", "漫长的季节 (2023)", "tvshow.nfo"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(showNfo), "<tmdbid>222</tmdbid>") {
		t.Fatalf("tvshow.nfo = %s", string(showNfo))
	}
	seasonPoster := filepath.Join(root, "Shows", "漫长的季节 (2023)", "Season 1", "poster.jpg")
	if _, err := os.Stat(seasonPoster); err != nil {
		t.Fatal("season poster missing")
	}
	records, _ := st.ListScrapeRecords(10)
	if len(records) != 1 || records[0].OK != 2 {
		t.Fatalf("records = %+v", records)
	}

	// 幂等:再跑一次全 skipped
	sum2, err := s.ScrapeLibrary(context.Background(), lib.ID, ts.URL)
	if err != nil {
		t.Fatal(err)
	}
	if sum2.Skipped != 2 || sum2.OK != 0 {
		t.Fatalf("second run = %+v", sum2)
	}
}

func TestScrapeNoKeyFails(t *testing.T) {
	st, lib, _ := setupScrapeLib(t)
	_ = st.SetSetting("tmdb_api_key", "")
	s := &Service{Store: st, Log: slog.Default()}
	_, err := s.ScrapeLibrary(context.Background(), lib.ID, "")
	if err == nil || !strings.Contains(err.Error(), "TMDB API Key") {
		t.Fatalf("err = %v", err)
	}
}

func TestScrapeNoMatchReportsFailed(t *testing.T) {
	st, lib, _ := setupScrapeLib(t)
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"results":[]}`))
	}))
	defer ts.Close()
	s := &Service{Store: st, Log: slog.Default()}
	sum, err := s.ScrapeLibrary(context.Background(), lib.ID, ts.URL)
	if err != nil {
		t.Fatal(err)
	}
	if sum.Failed != 2 {
		t.Fatalf("summary = %+v", sum)
	}
}
