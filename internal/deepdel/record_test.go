package deepdel

import (
	"context"
	"log/slog"
	"testing"
)

func TestEpisodeLabel(t *testing.T) {
	cases := []struct {
		paths []string
		want  string
	}{
		{[]string{"/media/Show/S02/E05 - name.strm"}, "S02E05"},
		{[]string{"/tv/S02E01.strm", "/tv/S02E02.strm", "/tv/S02E03.strm"}, "S02E01–E03"},
		{[]string{"/s1/e1.strm", "/s2/e5.strm"}, "S01–S02"},
		{[]string{"/movies/Movie (2024).strm"}, ""},
		{nil, ""},
	}
	for _, c := range cases {
		if got := EpisodeLabel(c.paths); got != c.want {
			t.Fatalf("EpisodeLabel(%v) = %q, want %q", c.paths, got, c.want)
		}
	}
}

func TestHandleRecordsRejected(t *testing.T) {
	st, _, _, strm := setup(t)
	svc := &Service{Store: st, Log: slog.Default(), Svc: &fakeRemote{}}
	res, err := svc.Handle(context.Background(), Item{Type: "Folder", Name: "x", Path: strm})
	if err != nil || res.Rejected == "" {
		t.Fatalf("should reject Folder type: %+v %v", res, err)
	}
	records, err := st.ListDeepDeleteRecords("", 10)
	if err != nil || len(records) != 1 {
		t.Fatalf("records = %v %v", records, err)
	}
	if records[0].Status != "rejected" || records[0].ItemType != "Folder" {
		t.Fatalf("record = %+v", records[0])
	}
	counts, _, _, err := st.DeepDeleteStats()
	if err != nil || counts["rejected"] != 1 {
		t.Fatalf("stats = %v %v", counts, err)
	}
}

func TestHandleRecordsDeletedFids(t *testing.T) {
	st, _, _, strm := setup(t)
	svc := &Service{Store: st, Log: slog.Default(), Svc: &fakeRemote{}}
	res, err := svc.Handle(context.Background(), Item{Type: "Episode", Name: "ep", Path: strm})
	if err != nil || res.Rejected != "" {
		t.Fatalf("handle = %+v %v", res, err)
	}
	records, _ := st.ListDeepDeleteRecords("done", 10)
	if len(records) != 1 {
		t.Fatalf("records = %d", len(records))
	}
	if len(records[0].FIDs) != 1 || records[0].FIDs[0] != "f1" {
		t.Fatalf("fids = %v (回收站还原凭据)", records[0].FIDs)
	}
	if len(records[0].RelPaths) == 0 {
		t.Fatal("rel paths missing")
	}
	if records[0].EpisodeLabel != "S01E01" && records[0].EpisodeLabel != "" {
		t.Fatalf("episode label = %q", records[0].EpisodeLabel)
	}
}
