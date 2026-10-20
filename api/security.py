import hashlib
import hmac
import ipaddress
import secrets
import time
from collections import deque
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Request, Response
from pwdlib import PasswordHash

from api.config import settings
from api.database import connect

password_hasher = PasswordHash.recommended()
dummy_hash = password_hasher.hash(secrets.token_urlsafe(24))
_attempts = {}


def hash_password(password):
    return password_hasher.hash(password)


def verify_password(password, password_hash):
    try:
        return password_hasher.verify(password, password_hash)
    except (ValueError, TypeError):
        return False


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def csrf_for_session(token):
    return hmac.new(settings().csrf_secret.encode(), token.encode(), hashlib.sha256).hexdigest()


def rate_limit(request, category, limit=15, window=600):
    current = time.monotonic()
    address = request.client.host if request.client else "unknown"
    forwarded = request.headers.get("X-Now-Client-IP", "")
    signature = request.headers.get("X-Now-Client-Signature", "")
    expected = hmac.new(settings().internal_secret.encode(), forwarded.encode(), hashlib.sha256).hexdigest()
    if hmac.compare_digest(signature.encode(), expected.encode()):
        try:
            address = str(ipaddress.ip_address(forwarded))
        except ValueError:
            pass
    key = (category, address)
    if len(_attempts) > 10000:
        stale = [entry for entry, values in _attempts.items() if not values or values[-1] < current - window]
        for entry in stale:
            _attempts.pop(entry, None)
        if len(_attempts) > 10000:
            raise HTTPException(429, "操作過於頻繁，請稍後再試。")
    attempts = _attempts.setdefault(key, deque())
    while attempts and attempts[0] <= current - window:
        attempts.popleft()
    if len(attempts) >= limit:
        raise HTTPException(429, "操作過於頻繁，請稍後再試。")
    attempts.append(current)


def session_cookie(admin=False):
    return "now_admin_session" if admin else "now_user_session"


def resolve_session(token, admin=False):
    if not token or len(token) > 256:
        return None
    table, sessions, owner = ("system_admins", "admin_sessions", "system_admin_id") if admin else ("users", "user_sessions", "user_id")
    with connect() as connection:
        return connection.execute(
            f"SELECT accounts.id, accounts.email, accounts.display_name, sessions.expires_at FROM {sessions} sessions JOIN {table} accounts ON accounts.id = sessions.{owner} WHERE sessions.token_hash = %s AND sessions.revoked_at IS NULL AND sessions.expires_at > now() AND accounts.is_active",
            (token_hash(token),),
        ).fetchone()


def resolve_user_session(token):
    return resolve_session(token)


def resolve_admin_session(token):
    return resolve_session(token, True)


def require_session(request: Request, admin=False):
    account = resolve_session(request.cookies.get(session_cookie(admin), ""), admin)
    if not account:
        raise HTTPException(401, "請先登入。")
    return account


def require_csrf(request, admin=False):
    token = request.cookies.get(session_cookie(admin), "")
    actual = request.headers.get("X-CSRF-Token", "")
    if not token or not hmac.compare_digest(actual.encode(), csrf_for_session(token).encode()):
        raise HTTPException(403, "頁面驗證已失效，請重新整理。")


def create_session(connection, account, response: Response, admin=False):
    token = secrets.token_urlsafe(32)
    lifetime = timedelta(hours=8) if admin else timedelta(days=7)
    expires = datetime.now(timezone.utc) + lifetime
    table, owner = ("admin_sessions", "system_admin_id") if admin else ("user_sessions", "user_id")
    connection.execute(f"INSERT INTO {table} ({owner}, token_hash, expires_at) VALUES (%s,%s,%s)", (account["id"], token_hash(token), expires))
    response.set_cookie(session_cookie(admin), token, max_age=int(lifetime.total_seconds()), httponly=True, secure=settings().secure_cookies, samesite="lax", path="/")
    return {"role": "admin" if admin else "user", "admin" if admin else "user": {"id": str(account["id"]), "email": account["email"], "displayName": account["display_name"]}, "csrfToken": csrf_for_session(token), "expiresAt": expires.isoformat()}


def revoke_session(connection, request, response, admin=False):
    cookie = session_cookie(admin)
    token = request.cookies.get(cookie)
    if token:
        table = "admin_sessions" if admin else "user_sessions"
        connection.execute(f"UPDATE {table} SET revoked_at = now() WHERE token_hash = %s AND revoked_at IS NULL", (token_hash(token),))
    response.delete_cookie(cookie, path="/", secure=settings().secure_cookies, httponly=True, samesite="lax")
