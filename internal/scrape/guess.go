package scrape

import (
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// Guess 是从本地路径解析出的媒体身份(纯函数,可整体单测)。
type Guess struct {
	Kind      string // movie | tv | unknown
	Title     string
	Year      int
	ShowTitle string // tv 时是节目名
	Season    int    // tv:-1 表示未知
	Episode   int
}

var (
	yearRe      = regexp.MustCompile(`\((19\d{2}|20\d{2})\)`)
	yearTailRe  = regexp.MustCompile(`\s*[\(._\-\[\s](19\d{2}|20\d{2})[\)\._\-\]\s]?\s*$`)
	seasonDirRe = regexp.MustCompile(`(?i)^\s*(?:season|s|第)\s*(\d{1,2})\s*(?:季)?\s*$`)
	trailingEpRe = regexp.MustCompile(`(?i)^(.*?)[\s._\-\[]s(\d{1,2})e(\d{1,3})[\s._\-\]]?.*$`)
)

// GuessFromRelPath 从相对媒体库根的路径(目录/文件名)解析身份。
// relPath 通常是视频文件路径,如:
//   Movies/沙丘 2 (2024)/沙丘 2 (2024).mkv                → movie
//   Shows/漫长的季节 (2023)/Season 1/漫长的季节 S01E03.mkv → tv
func GuessFromRelPath(relPath string) Guess {
	clean := filepath.ToSlash(relPath)
	segs := strings.Split(clean, "/")
	file := segs[len(segs)-1]
	file = strings.TrimSuffix(file, filepath.Ext(file))

	g := Guess{Kind: "unknown", Season: -1}

	// 剧集:文件名或路径里带 SxxExx
	if m := trailingEpRe.FindStringSubmatch(file); m != nil {
		g.Kind = "tv"
		g.Season, _ = strconv.Atoi(m[2])
		g.Episode, _ = strconv.Atoi(m[3])
		show := strings.TrimSpace(m[1])
		// 父目录里若有季目录,节目名取季目录的上一级
		for i := len(segs) - 2; i >= 0; i-- {
			if m2 := seasonDirRe.FindStringSubmatch(segs[i]); m2 != nil {
				if i > 0 {
					g.ShowTitle = cleanTitle(segs[i-1])
					break
				}
			}
		}
		if g.ShowTitle == "" {
			g.ShowTitle = cleanTitle(show)
		}
		g.Title = g.ShowTitle
		g.Year = yearOf(g.ShowTitle + " " + strings.Join(segs[:len(segs)-1], " "))
		return g
	}

	// 季目录下的裸文件(如 Season 01/01.mkv):节目名取季目录上一级
	for i := len(segs) - 2; i >= 0; i-- {
		if m := seasonDirRe.FindStringSubmatch(segs[i]); m != nil {
			g.Kind = "tv"
			g.Season, _ = strconv.Atoi(m[1])
			if i > 0 {
				g.ShowTitle = cleanTitle(segs[i-1])
				g.Title = g.ShowTitle
				g.Year = yearOf(strings.Join(segs[:i], " "))
			}
			return g
		}
	}

	// 电影:标题 (年份)
	title := cleanTitle(file)
	year := yearOf(file)
	if year == 0 && len(segs) >= 2 {
		year = yearOf(segs[len(segs)-2])
		if title == "" || title == cleanTitle(segs[len(segs)-2]) {
			title = cleanTitle(segs[len(segs)-2])
		}
	}
	g.Kind = "movie"
	g.Title = title
	g.Year = year
	if g.Title == "" {
		g.Kind = "unknown"
	}
	return g
}

// cleanTitle 去掉年份括号与常见噪音。
func cleanTitle(s string) string {
	s = yearRe.ReplaceAllString(s, " ")
	s = strings.NewReplacer(".", " ", "_", " ").Replace(s)
	return strings.TrimSpace(s)
}

func yearOf(s string) int {
	// 先找标题尾部的 (yyyy),再退化到任意 19xx/20xx
	if m := yearTailRe.FindStringSubmatch(s); m != nil {
		n, _ := strconv.Atoi(m[1])
		return n
	}
	if m := yearRe.FindStringSubmatch(s); m != nil {
		n, _ := strconv.Atoi(m[1])
		return n
	}
	return 0
}
