package scrape

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// TMDB 是基础刮削的 TMDB v3 API 客户端(只需 search + season poster)。
// base 可注入以便测试。
type TMDB struct {
	Key     string
	Lang    string
	Base    string
	ImgBase string
	client  *http.Client
}

func NewTMDB(key, lang string) *TMDB {
	if lang == "" {
		lang = "zh-CN"
	}
	return &TMDB{
		Key:     key,
		Lang:    lang,
		Base:    "https://api.themoviedb.org/3",
		ImgBase: "https://image.tmdb.org/t/p",
		client:  &http.Client{Timeout: 20 * time.Second},
	}
}

type Match struct {
	ID          int    `json:"id"`
	Title       string `json:"title"`       // movie
	Name        string `json:"name"`        // tv
	PosterPath  string `json:"poster_path"`
	BackdropPath string `json:"backdrop_path"`
	Overview    string `json:"overview"`
	ReleaseDate string `json:"release_date"`     // movie
	FirstAir    string `json:"first_air_date"`   // tv
}

func (m *Match) DisplayName() string {
	if m.Title != "" {
		return m.Title
	}
	return m.Name
}

func (m *Match) Date() string {
	if m.ReleaseDate != "" {
		return m.ReleaseDate
	}
	return m.FirstAir
}

func (t *TMDB) get(ctx context.Context, path string, q url.Values, out any) error {
	q = url.Values(cloneValues(q))
	q.Set("api_key", t.Key)
	q.Set("language", t.Lang)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, t.Base+path+"?"+q.Encode(), nil)
	if err != nil {
		return err
	}
	resp, err := t.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode == http.StatusUnauthorized {
		return fmt.Errorf("TMDB API Key 无效 (401)")
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("TMDB HTTP %d: %s", resp.StatusCode, truncateStr(string(b), 200))
	}
	return json.Unmarshal(b, out)
}

func cloneValues(v url.Values) url.Values {
	out := url.Values{}
	for k, vv := range v {
		for _, s := range vv {
			out.Add(k, s)
		}
	}
	return out
}

func truncateStr(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// SearchMovie 搜索电影;year>0 时附带年份过滤。
func (t *TMDB) SearchMovie(ctx context.Context, title string, year int) (*Match, error) {
	q := url.Values{"query": {title}}
	if year > 0 {
		q.Set("year", strconv.Itoa(year))
	}
	var r struct {
		Results []Match `json:"results"`
	}
	if err := t.get(ctx, "/search/movie", q, &r); err != nil {
		return nil, err
	}
	if len(r.Results) == 0 {
		return nil, nil
	}
	return &r.Results[0], nil
}

// SearchTV 搜索剧集;year>0 时映射为 first_air_date_year。
func (t *TMDB) SearchTV(ctx context.Context, title string, year int) (*Match, error) {
	q := url.Values{"query": {title}}
	if year > 0 {
		q.Set("first_air_date_year", strconv.Itoa(year))
	}
	var r struct {
		Results []Match `json:"results"`
	}
	if err := t.get(ctx, "/search/tv", q, &r); err != nil {
		return nil, err
	}
	if len(r.Results) == 0 {
		return nil, nil
	}
	return &r.Results[0], nil
}

// SeasonPoster 取某一季的海报路径(写季目录 poster.jpg 用)。
func (t *TMDB) SeasonPoster(ctx context.Context, tvID, season int) (string, error) {
	var r struct {
		PosterPath string `json:"poster_path"`
	}
	if err := t.get(ctx, fmt.Sprintf("/tv/%d/season/%d", tvID, season), url.Values{}, &r); err != nil {
		return "", err
	}
	return r.PosterPath, nil
}

// ImageURL 拼海报/剧照直链。size 常用 w500(海报) / w1280(背景)。
func (t *TMDB) ImageURL(path, size string) string {
	if path == "" {
		return ""
	}
	return t.ImgBase + "/" + size + path
}
