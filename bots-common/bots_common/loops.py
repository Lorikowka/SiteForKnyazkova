"""Фоновые задачи ботов: напоминания и утренние сводки."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Any

from .backend import BackendClient
from .formatting import period_today

logger = logging.getLogger(__name__)

Notify = Callable[[str], Awaitable[None]]
BuildSessionText = Callable[[dict[str, Any]], str]
BuildSummaryText = Callable[[int, float], str]


async def reminders_loop(
    backend: BackendClient,
    notify: Notify,
    *,
    enabled: bool,
    build_text: BuildSessionText,
    interval: int = 3600,
) -> None:
    """Раз в час отправляет напоминания о ближайших записях."""
    if not enabled:
        logger.warning("Reminders disabled")
        return

    while True:
        try:
            for item in await backend.reminders_due():
                session_id = int(item.get("id", 0) or 0)
                await notify(build_text(item))
                if session_id:
                    await backend.mark_reminder_sent(session_id)
        except Exception:
            logger.exception("Reminder loop failed")
        await asyncio.sleep(interval)


async def morning_summary_loop(
    backend: BackendClient,
    notify: Notify,
    *,
    enabled: bool,
    hour: int = 8,
    build_text: BuildSummaryText | None = None,
    interval: int = 1800,
) -> None:
    """Раз в сутки в заданный час отправляет сводку записей на сегодня."""
    if not enabled:
        logger.warning("Morning summary disabled")
        return

    last_sent: str | None = None
    while True:
        try:
            now = datetime.now()
            today = now.strftime("%Y-%m-%d")
            if now.hour == hour and last_sent != today:
                start, end = period_today()
                sessions = await backend.sessions(start=start, end=end, status="scheduled", limit=200)
                total = sum(float(item.get("amount") or 0) for item in sessions)
                if build_text is not None:
                    text = build_text(len(sessions), total)
                else:
                    text = f"Сводка на сегодня\n\nЗапланировано: {len(sessions)}\nСумма: {total:.0f} руб."
                await notify(text)
                last_sent = today
        except Exception:
            logger.exception("Morning summary loop failed")
        await asyncio.sleep(interval)
