package apperr

import (
	"errors"
	"fmt"
	"net/http"
	"testing"
)

func TestFromExtractsAppError(t *testing.T) {
	ae := E(http.StatusBadGateway, CodeUpstream, "上游不可用")
	wrapped := fmt.Errorf("扫描失败: %w", ae)
	got := From(wrapped)
	if got.Status != http.StatusBadGateway || got.Code != CodeUpstream {
		t.Fatalf("from = %+v", got)
	}
}

func TestFromPlainError(t *testing.T) {
	got := From(errors.New("boom"))
	if got.Status != http.StatusInternalServerError || got.Code != CodeInternal {
		t.Fatalf("from = %+v", got)
	}
	if got.Message != "boom" {
		t.Fatalf("message = %q", got.Message)
	}
}

func TestUnwrap(t *testing.T) {
	inner := errors.New("disk full")
	ae := Wrap(inner, http.StatusInternalServerError, CodeInternal, "写失败")
	if !errors.Is(ae, inner) {
		t.Fatal("errors.Is should unwrap to inner")
	}
}
