import logging
import os

import psycopg
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from api.config import settings
from api.database import connect


def create_app():
    configuration = settings()
    application = FastAPI(title="目擊者之夜帳戶服務", docs_url=None, redoc_url=None, openapi_url=None)

    @application.middleware("http")
    async def boundaries(request: Request, call_next):
        if request.url.path.startswith("/api/") and request.method in ("POST", "PUT", "PATCH", "DELETE"):
            if request.headers.get("origin") not in configuration.origins:
                return JSONResponse({"message": "不允許的請求來源。"}, status_code=403)
            if request.headers.get("content-type", "").split(";")[0] != "application/json":
                return JSONResponse({"message": "請使用 JSON 格式。"}, status_code=415)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @application.exception_handler(HTTPException)
    async def http_error(request, error):
        return JSONResponse({"message": error.detail}, status_code=error.status_code)

    @application.exception_handler(RequestValidationError)
    async def validation_error(request, error):
        return JSONResponse({"message": "資料格式不正確。請檢查電郵、暱稱及密碼（12–128 字元），確認兩次密碼一致。"}, status_code=422)

    @application.exception_handler(psycopg.Error)
    async def database_error(request, error):
        logging.error("Database operation failed (%s)", type(error).__name__)
        return JSONResponse({"message": "資料服務暫時無法使用，請稍後再試。"}, status_code=503)

    @application.get("/healthz")
    def health():
        return {"ok": True}

    @application.get("/readyz")
    def ready():
        with connect() as connection:
            if not connection.execute("SELECT 1 FROM schema_migrations WHERE version = '001'").fetchone():
                raise HTTPException(503, "Database migration required")
        if not os.environ.get("SMTP_HOST"):
            raise HTTPException(503, "SMTP_HOST is required for password reset")
        return {"ok": True}

    from api.auth import router as auth_router
    from api.admin import router as admin_router
    from api.history import router as history_router
    from api.internal import router as internal_router
    for router in (auth_router, admin_router, history_router, internal_router):
        application.include_router(router)
    return application


app = create_app()
