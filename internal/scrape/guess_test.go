package scrape

import "testing"

func TestGuessFromRelPath(t *testing.T) {
	cases := []struct {
		rel   string
		kind  string
		title string
		year  int
		s     int
		e     int
	}{
		{"Movies/沙丘 2 (2024)/沙丘 2 (2024).mkv", "movie", "沙丘 2", 2024, -1, 0},
		{"Movies/Inception (2010)/Inception (2010).mkv", "movie", "Inception", 2010, -1, 0},
		{"Shows/漫长的季节 (2023)/Season 1/漫长的季节 S01E03.mkv", "tv", "漫长的季节", 2023, 1, 3},
		{"Shows/庆余年 (2019)/Season 2/庆余年.S02E05.1080p.mkv", "tv", "庆余年", 2019, 2, 5},
	}
	for _, c := range cases {
		g := GuessFromRelPath(c.rel)
		if g.Kind != c.kind || g.Title != c.title || g.Year != c.year || g.Season != c.s || g.Episode != c.e {
			t.Fatalf("guess(%q) = %+v, want kind=%s title=%q year=%d s=%d e=%d",
				c.rel, g, c.kind, c.title, c.year, c.s, c.e)
		}
	}
	// 季目录下裸文件
	g := GuessFromRelPath("Shows/斗罗大陆 (2021)/Season 02/03.mkv")
	if g.Kind != "tv" || g.Season != 2 || g.ShowTitle != "斗罗大陆" {
		t.Fatalf("bare season file = %+v", g)
	}
	// 解析不出 → unknown(不乱写 nfo)
	g = GuessFromRelPath("whatever/random.mkv")
	if g.Kind != "movie" && g.Kind != "unknown" {
		t.Fatalf("unexpected kind %q", g.Kind)
	}
}

func TestGuessNoPanicOnWeirdNames(t *testing.T) {
	for _, rel := range []string{"", "x.strm", "a/b/c/d/e.mkv", "第 3 季/ep.mkv", "S/01.mkv"} {
		func() {
			defer func() {
				if r := recover(); r != nil {
					t.Fatalf("panic on %q: %v", rel, r)
				}
			}()
			_ = GuessFromRelPath(rel)
		}()
	}
}
