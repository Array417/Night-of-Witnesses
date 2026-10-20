import hashlib
import hmac
import os

from api.tests.conftest import register


def client_headers(address, trusted=True):
    signature = hmac.new(os.environ["INTERNAL_API_SECRET"].encode(), address.encode(), hashlib.sha256).hexdigest() if trusted else "forged"
    return {"X-Now-Client-IP": address, "X-Now-Client-Signature": signature}


def test_trusted_proxy_clients_have_independent_limits(client):
    register(client)
    payload = {"email": "player@example.com", "password": "wrong"}
    for attempt in range(20):
        assert client.post("/api/auth/login", json=payload, headers=client_headers("192.0.2.1")).status_code == 401
    assert client.post("/api/auth/login", json=payload, headers=client_headers("192.0.2.1")).status_code == 429
    assert client.post("/api/auth/login", json=payload, headers=client_headers("192.0.2.2")).status_code == 401


def test_untrusted_forwarding_headers_cannot_bypass_limits(client):
    payload = {"email": "absent@example.com", "password": "wrong"}
    for attempt in range(20):
        assert client.post("/api/auth/login", json=payload, headers=client_headers(f"192.0.2.{attempt}", False)).status_code == 401
    assert client.post("/api/auth/login", json=payload, headers=client_headers("192.0.2.250", False)).status_code == 429
