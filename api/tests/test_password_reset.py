import os
from datetime import datetime, timedelta, timezone

import psycopg

from api.tests.conftest import register
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from fastapi.testclient import TestClient


def test_reset_is_single_use_and_revokes_sessions(client, monkeypatch):
    register(client)
    messages = []
    monkeypatch.setattr("api.auth.send_password_reset", lambda email, url: messages.append(url))
    known = client.post("/api/auth/forgot-password", json={"email": "player@example.com"})
    unknown = client.post("/api/auth/forgot-password", json={"email": "absent@example.com"})
    assert known.json() == unknown.json()
    assert messages[0].startswith("http://localhost:3000/reset-password?token=")
    token = messages[0].split("token=")[1]
    payload = {"token": token, "password": "New-Password123!", "confirmPassword": "New-Password123!"}
    assert client.post("/api/auth/reset-password", json=payload).status_code == 200
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/reset-password", json=payload).status_code == 400


def test_expired_reset_is_rejected(client, monkeypatch):
    register(client)
    messages = []
    monkeypatch.setattr("api.auth.send_password_reset", lambda email, url: messages.append(url))
    client.post("/api/auth/forgot-password", json={"email": "player@example.com"})
    with psycopg.connect(os.environ["DATABASE_URL"]) as connection:
        connection.execute("UPDATE password_reset_tokens SET created_at = %s, expires_at = %s", (datetime.now(timezone.utc) - timedelta(hours=1), datetime.now(timezone.utc) - timedelta(minutes=1)))
    assert client.post("/api/auth/reset-password", json={"token": messages[0].split("token=")[1], "password": "New-Password123!", "confirmPassword": "New-Password123!"}).status_code == 400


def test_mail_failure_does_not_reveal_whether_account_exists(client, monkeypatch):
    register(client)
    def failed_delivery(email, url):
        raise OSError("SMTP offline")
    monkeypatch.setattr("api.auth.send_password_reset", failed_delivery)
    known = client.post("/api/auth/forgot-password", json={"email": "player@example.com"})
    unknown = client.post("/api/auth/forgot-password", json={"email": "absent@example.com"})
    assert known.status_code == unknown.status_code
    assert known.json() == unknown.json()
    monkeypatch.delenv("SMTP_HOST")
    assert client.post("/api/auth/forgot-password", json={"email": "absent@example.com"}).status_code == 503


def test_reset_serializes_with_old_password_login(client, monkeypatch):
    import api.auth
    from api.app import create_app

    register(client)
    messages = []
    monkeypatch.setattr("api.auth.send_password_reset", lambda email, url: messages.append(url))
    client.post("/api/auth/forgot-password", json={"email": "player@example.com"})
    verifying, release = Event(), Event()
    original_verify = api.auth.verify_password

    def paused_verify(password, stored_hash):
        verifying.set()
        assert release.wait(10)
        return original_verify(password, stored_hash)

    monkeypatch.setattr(api.auth, "verify_password", paused_verify)
    reset_payload = {"token": messages[0].split("token=")[1], "password": "New-Password123!", "confirmPassword": "New-Password123!"}
    with TestClient(create_app(), headers={"Origin": "http://localhost:3000"}) as login_client, ThreadPoolExecutor(max_workers=2) as pool:
        pending_login = pool.submit(login_client.post, "/api/auth/login", json={"email": "player@example.com", "password": "Test-Password123!"})
        assert verifying.wait(5)
        pending_reset = pool.submit(client.post, "/api/auth/reset-password", json=reset_payload)
        try:
            pending_reset.result(timeout=0.5)
        except TimeoutError:
            pass
        finally:
            release.set()
        assert pending_login.result(timeout=10).status_code == 200
        assert pending_reset.result(timeout=10).status_code == 200
        assert login_client.get("/api/auth/me").status_code == 401
