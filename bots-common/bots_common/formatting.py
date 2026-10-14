"""Форматирование данных о записях, платежах и экспорт в .ics.

Все функции возвращают обычный текст без разметки: Telegram-бот добавляет
HTML поверх тех же данных самостоятельно.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

_STATUS_LABELS = {
    "scheduled": "запланирована",
    "completed": "проведена",
    "cancelled": "отменена",
    "pending": "ожидает оплаты",
    "succeeded": "оплачена",
    "canceled": "отменена",
    "expired": "истекла",
}


def status_label(status: str | None) -> str:
    """Человекочитаемая подпись статуса."""
    return _STATUS_LABELS.get(status or "", status or "неизвестно")


def parse_dt(session: dict[str, Any]) -> datetime | None:
    """Разбирает ``session_datetime`` в naive-datetime (или None)."""
    value = str(session.get("session_datetime") or "")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def period_today() -> tuple[str, str]:
    """Границы сегодняшнего дня (ISO-строки)."""
    start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    return start.isoformat(), (start + timedelta(days=1)).isoformat()


def period_tomorrow() -> tuple[str, str]:
    """Границы завтрашнего дня (ISO-строки)."""
    start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
    return start.isoformat(), (start + timedelta(days=1)).isoformat()


def period_week(anchor: datetime | None = None) -> tuple[str, str]:
    """Границы недели, содержащей ``anchor`` (по умолчанию — текущей)."""
    anchor = anchor or datetime.now()
    start = anchor - timedelta(days=anchor.weekday())
    start = start.replace(hour=0, minute=0, second=0, microsecond=0)
    return start.isoformat(), (start + timedelta(days=7)).isoformat()


def format_session_short(session: dict[str, Any]) -> str:
    """Краткая карточка записи для списков (обычный текст)."""
    dt = parse_dt(session)
    when = (
        dt.strftime("%d.%m.%Y %H:%M")
        if dt
        else f"{session.get('session_date', '?')} {session.get('session_time', '?')}"
    )
    lines = [
        f"Запись #{session.get('id')}",
        when,
        f"Клиент: {session.get('client_name') or '-'}",
        f"Услуга: {session.get('service_name') or '-'}",
        f"Телефон: {session.get('client_phone') or '-'}",
        f"Статус: {status_label(str(session.get('status') or ''))}",
    ]
    if session.get("comment"):
        lines.append(f"Комментарий: {session.get('comment')}")
    return "\n".join(lines)


def format_header(title: str, sessions: list[dict[str, Any]]) -> str:
    """Заголовок списка записей с количеством и суммой."""
    active = [item for item in sessions if item.get("status") != "cancelled"]
    total = sum(float(item.get("amount") or 0) for item in active)
    return f"{title}\n\nЗаписей: {len(sessions)}\nАктивных: {len(active)}\nСумма: {total:.0f} руб."


def split_messages(text: str, max_len: int = 3500) -> list[str]:
    """Дробит длинный текст на сообщения по пустым строкам."""
    chunks: list[str] = []
    current = ""
    for block in text.split("\n\n"):
        candidate = f"{current}\n\n{block}".strip() if current else block
        if len(candidate) > max_len and current:
            chunks.append(current)
            current = block
        else:
            current = candidate
    if current:
        chunks.append(current)
    return chunks


def payment_metadata(payment: dict[str, Any]) -> dict[str, Any]:
    """Извлекает metadata платежа (dict или JSON-строка)."""
    value = payment.get("metadata")
    if isinstance(value, dict):
        return value
    if not value:
        return {}
    try:
        parsed = json.loads(str(value))
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def format_booking_event(title: str, session: dict[str, Any], status: str | None = None) -> str:
    """Уведомление о событии записи."""
    return "\n".join(
        [
            title,
            "",
            f"Имя клиента: {session.get('client_name') or '-'}",
            f"Услуга: {session.get('service_name') or '-'}",
            f"Дата: {session.get('session_date') or '-'}",
            f"Время: {session.get('session_time') or '-'}",
            f"Статус записи: {status_label(status or str(session.get('status') or ''))}",
            f"ID записи: {session.get('id') or '-'}",
        ]
    )


def format_payment_event(title: str, payment: dict[str, Any], status: str | None = None) -> str:
    """Уведомление о событии платежа."""
    metadata = payment_metadata(payment)
    return "\n".join(
        [
            title,
            "",
            f"Имя клиента: {payment.get('customer_name') or metadata.get('customerName') or '-'}",
            f"Услуга: {payment.get('service_name') or metadata.get('serviceName') or payment.get('description') or '-'}",
            f"Дата: {metadata.get('sessionDate') or '-'}",
            f"Время: {metadata.get('sessionTime') or '-'}",
            f"Статус записи: {status_label(status or str(payment.get('status') or ''))}",
            f"Сумма: {payment.get('amount') or '-'} RUB",
            f"ID платежа: {payment.get('id') or '-'}",
        ]
    )


def generate_ics(sessions: list[dict[str, Any]], title: str) -> str:
    """Собирает календарь iCalendar (.ics) из записей."""
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Knyazkova Booking//Bot//RU",
        "CALSCALE:GREGORIAN",
        f"X-WR-CALNAME:{title}",
    ]
    for session in sessions:
        if session.get("status") == "cancelled":
            continue
        dt = parse_dt(session)
        if not dt:
            continue

        start = dt.strftime("%Y%m%dT%H%M%S")
        end = (dt + timedelta(hours=1)).strftime("%Y%m%dT%H%M%S")
        session_id = session.get("id")
        client = str(session.get("client_name") or "Клиент").replace("\n", " ")
        phone = str(session.get("client_phone") or "").replace("\n", " ")
        service = str(session.get("service_name") or "Консультация").replace("\n", " ")
        lines.extend(
            [
                "BEGIN:VEVENT",
                f"UID:knyazkova-{session_id}@booking",
                f"DTSTAMP:{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}",
                f"DTSTART:{start}",
                f"DTEND:{end}",
                f"SUMMARY:{service} - {client}",
                f"DESCRIPTION:Клиент: {client}\\nТелефон: {phone}\\nУслуга: {service}",
                "END:VEVENT",
            ]
        )
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines)
