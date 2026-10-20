from datetime import datetime, timedelta, timezone
import os

import psycopg

from api.tests.conftest import register


def test_register_login_logout_and_email_normalization(client):
    account = register(client, "Player@Example.com", "<script>目擊者</script>")
    assert account["user"]["email"] == "player@example.com"
    assert "password" not in str(account).lower()
    assert client.get("/api/auth/me").status_code == 200
    assert client.post("/api/auth/logout", json={}).status_code == 403
    assert client.post("/api/auth/logout", json={}, headers={"X-CSRF-Token": account["csrfToken"]}).status_code == 200
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/auth/login", json={"email": "PLAYER@example.com", "password": "Test-Password123!"}).status_code == 200
    assert client.get("/api/admin/overview").status_code == 401


def test_password_boundaries_and_session_expiry(client):
    assert client.post("/api/auth/register", json={"email": "short@example.com", "displayName": "測試", "password": "short", "confirmPassword": "short"}).status_code == 422
    register(client)
    with psycopg.connect(os.environ["DATABASE_URL"]) as connection:
        connection.execute("UPDATE user_sessions SET expires_at = %s, created_at = %s", (datetime.now(timezone.utc) - timedelta(seconds=1), datetime.now(timezone.utc) - timedelta(days=8)))
    assert client.get("/api/auth/me").status_code == 401


def test_admin_is_separate_and_seed_does_not_reset_password(client):
    from db.seed import seed_admin

    assert seed_admin("admin@now.com", "Admin-Test-Password123!")
    assert not seed_admin("admin@now.com", "Different-Password123!")
    response = client.post("/api/admin/auth/login", json={"email": "admin@now.com", "password": "Admin-Test-Password123!"})
    assert response.status_code == 200
    assert client.get("/api/admin/overview").status_code == 200
    assert client.get("/api/auth/me").status_code == 401


def test_csrf_origin_and_duplicate_email(client):
    register(client)
    assert client.post("/api/auth/logout", json={}, headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.post("/api/auth/register", json={"email": "PLAYER@example.com", "displayName": "其他人", "password": "Test-Password123!", "confirmPassword": "Test-Password123!"}).status_code == 409


def test_shared_login_detects_permission_and_revokes_other_identity(client):
    from db.seed import seed_admin

    register(client)
    user_token = client.cookies["now_user_session"]
    assert seed_admin("operator@example.com", "Admin-Test-Password123!")
    response = client.post("/api/auth/login", json={"email": "OPERATOR@example.com", "password": "Admin-Test-Password123!"})
    assert response.status_code == 200
    assert response.json()["role"] == "admin"
    assert "user" not in response.json()
    assert client.get("/api/admin/overview").status_code == 200
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/admin/auth/me").json()["role"] == "admin"
    admin_token = client.cookies["now_admin_session"]
    with psycopg.connect(os.environ["DATABASE_URL"]) as connection:
        assert connection.execute("SELECT count(*) FROM user_sessions WHERE revoked_at IS NULL").fetchone()[0] == 0
    response = client.post("/api/auth/login", json={"email": "player@example.com", "password": "Test-Password123!"})
    assert response.status_code == 200
    assert response.json()["role"] == "user"
    assert "admin" not in response.json()
    assert client.get("/api/admin/overview").status_code == 401
    assert client.get("/api/auth/me").json()["role"] == "user"
    assert client.get("/api/admin/auth/me", headers={"Cookie": f"now_admin_session={admin_token}"}).status_code == 401
    assert client.get("/api/auth/me", headers={"Cookie": f"now_user_session={user_token}"}).status_code == 401


def test_shared_email_does_not_grant_admin_permission_for_player_password(client):
    from db.seed import seed_admin

    register(client, "shared@example.com")
    assert seed_admin("shared@example.com", "Admin-Test-Password123!")
    response = client.post("/api/auth/login", json={"email": "shared@example.com", "password": "Test-Password123!"})
    assert response.status_code == 200
    assert response.json()["role"] == "user"
    assert client.get("/api/admin/overview").status_code == 401
    assert client.post("/api/auth/login", json={"email": "shared@example.com", "password": "wrong"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": "shared@example.com", "password": "Test-Password123!", "role": "admin"}).status_code == 422
    assert client.post("/api/auth/register", json={"email": "escalation@example.com", "displayName": "管理員", "password": "Test-Password123!", "confirmPassword": "Test-Password123!", "role": "admin"}).status_code == 422
    with psycopg.connect(os.environ["DATABASE_URL"]) as connection:
        connection.execute("UPDATE system_admins SET is_active = false")
    assert client.post("/api/auth/login", json={"email": "shared@example.com", "password": "Admin-Test-Password123!"}).status_code == 401
