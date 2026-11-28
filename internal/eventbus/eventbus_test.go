package eventbus

import "testing"

func TestSubscribePublishUnsubscribe(t *testing.T) {
	b := New()
	var got []int
	un1 := b.Subscribe("e", func(p any) { got = append(got, 1) })
	un2 := b.Subscribe("e", func(p any) { got = append(got, 2) })

	b.Publish("e", nil)
	if len(got) != 2 {
		t.Fatalf("got = %v", got)
	}

	un1()
	got = nil
	b.Publish("e", nil)
	if len(got) != 1 || got[0] != 2 {
		t.Fatalf("after unsubscribe got = %v", got)
	}

	un2()
	got = nil
	b.Publish("e", nil)
	if len(got) != 0 {
		t.Fatalf("all removed, got = %v", got)
	}
}

func TestIsolatedByEvent(t *testing.T) {
	b := New()
	calls := 0
	b.Subscribe("a", func(p any) { calls++ })
	b.Publish("b", nil)
	if calls != 0 {
		t.Fatal("event leaked across names")
	}
	b.Publish("a", nil)
	if calls != 1 {
		t.Fatal("subscriber not called")
	}
}
