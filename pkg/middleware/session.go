package middleware

import (
	"crypto"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
)

// Sentinel errors returned by SessionValidator.
var (
	ErrNoToken          = errors.New("no session token")
	ErrInvalidSignature = errors.New("invalid token signature")
	ErrTokenExpired     = errors.New("token expired")
	ErrMissingClaims    = errors.New("missing required claims")
	ErrMalformedToken   = errors.New("malformed token")
)

// Claims represents the session context carried in the JWT.
type Claims struct {
	SessionID  string `json:"sid"`
	ResourceID string `json:"rid"`
	Subject    string `json:"sub"`
	IssuedAt   int64  `json:"iat"`
	ExpiresAt  int64  `json:"exp"`
	OneTimeUse bool   `json:"otu,omitempty"`
}

// SessionValidator validates JWT session tokens using an RSA public key.
type SessionValidator struct {
	publicKey crypto.PublicKey
	clockSkew time.Duration
}

// NewSessionValidator creates a validator from a PEM-encoded RSA public key.
// clockSkew specifies the tolerance for expiration checks; 0 defaults to 30s.
func NewSessionValidator(publicKeyPEM []byte, clockSkew time.Duration) (*SessionValidator, error) {
	block, _ := pem.Decode(publicKeyPEM)
	if block == nil {
		return nil, fmt.Errorf("failed to decode PEM block")
	}

	pub, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("failed to parse public key: %w", err)
	}

	if _, ok := pub.(*rsa.PublicKey); !ok {
		return nil, fmt.Errorf("public key is not RSA (got %T)", pub)
	}

	if clockSkew == 0 {
		clockSkew = 30 * time.Second
	}

	return &SessionValidator{
		publicKey: pub,
		clockSkew: clockSkew,
	}, nil
}

// Validate parses and validates a JWT token string.
// It verifies the RS256 signature, checks expiration with clock skew tolerance,
// and ensures all required claims are present.
func (v *SessionValidator) Validate(tokenString string) (*Claims, error) {
	tok, err := jwt.ParseSigned(tokenString, []jose.SignatureAlgorithm{jose.RS256})
	if err != nil {
		return nil, ErrMalformedToken
	}

	var claims Claims
	if err := tok.Claims(v.publicKey, &claims); err != nil {
		return nil, ErrInvalidSignature
	}

	// Check required claims.
	if claims.SessionID == "" || claims.ResourceID == "" || claims.Subject == "" || claims.ExpiresAt == 0 {
		return nil, ErrMissingClaims
	}

	// Check expiration with clock skew tolerance.
	expiry := time.Unix(claims.ExpiresAt, 0)
	if time.Now().After(expiry.Add(v.clockSkew)) {
		return nil, ErrTokenExpired
	}

	return &claims, nil
}
