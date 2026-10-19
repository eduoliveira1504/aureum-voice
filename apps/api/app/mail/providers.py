"""Where e-mails actually go, picked by EMAIL_PROVIDER. Adding a provider (Resend, Brevo...) is a
class with send() and an entry in get_provider()."""

import asyncio
import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from functools import lru_cache
from typing import Protocol

from app.config import get_settings

SENDER_NAME = "Aureum"


@dataclass(frozen=True)
class Email:
    to: str
    subject: str
    html: str
    text: str


class Provider(Protocol):
    async def send(self, email: Email) -> None: ...


class NotConfigured(Exception):
    pass


class SmtpProvider:
    """Any SMTP server; now the Aureum Gmail account with an app password (SMTP_* in .env)."""

    async def send(self, email: Email) -> None:
        s = get_settings()
        if not (s.email_from and s.smtp_user and s.smtp_password):
            raise NotConfigured("EMAIL_FROM, SMTP_USER and SMTP_PASSWORD must be set")
        message = EmailMessage()
        message["Subject"] = email.subject
        message["From"] = formataddr((SENDER_NAME, s.email_from))
        message["To"] = email.to
        message["Message-ID"] = make_msgid(domain=s.email_from.rpartition("@")[2] or None)
        message.set_content(email.text)
        message.add_alternative(email.html, subtype="html")
        await asyncio.to_thread(self._deliver, message)

    @staticmethod
    def _deliver(message: EmailMessage) -> None:
        s = get_settings()
        context = ssl.create_default_context()
        if s.smtp_port == 465:
            with smtplib.SMTP_SSL(s.smtp_host, s.smtp_port, timeout=30, context=context) as smtp:
                smtp.login(s.smtp_user, s.smtp_password)
                smtp.send_message(message)
        else:
            with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=30) as smtp:
                smtp.starttls(context=context)
                smtp.login(s.smtp_user, s.smtp_password)
                smtp.send_message(message)


class MemoryProvider:
    """Keeps what would have been sent (the test suite reads it)."""

    def __init__(self) -> None:
        self.sent: list[Email] = []
        self.fail_next = 0  # tests make deliveries fail this many times

    async def send(self, email: Email) -> None:
        if self.fail_next > 0:
            self.fail_next -= 1
            raise ConnectionError("simulated failure")
        self.sent.append(email)


@lru_cache
def get_provider() -> Provider:
    return MemoryProvider() if get_settings().email_provider == "memory" else SmtpProvider()
