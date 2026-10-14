"""Отслеживание новых записей и платежей (event watcher).

Бот периодически опрашивает backend и уведомляет администратора об
изменениях. Состояние хранится в JSON-файле, чтобы не слать дубликаты
после перезапуска.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from .backend import BackendClient
from .formatting import format_booking_event, format_payment_event

logger = logging.getLogger(__name__)

Notify = Callable[[str], Awaitable[None]]

_PAYMENT_FINAL_STATUSES = {"succeeded", "canceled", "expired"}


class EventState:
    """Персистентное состояние event watcher'а."""

    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self.sessions: dict[str, dict[str, Any]] = {}
        self.payments: dict[str, dict[str, Any]] = {}
        self.initialized = False

    def load(self) -> None:
        if not self.path.exists():
            return
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            logger.warning("Failed to load state: %s", error)
            return

        sessions = data.get("sessions")
        payments = data.get("payments")
        self.sessions = sessions if isinstance(sessions, dict) else {}
        self.payments = payments if isinstance(payments, dict) else {}
        self.initialized = bool(data.get("initialized"))

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "initialized": self.initialized,
            "sessions": self.sessions,
            "payments": self.payments,
        }
        self.path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


async def _notify_booking_events(
    backend: BackendClient,
    notify: Notify,
    state: EventState,
    current_sessions: dict[str, dict[str, Any]],
) -> None:
    for session_id, session in current_sessions.items():
        previous = state.sessions.get(session_id)
        if not previous:
            await notify(
                format_booking_event("Новая запись", session, str(session.get("status") or "scheduled"))
            )
            continue

        old_status = str(previous.get("status") or "")
        new_status = str(session.get("status") or "")
        if old_status != new_status:
            title = "Запись отменена" if new_status == "cancelled" else "Статус записи изменен"
            await notify(format_booking_event(title, session, new_status))


async def _notify_payment_events(
    notify: Notify,
    state: EventState,
    current_payments: dict[str, dict[str, Any]],
) -> None:
    for payment_id, payment in current_payments.items():
        previous = state.payments.get(payment_id)
        new_status = str(payment.get("status") or "")
        if new_status not in _PAYMENT_FINAL_STATUSES:
            continue

        old_status = str(previous.get("status") or "") if previous else ""
        if previous is None or old_status != new_status:
            title = "Оплата получена" if new_status == "succeeded" else "Оплата отменена"
            await notify(format_payment_event(title, payment, new_status))


async def event_watcher_loop(
    backend: BackendClient,
    notify: Notify,
    *,
    state: EventState,
    enabled: bool,
    interval: int = 30,
) -> None:
    """Бесконечно следит за записями и платежами, уведомляя через ``notify``."""
    if not enabled:
        logger.warning("Event watcher disabled")
        return

    state.load()
    while True:
        try:
            future_sessions, past_sessions, payments = await asyncio.gather(
                backend.sessions(past=False, limit=500),
                backend.sessions(past=True, limit=500),
                backend.payments(limit=100),
            )

            current_sessions = {
                str(item.get("id")): item
                for item in future_sessions + past_sessions
                if item.get("id")
            }
            current_payments = {
                str(item.get("id")): item for item in payments if item.get("id")
            }

            if state.initialized:
                await _notify_booking_events(backend, notify, state, current_sessions)
                await _notify_payment_events(notify, state, current_payments)

            state.sessions = {
                key: {
                    "status": value.get("status"),
                    "session_datetime": value.get("session_datetime"),
                }
                for key, value in current_sessions.items()
            }
            state.payments = {
                key: {"status": value.get("status"), "paid_at": value.get("paid_at")}
                for key, value in current_payments.items()
            }
            state.initialized = True
            state.save()
        except Exception:
            logger.exception("Event watcher failed")

        await asyncio.sleep(interval)
