package apiclient

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestListResources(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			t.Errorf("expected GET, got %s", r.Method)
		}
		if r.URL.Path != "/v1/resources" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}

		resp := ListResourcesResponse{
			Resources: []Resource{
				{
					ID:        "res-1",
					Name:      "web-app",
					TargetURL: "http://localhost:8080",
					Type:      "http",
					Status:    "active",
					CreatedAt: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
					UpdatedAt: time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC),
				},
				{
					ID:          "res-2",
					Name:        "ssh-server",
					TargetURL:   "tcp://10.0.0.5:22",
					Type:        "ssh",
					Status:      "active",
					ConnectorID: "conn-1",
					CreatedAt:   time.Date(2026, 1, 3, 0, 0, 0, 0, time.UTC),
					UpdatedAt:   time.Date(2026, 1, 3, 0, 0, 0, 0, time.UTC),
				},
			},
			Total: 2,
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(200)
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer ts.Close()

	c := New(ts.URL+"/v1", "tok", WithMaxRetries(0))
	result, err := c.ListResources(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result.Total != 2 {
		t.Errorf("expected total 2, got %d", result.Total)
	}
	if len(result.Resources) != 2 {
		t.Fatalf("expected 2 resources, got %d", len(result.Resources))
	}
	if result.Resources[0].ID != "res-1" {
		t.Errorf("expected first resource ID res-1, got %s", result.Resources[0].ID)
	}
	if result.Resources[0].Name != "web-app" {
		t.Errorf("expected first resource name web-app, got %s", result.Resources[0].Name)
	}
	if result.Resources[1].ConnectorID != "conn-1" {
		t.Errorf("expected second resource connector_id conn-1, got %s", result.Resources[1].ConnectorID)
	}
}

func TestGetResource(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			t.Errorf("expected GET, got %s", r.Method)
		}
		if r.URL.Path != "/v1/resources/res-42" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}

		resp := Resource{
			ID:        "res-42",
			Name:      "api-server",
			TargetURL: "http://localhost:3000",
			Type:      "http",
			Status:    "active",
			CreatedAt: time.Date(2026, 3, 15, 10, 0, 0, 0, time.UTC),
			UpdatedAt: time.Date(2026, 3, 15, 12, 0, 0, 0, time.UTC),
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(200)
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer ts.Close()

	c := New(ts.URL+"/v1", "tok", WithMaxRetries(0))
	res, err := c.GetResource(context.Background(), "res-42")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.ID != "res-42" {
		t.Errorf("expected ID res-42, got %s", res.ID)
	}
	if res.Name != "api-server" {
		t.Errorf("expected name api-server, got %s", res.Name)
	}
	if res.Type != "http" {
		t.Errorf("expected type http, got %s", res.Type)
	}
}

func TestGetResource_NotFound(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(404)
		_, _ = w.Write([]byte(`{"status_code":404,"code":"not_found","message":"resource not found"}`))
	}))
	defer ts.Close()

	c := New(ts.URL+"/v1", "tok", WithMaxRetries(0))
	_, err := c.GetResource(context.Background(), "missing")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !IsNotFound(err) {
		t.Errorf("expected IsNotFound true, got false: %v", err)
	}
}

func TestCreateResource(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if r.URL.Path != "/v1/resources" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		if ct := r.Header.Get("Content-Type"); ct != "application/json" {
			t.Errorf("expected Content-Type application/json, got %s", ct)
		}

		var req CreateResourceRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		if req.Name != "new-app" {
			t.Errorf("expected name new-app, got %s", req.Name)
		}
		if req.TargetURL != "http://localhost:9090" {
			t.Errorf("expected target_url http://localhost:9090, got %s", req.TargetURL)
		}
		if req.Type != "http" {
			t.Errorf("expected type http, got %s", req.Type)
		}

		resp := Resource{
			ID:        "res-new",
			Name:      req.Name,
			TargetURL: req.TargetURL,
			Type:      req.Type,
			Status:    "pending",
			CreatedAt: time.Date(2026, 4, 6, 0, 0, 0, 0, time.UTC),
			UpdatedAt: time.Date(2026, 4, 6, 0, 0, 0, 0, time.UTC),
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(201)
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer ts.Close()

	c := New(ts.URL+"/v1", "tok", WithMaxRetries(0))
	res, err := c.CreateResource(context.Background(), &CreateResourceRequest{
		Name:      "new-app",
		TargetURL: "http://localhost:9090",
		Type:      "http",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.ID != "res-new" {
		t.Errorf("expected ID res-new, got %s", res.ID)
	}
	if res.Status != "pending" {
		t.Errorf("expected status pending, got %s", res.Status)
	}
}

func TestDeleteResource(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "DELETE" {
			t.Errorf("expected DELETE, got %s", r.Method)
		}
		if r.URL.Path != "/v1/resources/res-del" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		w.WriteHeader(204)
	}))
	defer ts.Close()

	c := New(ts.URL+"/v1", "tok", WithMaxRetries(0))
	err := c.DeleteResource(context.Background(), "res-del")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestDeleteResource_NotFound(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(404)
		_, _ = w.Write([]byte(`{"status_code":404,"code":"not_found","message":"resource not found"}`))
	}))
	defer ts.Close()

	c := New(ts.URL+"/v1", "tok", WithMaxRetries(0))
	err := c.DeleteResource(context.Background(), "ghost")
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !IsNotFound(err) {
		t.Errorf("expected IsNotFound true, got false: %v", err)
	}
}

func TestHealth(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			t.Errorf("expected GET, got %s", r.Method)
		}
		if r.URL.Path != "/v1/health" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(200)
		_, _ = w.Write([]byte(`{"status":"healthy","version":"1.2.3"}`))
	}))
	defer ts.Close()

	c := New(ts.URL+"/v1", "tok", WithMaxRetries(0))
	h, err := c.Health(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if h.Status != "healthy" {
		t.Errorf("expected status healthy, got %s", h.Status)
	}
	if h.Version != "1.2.3" {
		t.Errorf("expected version 1.2.3, got %s", h.Version)
	}
}

func TestHeartbeat(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if r.URL.Path != "/v1/connectors/heartbeat" {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}

		var req HeartbeatRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		if req.ConnectorID != "conn-99" {
			t.Errorf("expected connector_id conn-99, got %s", req.ConnectorID)
		}
		if req.MachineID != "machine-x" {
			t.Errorf("expected machine_id machine-x, got %s", req.MachineID)
		}
		if req.Uptime != 7200 {
			t.Errorf("expected uptime 7200, got %d", req.Uptime)
		}

		w.WriteHeader(204)
	}))
	defer ts.Close()

	c := New(ts.URL+"/v1", "tok", WithMaxRetries(0))
	err := c.Heartbeat(context.Background(), &HeartbeatRequest{
		ConnectorID: "conn-99",
		MachineID:   "machine-x",
		Uptime:      7200,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}
