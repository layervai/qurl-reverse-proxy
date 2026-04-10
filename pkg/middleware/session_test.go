package middleware

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
)

// testKeypair holds an RSA keypair for testing.
var (
	testPrivateKey *rsa.PrivateKey
	testPublicPEM  []byte

	otherPrivateKey *rsa.PrivateKey
)

func init() {
	var err error
	testPrivateKey, err = rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		panic("failed to generate test RSA key: " + err.Error())
	}

	pubBytes, err := x509.MarshalPKIXPublicKey(&testPrivateKey.PublicKey)
	if err != nil {
		panic("failed to marshal public key: " + err.Error())
	}
	testPublicPEM = pem.EncodeToMemory(&pem.Block{
		Type:  "PUBLIC KEY",
		Bytes: pubBytes,
	})

	otherPrivateKey, err = rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		panic("failed to generate other RSA key: " + err.Error())
	}
}

func signToken(t *testing.T, key *rsa.PrivateKey, claims Claims) string {
	t.Helper()

	signer, err := jose.NewSigner(
		jose.SigningKey{Algorithm: jose.RS256, Key: key},
		(&jose.SignerOptions{}).WithType("JWT"),
	)
	if err != nil {
		t.Fatalf("failed to create signer: %v", err)
	}

	builder := jwt.Signed(signer).Claims(claims)
	token, err := builder.Serialize()
	if err != nil {
		t.Fatalf("failed to serialize token: %v", err)
	}
	return token
}

func TestValidate(t *testing.T) {
	now := time.Now()

	tests := []struct {
		name      string
		signKey   *rsa.PrivateKey
		claims    Claims
		clockSkew time.Duration
		wantErr   error
	}{
		{
			name:    "valid token",
			signKey: testPrivateKey,
			claims: Claims{
				SessionID:  "sess-1",
				ResourceID: "res-1",
				Subject:    "user@example.com",
				IssuedAt:   now.Unix(),
				ExpiresAt:  now.Add(5 * time.Minute).Unix(),
			},
			wantErr: nil,
		},
		{
			name:    "expired token",
			signKey: testPrivateKey,
			claims: Claims{
				SessionID:  "sess-2",
				ResourceID: "res-1",
				Subject:    "user@example.com",
				IssuedAt:   now.Add(-10 * time.Minute).Unix(),
				ExpiresAt:  now.Add(-5 * time.Minute).Unix(),
			},
			wantErr: ErrTokenExpired,
		},
		{
			name:    "bad signature (different key)",
			signKey: otherPrivateKey,
			claims: Claims{
				SessionID:  "sess-3",
				ResourceID: "res-1",
				Subject:    "user@example.com",
				IssuedAt:   now.Unix(),
				ExpiresAt:  now.Add(5 * time.Minute).Unix(),
			},
			wantErr: ErrInvalidSignature,
		},
		{
			name:    "missing required claims (no rid)",
			signKey: testPrivateKey,
			claims: Claims{
				SessionID:  "sess-4",
				ResourceID: "",
				Subject:    "user@example.com",
				IssuedAt:   now.Unix(),
				ExpiresAt:  now.Add(5 * time.Minute).Unix(),
			},
			wantErr: ErrMissingClaims,
		},
		{
			name:    "missing required claims (no sid)",
			signKey: testPrivateKey,
			claims: Claims{
				SessionID:  "",
				ResourceID: "res-1",
				Subject:    "user@example.com",
				IssuedAt:   now.Unix(),
				ExpiresAt:  now.Add(5 * time.Minute).Unix(),
			},
			wantErr: ErrMissingClaims,
		},
		{
			name:    "missing required claims (no sub)",
			signKey: testPrivateKey,
			claims: Claims{
				SessionID:  "sess-5",
				ResourceID: "res-1",
				Subject:    "",
				IssuedAt:   now.Unix(),
				ExpiresAt:  now.Add(5 * time.Minute).Unix(),
			},
			wantErr: ErrMissingClaims,
		},
		{
			name:    "missing required claims (no exp)",
			signKey: testPrivateKey,
			claims: Claims{
				SessionID:  "sess-6",
				ResourceID: "res-1",
				Subject:    "user@example.com",
				IssuedAt:   now.Unix(),
				ExpiresAt:  0,
			},
			wantErr: ErrMissingClaims,
		},
		{
			name:    "clock skew tolerance - expired 15s ago with 30s skew",
			signKey: testPrivateKey,
			claims: Claims{
				SessionID:  "sess-7",
				ResourceID: "res-1",
				Subject:    "user@example.com",
				IssuedAt:   now.Add(-5 * time.Minute).Unix(),
				ExpiresAt:  now.Add(-15 * time.Second).Unix(),
			},
			clockSkew: 30 * time.Second,
			wantErr:   nil,
		},
		{
			name:    "clock skew exceeded - expired 60s ago with 30s skew",
			signKey: testPrivateKey,
			claims: Claims{
				SessionID:  "sess-8",
				ResourceID: "res-1",
				Subject:    "user@example.com",
				IssuedAt:   now.Add(-5 * time.Minute).Unix(),
				ExpiresAt:  now.Add(-60 * time.Second).Unix(),
			},
			clockSkew: 30 * time.Second,
			wantErr:   ErrTokenExpired,
		},
		{
			name:    "valid token with one_time_use",
			signKey: testPrivateKey,
			claims: Claims{
				SessionID:  "sess-9",
				ResourceID: "res-1",
				Subject:    "user@example.com",
				IssuedAt:   now.Unix(),
				ExpiresAt:  now.Add(5 * time.Minute).Unix(),
				OneTimeUse: true,
			},
			wantErr: nil,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			skew := tt.clockSkew
			if skew == 0 && tt.wantErr != ErrTokenExpired {
				// Use default for non-skew tests.
				skew = 0
			}

			v, err := NewSessionValidator(testPublicPEM, skew)
			if err != nil {
				t.Fatalf("NewSessionValidator failed: %v", err)
			}

			token := signToken(t, tt.signKey, tt.claims)
			got, err := v.Validate(token)

			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Errorf("Validate() error = %v, want %v", err, tt.wantErr)
				}
				return
			}

			if err != nil {
				t.Fatalf("Validate() unexpected error: %v", err)
			}

			if got.SessionID != tt.claims.SessionID {
				t.Errorf("SessionID = %q, want %q", got.SessionID, tt.claims.SessionID)
			}
			if got.ResourceID != tt.claims.ResourceID {
				t.Errorf("ResourceID = %q, want %q", got.ResourceID, tt.claims.ResourceID)
			}
			if got.Subject != tt.claims.Subject {
				t.Errorf("Subject = %q, want %q", got.Subject, tt.claims.Subject)
			}
			if got.OneTimeUse != tt.claims.OneTimeUse {
				t.Errorf("OneTimeUse = %v, want %v", got.OneTimeUse, tt.claims.OneTimeUse)
			}
		})
	}
}

func TestValidateMalformedToken(t *testing.T) {
	v, err := NewSessionValidator(testPublicPEM, 0)
	if err != nil {
		t.Fatalf("NewSessionValidator failed: %v", err)
	}

	_, err = v.Validate("not-a-jwt")
	if !errors.Is(err, ErrMalformedToken) {
		t.Errorf("Validate(malformed) error = %v, want %v", err, ErrMalformedToken)
	}
}

func TestNewSessionValidatorBadPEM(t *testing.T) {
	_, err := NewSessionValidator([]byte("not a pem"), 0)
	if err == nil {
		t.Error("expected error for bad PEM, got nil")
	}
}
