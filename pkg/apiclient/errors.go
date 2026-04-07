package apiclient

import (
	"errors"
	"fmt"
)

// APIError represents a non-2xx response from the QURL API.
type APIError struct {
	StatusCode int    `json:"status_code"`
	Code       string `json:"code"`
	Message    string `json:"message"`
	RequestID  string `json:"request_id"`
}

func (e *APIError) Error() string {
	if e.RequestID != "" {
		return fmt.Sprintf("qurl api error %d (%s): %s [request_id=%s]", e.StatusCode, e.Code, e.Message, e.RequestID)
	}
	return fmt.Sprintf("qurl api error %d (%s): %s", e.StatusCode, e.Code, e.Message)
}

// IsNotFound reports whether err is an APIError with status 404.
func IsNotFound(err error) bool {
	var apiErr *APIError
	if errors.As(err, &apiErr) {
		return apiErr.StatusCode == 404
	}
	return false
}

// IsUnauthorized reports whether err is an APIError with status 401.
func IsUnauthorized(err error) bool {
	var apiErr *APIError
	if errors.As(err, &apiErr) {
		return apiErr.StatusCode == 401
	}
	return false
}

// IsForbidden reports whether err is an APIError with status 403.
func IsForbidden(err error) bool {
	var apiErr *APIError
	if errors.As(err, &apiErr) {
		return apiErr.StatusCode == 403
	}
	return false
}

// IsRateLimited reports whether err is an APIError with status 429.
func IsRateLimited(err error) bool {
	var apiErr *APIError
	if errors.As(err, &apiErr) {
		return apiErr.StatusCode == 429
	}
	return false
}

// IsServerError reports whether err is an APIError with a 5xx status code.
func IsServerError(err error) bool {
	var apiErr *APIError
	if errors.As(err, &apiErr) {
		return apiErr.StatusCode >= 500 && apiErr.StatusCode < 600
	}
	return false
}
