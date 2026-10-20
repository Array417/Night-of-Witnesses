from fastapi import APIRouter, Query, Request, Response

from api.auth import Login, current_account, login_account, logout_account
from api.database import connect
from api.security import require_session

router = APIRouter(prefix="/api/admin")


@router.post("/auth/login")
def login(payload: Login, request: Request, response: Response):
    return login_account(payload, request, response, True)


@router.post("/auth/logout")
def logout(request: Request, response: Response):
    return logout_account(request, response, True)


@router.get("/auth/me")
def me(request: Request):
    return current_account(request, True)


@router.get("/overview")
def overview(request: Request):
    require_session(request, True)
    with connect() as connection:
        return connection.execute("SELECT (SELECT count(*) FROM users)::integer AS users, count(*) FILTER(WHERE status='completed')::integer AS completed, count(*) FILTER(WHERE status='abandoned')::integer AS abandoned, count(*) FILTER(WHERE status='in_progress')::integer AS \"inProgress\" FROM matches").fetchone()


@router.get("/users")
def users(request: Request, page: int = Query(1, ge=1), pageSize: int = Query(10, ge=1, le=50)):
    require_session(request, True)
    with connect() as connection:
        total = connection.execute("SELECT count(*) AS total FROM users").fetchone()["total"]
        items = connection.execute("SELECT id,email,display_name AS \"displayName\",created_at AS \"createdAt\",last_login_at AS \"lastLoginAt\",is_active AS \"isActive\" FROM users ORDER BY created_at DESC,id LIMIT %s OFFSET %s", (pageSize, (page-1)*pageSize)).fetchall()
    return {"items": items, "total": total, "page": page, "pageSize": pageSize}


@router.get("/matches")
def matches(request: Request, page: int = Query(1, ge=1), pageSize: int = Query(10, ge=1, le=50)):
    require_session(request, True)
    with connect() as connection:
        total = connection.execute("SELECT count(*) AS total FROM matches").fetchone()["total"]
        items = connection.execute("SELECT id,level,status,started_at AS \"startedAt\",ended_at AS \"endedAt\",result_reason AS reason FROM matches ORDER BY started_at DESC,id LIMIT %s OFFSET %s", (pageSize, (page-1)*pageSize)).fetchall()
    return {"items": items, "total": total, "page": page, "pageSize": pageSize}
