import logging
import os
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator
from psycopg.errors import UniqueViolation

from api.config import settings
from api.database import connect
from api.mail import send_password_reset
from api.security import create_session, csrf_for_session, dummy_hash, hash_password, rate_limit, require_csrf, require_session, revoke_session, session_cookie, token_hash, verify_password

router = APIRouter()


class Payload(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EmailPayload(Payload):
    email: EmailStr

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value):
        return value.strip().lower() if isinstance(value, str) else value


class Login(EmailPayload):
    password: str = Field(min_length=1, max_length=128)


class PasswordPayload(Payload):
    password: str = Field(min_length=12, max_length=128)
    confirmPassword: str = Field(min_length=12, max_length=128)

    @model_validator(mode="after")
    def passwords_match(self):
        if self.password != self.confirmPassword:
            raise ValueError("兩次密碼不一致。")
        return self


class Register(EmailPayload, PasswordPayload):
    displayName: str = Field(min_length=1, max_length=24)

    @field_validator("displayName")
    @classmethod
    def normalize_name(cls, value):
        if not value.strip():
            raise ValueError("請輸入暱稱。")
        return value.strip()


class Reset(PasswordPayload):
    token: str = Field(min_length=20, max_length=256)


@router.post("/api/auth/register", status_code=201)
def register(payload: Register, request: Request, response: Response):
    rate_limit(request, "register", 60)
    try:
        with connect() as connection:
            account = connection.execute("INSERT INTO users(email, display_name, password_hash, last_login_at) VALUES (%s,%s,%s,now()) RETURNING *", (str(payload.email), payload.displayName, hash_password(payload.password))).fetchone()
            revoke_session(connection, request, response, True)
            return create_session(connection, account, response)
    except UniqueViolation:
        raise HTTPException(409, "此電郵已被使用，請登入或重設密碼。") from None


def login_account(payload, request, response, admin=False):
    rate_limit(request, "admin-login" if admin else "login", 20)
    with connect() as connection:
        candidates = []
        for is_admin in ((True, False) if admin is None else (admin,)):
            table = "system_admins" if is_admin else "users"
            account = connection.execute(f"SELECT * FROM {table} WHERE email = %s AND is_active FOR UPDATE", (str(payload.email),)).fetchone()
            candidates.append((is_admin, table, account))
        verified = [(is_admin, table, account, verify_password(payload.password, account["password_hash"] if account else dummy_hash)) for is_admin, table, account in candidates]
        selected = next(((is_admin, table, account) for is_admin, table, account, valid in verified if account and valid), None)
        if not selected:
            raise HTTPException(401, "電郵或密碼不正確。")
        is_admin, table, account = selected
        connection.execute(f"UPDATE {table} SET last_login_at = now() WHERE id = %s", (account["id"],))
        revoke_session(connection, request, response, not is_admin)
        return create_session(connection, account, response, is_admin)


@router.post("/api/auth/login")
def login(payload: Login, request: Request, response: Response):
    return login_account(payload, request, response, None)


def logout_account(request, response, admin=False):
    require_session(request, admin)
    require_csrf(request, admin)
    with connect() as connection:
        revoke_session(connection, request, response, admin)
    return {"message": "已登出。"}


@router.post("/api/auth/logout")
def logout(request: Request, response: Response):
    return logout_account(request, response)


def current_account(request, admin=False):
    account = require_session(request, admin)
    return {"role": "admin" if admin else "user", "admin" if admin else "user": {"id": str(account["id"]), "email": account["email"], "displayName": account["display_name"]}, "csrfToken": csrf_for_session(request.cookies[session_cookie(admin)]), "expiresAt": account["expires_at"].isoformat()}


@router.get("/api/auth/me")
def me(request: Request):
    return current_account(request)


@router.post("/api/auth/forgot-password")
def forgot_password(payload: EmailPayload, request: Request):
    rate_limit(request, "reset", 6)
    if not os.environ.get("SMTP_HOST"):
        raise HTTPException(503, "郵件服務暫時無法使用，請稍後再試。")
    with connect() as connection:
        account = connection.execute("SELECT id FROM users WHERE email = %s AND is_active", (str(payload.email),)).fetchone()
        if account:
            token = secrets.token_urlsafe(32)
            connection.execute("INSERT INTO password_reset_tokens(user_id, token_hash, expires_at) VALUES (%s,%s,%s)", (account["id"], token_hash(token), datetime.now(timezone.utc) + timedelta(minutes=30)))
            try:
                send_password_reset(str(payload.email), settings().public_url + "/reset-password?token=" + token)
            except Exception:
                logging.error("Password reset delivery failed; check SMTP configuration")
                connection.rollback()
    return {"message": "如電郵已註冊，你將收到密碼重設連結，請檢查收件匣及垃圾郵件。"}


@router.post("/api/auth/reset-password")
def reset_password(payload: Reset, request: Request):
    rate_limit(request, "reset-confirm", 15)
    with connect() as connection:
        reset = connection.execute("SELECT * FROM password_reset_tokens WHERE token_hash = %s AND used_at IS NULL AND expires_at > now() FOR UPDATE", (token_hash(payload.token),)).fetchone()
        if not reset:
            raise HTTPException(400, "重設連結無效或已過期，請重新申請。")
        connection.execute("UPDATE users SET password_hash = %s, updated_at = now() WHERE id = %s", (hash_password(payload.password), reset["user_id"]))
        connection.execute("UPDATE password_reset_tokens SET used_at = now() WHERE user_id = %s AND used_at IS NULL", (reset["user_id"],))
        connection.execute("UPDATE user_sessions SET revoked_at = now() WHERE user_id = %s AND revoked_at IS NULL", (reset["user_id"],))
    return {"message": "密碼已更新，請重新登入。"}
