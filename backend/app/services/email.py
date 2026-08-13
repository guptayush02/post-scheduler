import logging

import aiosmtplib
from email.message import EmailMessage

from app.core.config import settings

logger = logging.getLogger("scheduler.email")


async def send_verification_email(to_email: str, token: str) -> None:
    verify_link = f"{settings.frontend_base_url}/verify-email?token={token}"

    if not settings.smtp_host:
        logger.info("SMTP not configured - verification link for %s: %s", to_email, verify_link)
        return

    message = EmailMessage()
    message["From"] = settings.smtp_from_email
    message["To"] = to_email
    message["Subject"] = "Verify your email"
    message.set_content(
        f"Welcome! Please verify your email by visiting this link:\n\n{verify_link}\n\n"
        "This link expires in 24 hours."
    )

    await aiosmtplib.send(
        message,
        hostname=settings.smtp_host,
        port=settings.smtp_port,
        username=settings.smtp_user,
        password=settings.smtp_password,
        start_tls=True,
    )
