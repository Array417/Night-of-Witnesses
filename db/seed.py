import os

from api.database import connect
from api.security import hash_password


def seed_admin(email, password):
    if not 12 <= len(password) <= 128:
        raise ValueError("Seed password must contain 12–128 characters")
    with connect() as connection:
        account = connection.execute("INSERT INTO system_admins(email,password_hash) VALUES (%s,%s) ON CONFLICT(email) DO NOTHING RETURNING id", (email.strip().lower(), hash_password(password))).fetchone()
        return account is not None


if __name__ == "__main__":
    password = os.environ.get("SEED_ADMIN_PASSWORD")
    if not password:
        raise SystemExit("Set SEED_ADMIN_PASSWORD before running seed; existing passwords are never overwritten")
    print("Admin created" if seed_admin(os.environ.get("SEED_ADMIN_EMAIL", "admin@now.com"), password) else "Admin already exists; unchanged")
