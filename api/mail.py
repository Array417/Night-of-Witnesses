import os
import smtplib
import ssl
from email.message import EmailMessage


def send_password_reset(email, reset_url):
    host = os.environ.get("SMTP_HOST")
    if not host:
        raise RuntimeError("SMTP_HOST is required")
    message = EmailMessage()
    message["Subject"] = "目擊者之夜 — 重設密碼"
    message["From"] = os.environ.get("SMTP_FROM", "no-reply@now.example")
    message["To"] = email
    message.set_content(f"你申請了重設《目擊者之夜》的登入密碼。\n\n{reset_url}\n\n此連結 30 分鐘後失效，且只能使用一次。如非本人申請，請忽略此郵件。")
    port = int(os.environ.get("SMTP_PORT", "587"))
    implicit_tls = os.environ.get("SMTP_TLS", "starttls") == "tls"
    transport = smtplib.SMTP_SSL if implicit_tls else smtplib.SMTP
    with transport(host, port, timeout=10) as server:
        if os.environ.get("SMTP_TLS", "starttls") == "starttls":
            server.starttls(context=ssl.create_default_context())
        if os.environ.get("SMTP_USER"):
            server.login(os.environ["SMTP_USER"], os.environ["SMTP_PASSWORD"])
        server.send_message(message)
