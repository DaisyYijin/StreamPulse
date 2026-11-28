package apperr

import (
	"errors"
	"fmt"
	"net/http"
)

// AppError 是带机器码与 HTTP 状态的统一业务错误。
// api 层用它把错误统一映射成 {"error": {"code": ..., "message": ...}} 响应;
// 老的 writeErr(裸文本)继续可用,两者共用同一个响应外层结构。
type AppError struct {
	Status  int    // HTTP 状态码
	Code    string // 机器码,如 not_logged_in / upstream_unavailable
	Message string // 用户可读文案
	Err     error  // 底层原因,可为空
}

func (e *AppError) Error() string {
	if e.Err != nil {
		return e.Message + ": " + e.Err.Error()
	}
	return e.Message
}

func (e *AppError) Unwrap() error { return e.Err }

func New(status int, code, message string) *AppError {
	return &AppError{Status: status, Code: code, Message: message}
}

func Wrap(err error, status int, code, message string) *AppError {
	return &AppError{Status: status, Code: code, Message: message, Err: err}
}

// From 提取错误链里的 *AppError;没有则包成 500 internal_error。
func From(err error) *AppError {
	var ae *AppError
	if errors.As(err, &ae) {
		return ae
	}
	if err == nil {
		return nil
	}
	return &AppError{Status: http.StatusInternalServerError, Code: "internal_error", Message: err.Error()}
}

// E 是常用错误的快捷构造。
func E(status int, code, format string, a ...any) *AppError {
	return New(status, code, fmt.Sprintf(format, a...))
}

// 常用错误码。
const (
	CodeNotLoggedIn    = "not_logged_in"
	CodeBadPayload     = "bad_payload"
	CodeNotFound       = "not_found"
	CodeConflict       = "conflict"
	CodeUpstream       = "upstream_unavailable"
	CodeRateLimited    = "rate_limited"
	CodeBusy           = "busy"
	CodeNotConfigured  = "not_configured"
	CodeInternal       = "internal_error"
)

// StatusOf 返回错误对应的 HTTP 状态;非 AppError 一律 500。
func StatusOf(err error) int {
	return From(err).Status
}

// PayloadOf 返回响应体里的 error 对象。
func PayloadOf(err error) map[string]string {
	ae := From(err)
	return map[string]string{"code": ae.Code, "message": ae.Message}
}
