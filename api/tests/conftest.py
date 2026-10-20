import os

import psycopg
import pytest
from fastapi.testclient import TestClient

from db.migrate import apply_migrations


@pytest.fixture()
def client():
    from api.app import create_app
    from api.security import _attempts

    assert os.environ["APP_ENV"] == "test"
    _attempts.clear()
    with psycopg.connect(os.environ["DATABASE_URL"]) as connection:
        apply_migrations(connection)
        connection.execute("TRUNCATE users, system_admins, rooms CASCADE")
    with TestClient(create_app()) as test_client:
        test_client.headers["Origin"] = "http://localhost:3000"
        yield test_client


def register(client, email="player@example.com", name="目擊者"):
    response = client.post("/api/auth/register", json={
        "email": email, "displayName": name,
        "password": "Test-Password123!", "confirmPassword": "Test-Password123!",
    })
    assert response.status_code == 201, response.text
    return response.json()
