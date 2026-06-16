"""
VK admin bot for bookings.

The bot talks only to the backend API and never opens SQLite directly.
"""

from __future__ import annotations

import asyncio
import json
import logging
from logging.handlers import RotatingFileHandler
import os
import random
import urllib.parse
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import aiohttp


BASE_DIR = Path(__file__).resolve().parent

# ——————————————————————————————
# ЛОГИРОВАНИЕ С РОТАЦИЕЙ
# ——————————————————————————————
def setup_logging():
    log_dir = BASE_DIR / "logs"
    log_dir.mkdir(exist_ok=True)
    log_file = log_dir / "bot.log"

    formatter = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    
    # Ротация: 5 файлов по 5 МБ
    file_handler = RotatingFileHandler(log_file, maxBytes=5*1024*1024, backupCount=5, encoding="utf-8")
    file_handler.setFormatter(formatter)
    
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    
    logger = logging.getLogger("knyazkova_vk_bot")
    logger.setLevel(logging.INFO)
    logger.addHandler(file_handler)
    logger.addHandler(console_handler)
    
    return logger

LOGGER = setup_logging()
VK_API = "https://api.vk.com/method"
VK_API_VERSION = "5.199"


def load_env_file(path: Path) -> None:
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env_file(BASE_DIR / ".env")


def parse_int_list(value: str) -> set[int]:
    result: set[int] = set()
    for raw_item in value.split(","):
        item = raw_item.strip()
        if not item:
            continue
        try:
            result.add(int(item))
        except ValueError:
            LOGGER.warning("Invalid integer in list: %s", item)
    return result


@dataclass(frozen=True)
class Settings:
    vk_token: str
    vk_group_id: int
    admin_ids: set[int]
    backend_url: str
    api_key: str
    reminders_enabled: bool
    morning_summary_enabled: bool
    morning_summary_hour: int
    event_watcher_enabled: bool
    event_poll_interval_seconds: int

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            vk_token=os.getenv("VK_BOT_TOKEN", "").strip(),
            vk_group_id=int(os.getenv("VK_GROUP_ID", "0") or "0"),
            admin_ids=parse_int_list(os.getenv("VK_ADMIN_IDS", "")),
            backend_url=os.getenv("BACKEND_URL", "http://localhost:1488").rstrip("/"),
            api_key=(os.getenv("BOT_API_KEY") or os.getenv("API_KEY", "")).strip(),
            reminders_enabled=os.getenv("REMINDERS_ENABLED", "true").lower() == "true",
            morning_summary_enabled=os.getenv("MORNING_SUMMARY_ENABLED", "true").lower() == "true",
            morning_summary_hour=int(os.getenv("MORNING_SUMMARY_HOUR", "8") or "8"),
            event_watcher_enabled=os.getenv("EVENT_WATCHER_ENABLED", "true").lower() == "true",
            event_poll_interval_seconds=max(10, int(os.getenv("EVENT_POLL_INTERVAL_SECONDS", "30") or "30")),
        )


SETTINGS = Settings.from_env()


class BackendClient:
    def __init__(self, base_url: str, api_key: str) -> None:
        self.base_url = base_url
        self.api_key = api_key
        self.session: aiohttp.ClientSession | None = None

    async def open(self) -> None:
        if self.session is None or self.session.closed:
            self.session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15))

    async def close(self) -> None:
        if self.session and not self.session.closed:
            await self.session.close()

    async def request(self, method: str, endpoint: str, **kwargs: Any) -> dict[str, Any] | None:
        await self.open()
        assert self.session is not None

        headers = kwargs.pop("headers", {})
        if self.api_key:
            headers["X-Bot-API-Key"] = self.api_key
            headers["X-API-Key"] = self.api_key

        try:
            async with self.session.request(
                method,
                f"{self.base_url}{endpoint}",
                headers=headers,
                **kwargs,
            ) as response:
                text = await response.text()
                if response.status >= 400:
                    LOGGER.warning("Backend %s %s failed: %s %s", method, endpoint, response.status, text)
                    return None
                if not text:
                    return {}
                try:
                    return await response.json()
                except aiohttp.ContentTypeError:
                    LOGGER.warning("Backend returned non-JSON response: %s", text)
                    return None
        except (aiohttp.ClientError, asyncio.TimeoutError) as error:
            LOGGER.warning("Backend request error: %s %s: %s", method, endpoint, error)
            return None

    async def health(self) -> dict[str, Any] | None:
        return await self.request("GET", "/api/health")

    async def can_access_protected_api(self) -> bool:
        data = await self.request("GET", "/api/sessions?limit=1")
        return bool(data and data.get("success"))

    async def sessions(
        self,
        *,
        past: bool = False,
        limit: int = 100,
        start: str | None = None,
        end: str | None = None,
        status: str | None = None,
    ) -> list[dict[str, Any]]:
        params = {"past": str(past).lower(), "limit": str(limit)}
        if start:
            params["from"] = start
        if end:
            params["to"] = end
        if status:
            params["status"] = status

        data = await self.request("GET", f"/api/sessions?{urllib.parse.urlencode(params)}")
        return data.get("sessions", []) if data and data.get("success") else []

    async def payments(self, *, limit: int = 20) -> list[dict[str, Any]]:
        data = await self.request("GET", f"/api/payments?limit={limit}")
        return data.get("payments", []) if data and data.get("success") else []

    async def delete_session(self, session_id: int) -> bool:
        data = await self.request("DELETE", f"/api/sessions/{session_id}")
        return bool(data and data.get("success"))

    async def update_session_status(self, session_id: int, status: str) -> bool:
        data = await self.request("PATCH", f"/api/sessions/{session_id}/status", json={"status": status})
        return bool(data and data.get("success"))

    async def reminders_due(self) -> list[dict[str, Any]]:
        data = await self.request("GET", "/api/reminders/due")
        return data.get("sessions", []) if data and data.get("success") else []

    async def mark_reminder_sent(self, session_id: int) -> bool:
        data = await self.request("POST", f"/api/reminders/{session_id}/mark-sent")
        return bool(data and data.get("success"))


class VkClient:
    def __init__(self, token: str, group_id: int) -> None:
        self.token = token
        self.group_id = group_id
        self.session: aiohttp.ClientSession | None = None
        self.server: str | None = None
        self.key: str | None = None
        self.ts: str | None = None

    async def open(self) -> None:
        if self.session is None or self.session.closed:
            self.session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=35))

    async def close(self) -> None:
        if self.session and not self.session.closed:
            await self.session.close()

    async def api(self, method: str, **params: Any) -> dict[str, Any]:
        await self.open()
        assert self.session is not None

        payload = {
            "access_token": self.token,
            "v": VK_API_VERSION,
            **{key: value for key, value in params.items() if value is not None},
        }
        async with self.session.post(f"{VK_API}/{method}", data=payload) as response:
            data = await response.json(content_type=None)

        if "error" in data:
            error = data["error"]
            raise RuntimeError(f"VK {method}: {error.get('error_msg', error)}")
        return data.get("response", {})

    async def refresh_long_poll(self) -> None:
        response = await self.api("groups.getLongPollServer", group_id=self.group_id)
        self.server = response["server"]
        self.key = response["key"]
        self.ts = response["ts"]
        LOGGER.info("VK Long Poll server refreshed")

    async def poll(self) -> list[dict[str, Any]]:
        await self.open()
        assert self.session is not None
        if not self.server or not self.key or not self.ts:
            await self.refresh_long_poll()

        assert self.server and self.key and self.ts
        params = {"act": "a_check", "key": self.key, "ts": self.ts, "wait": "25"}
        async with self.session.get(self.server, params=params) as response:
            data = await response.json(content_type=None)

        if data.get("failed"):
            LOGGER.warning("VK Long Poll failed: %s", data)
            await self.refresh_long_poll()
            return []

        self.ts = data.get("ts", self.ts)
        return data.get("updates", [])

    async def send_message(self, peer_id: int, message: str, keyboard: dict[str, Any] | None = None) -> None:
        await self.api(
            "messages.send",
            peer_id=peer_id,
            random_id=random.randint(1, 2_147_483_647),
            message=message[:4000],
            keyboard=json.dumps(keyboard, ensure_ascii=False) if keyboard else None,
        )


api = BackendClient(SETTINGS.backend_url, SETTINGS.api_key)
vk = VkClient(SETTINGS.vk_token, SETTINGS.vk_group_id)
STATE_PATH = BASE_DIR / "data" / "state.json"


class EventState:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.sessions: dict[str, dict[str, Any]] = {}
        self.payments: dict[str, dict[str, Any]] = {}
        self.initialized = False

    def load(self) -> None:
        if not self.path.exists():
            return
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            LOGGER.warning("Failed to load state: %s", error)
            return
        self.sessions = data.get("sessions", {}) if isinstance(data.get("sessions"), dict) else {}
        self.payments = data.get("payments", {}) if isinstance(data.get("payments"), dict) else {}
        self.initialized = bool(data.get("initialized"))

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "initialized": self.initialized,
            "sessions": self.sessions,
            "payments": self.payments,
        }
        self.path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


event_state = EventState(STATE_PATH)


def is_admin(user_id: int) -> bool:
    return not SETTINGS.admin_ids or user_id in SETTINGS.admin_ids


def main_keyboard() -> dict[str, Any]:
    return {
        "one_time": False,
        "buttons": [
            [
                {"action": {"type": "text", "label": "Сегодня"}, "color": "primary"},
                {"action": {"type": "text", "label": "Завтра"}, "color": "primary"},
            ],
            [
                {"action": {"type": "text", "label": "Неделя"}, "color": "secondary"},
                {"action": {"type": "text", "label": "Все записи"}, "color": "secondary"},
            ],
            [
                {"action": {"type": "text", "label": "Платежи"}, "color": "secondary"},
                {"action": {"type": "text", "label": "Статистика"}, "color": "secondary"},
            ],
        ],
    }


def parse_dt(session: dict[str, Any]) -> datetime | None:
    value = str(session.get("session_datetime") or "")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def period_today() -> tuple[str, str]:
    start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    return start.isoformat(), (start + timedelta(days=1)).isoformat()


def period_tomorrow() -> tuple[str, str]:
    start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
    return start.isoformat(), (start + timedelta(days=1)).isoformat()


def period_week(anchor: datetime | None = None) -> tuple[str, str]:
    anchor = anchor or datetime.now()
    start = anchor - timedelta(days=anchor.weekday())
    start = start.replace(hour=0, minute=0, second=0, microsecond=0)
    return start.isoformat(), (start + timedelta(days=7)).isoformat()


def status_label(status: str) -> str:
    return {
        "scheduled": "запланирована",
        "completed": "проведена",
        "cancelled": "отменена",
        "pending": "ожидает оплаты",
        "succeeded": "оплачена",
        "canceled": "отменена",
        "expired": "истекла",
    }.get(status, status or "неизвестно")


def format_session_short(session: dict[str, Any]) -> str:
    dt = parse_dt(session)
    when = dt.strftime("%d.%m.%Y %H:%M") if dt else f"{session.get('session_date', '?')} {session.get('session_time', '?')}"
    lines = [
        f"Запись #{session.get('id')}",
        f"{when}",
        f"Клиент: {session.get('client_name') or '-'}",
        f"Услуга: {session.get('service_name') or '-'}",
        f"Телефон: {session.get('client_phone') or '-'}",
        f"Статус: {status_label(str(session.get('status') or ''))}",
    ]
    if session.get("comment"):
        lines.append(f"Комментарий: {session.get('comment')}")
    return "\n".join(lines)


def format_booking_event(title: str, session: dict[str, Any], status: str | None = None) -> str:
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


def payment_metadata(payment: dict[str, Any]) -> dict[str, Any]:
    value = payment.get("metadata")
    if isinstance(value, dict):
        return value
    if not value:
        return {}
    try:
        parsed = json.loads(str(value))
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


def format_payment_event(title: str, payment: dict[str, Any], status: str | None = None) -> str:
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


def format_header(title: str, sessions: list[dict[str, Any]]) -> str:
    active = [item for item in sessions if item.get("status") != "cancelled"]
    total = sum(float(item.get("amount") or 0) for item in active)
    return f"{title}\n\nЗаписей: {len(sessions)}\nАктивных: {len(active)}\nСумма: {total:.0f} руб."


def split_messages(text: str, max_len: int = 3500) -> list[str]:
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


async def send_sessions(peer_id: int, title: str, sessions: list[dict[str, Any]], limit: int = 25) -> None:
    if not sessions:
        await vk.send_message(peer_id, f"{title}\n\nЗаписей нет.", main_keyboard())
        return

    blocks = [format_header(title, sessions)]
    blocks.extend(format_session_short(item) for item in sessions[:limit])
    if len(sessions) > limit:
        blocks.append(f"Показано {limit} из {len(sessions)} записей.")

    for chunk in split_messages("\n\n".join(blocks)):
        await vk.send_message(peer_id, chunk, main_keyboard())


async def send_payments(peer_id: int) -> None:
    payments = await api.payments(limit=20)
    if not payments:
        await vk.send_message(peer_id, "Платежей нет.", main_keyboard())
        return

    blocks = ["Последние платежи"]
    for payment in payments[:15]:
        blocks.append(
            "\n".join(
                [
                    f"{payment.get('amount')} {payment.get('currency', 'RUB')}",
                    f"Услуга: {payment.get('service_name') or payment.get('description') or '-'}",
                    f"Клиент: {payment.get('customer_name') or '-'}",
                    f"Статус: {status_label(str(payment.get('status') or ''))}",
                    f"ID: {payment.get('id')}",
                ]
            )
        )
    await vk.send_message(peer_id, "\n\n".join(blocks), main_keyboard())


async def send_stats(peer_id: int) -> None:
    future, past = await asyncio.gather(api.sessions(past=False, limit=500), api.sessions(past=True, limit=500))
    sessions = future + past
    scheduled = sum(1 for item in sessions if item.get("status") == "scheduled")
    completed = sum(1 for item in sessions if item.get("status") == "completed")
    cancelled = sum(1 for item in sessions if item.get("status") == "cancelled")
    earned = sum(float(item.get("amount") or 0) for item in sessions if item.get("status") == "completed")

    await vk.send_message(
        peer_id,
        "\n".join(
            [
                "Статистика",
                "",
                f"Всего записей: {len(sessions)}",
                f"Запланировано: {scheduled}",
                f"Проведено: {completed}",
                f"Отменено: {cancelled}",
                f"Доход по проведенным: {earned:.0f} руб.",
            ]
        ),
        main_keyboard(),
    )


async def handle_command(peer_id: int, user_id: int, text: str) -> None:
    if not is_admin(user_id):
        await vk.send_message(peer_id, "Доступ запрещен.")
        return

    normalized = text.strip()
    lower = normalized.lower()

    if lower in {"/start", "/menu", "меню", "обновить"}:
        health = await api.health()
        protected = await api.can_access_protected_api() if SETTINGS.api_key else False
        await vk.send_message(
            peer_id,
            "Админ-панель записей\n\n"
            f"Backend: {'ok' if health else 'unavailable'}\n"
            f"Защищенный API: {'ok' if protected else 'unavailable'}\n\n"
            "Команды: /today, /tomorrow, /week, /sessions, /payments, /stats, /complete ID, /cancel ID",
            main_keyboard(),
        )
        return

    if lower in {"/today", "сегодня"}:
        start, end = period_today()
        return await send_sessions(peer_id, "Записи на сегодня", await api.sessions(start=start, end=end, limit=200))

    if lower in {"/tomorrow", "завтра"}:
        start, end = period_tomorrow()
        return await send_sessions(peer_id, "Записи на завтра", await api.sessions(start=start, end=end, limit=200))

    if lower in {"/week", "неделя", "эта неделя"}:
        start, end = period_week()
        return await send_sessions(peer_id, "Записи на эту неделю", await api.sessions(start=start, end=end, limit=300))

    if lower in {"/sessions", "все записи"}:
        return await send_sessions(peer_id, "Будущие записи", await api.sessions(past=False, limit=200))

    if lower in {"/payments", "платежи"}:
        return await send_payments(peer_id)

    if lower in {"/stats", "статистика"}:
        return await send_stats(peer_id)

    if lower.startswith("/complete "):
        session_id = int(lower.split(maxsplit=1)[1])
        ok = await api.update_session_status(session_id, "completed")
        await vk.send_message(peer_id, "Статус обновлен." if ok else "Не удалось обновить статус.", main_keyboard())
        return

    if lower.startswith("/cancel "):
        session_id = int(lower.split(maxsplit=1)[1])
        ok = await api.delete_session(session_id)
        await vk.send_message(peer_id, "Запись отменена." if ok else "Не удалось отменить запись.", main_keyboard())
        return

    if lower in {"/help", "помощь"}:
        await vk.send_message(
            peer_id,
            "Команды:\n"
            "/today - сегодня\n"
            "/tomorrow - завтра\n"
            "/week - неделя\n"
            "/sessions - все будущие\n"
            "/payments - платежи\n"
            "/stats - статистика\n"
            "/complete ID - отметить проведенной\n"
            "/cancel ID - отменить запись",
            main_keyboard(),
        )
        return

    await vk.send_message(peer_id, "Не понял команду. Нажмите /menu или /help.", main_keyboard())


async def reminders_loop() -> None:
    if not SETTINGS.reminders_enabled or not SETTINGS.admin_ids:
        LOGGER.warning("Reminders disabled or VK_ADMIN_IDS is empty")
        return

    while True:
        try:
            for item in await api.reminders_due():
                session_id = int(item.get("id", 0) or 0)
                text = "Напоминание о записи\n\n" + format_session_short(item)
                for admin_id in SETTINGS.admin_ids:
                    await vk.send_message(admin_id, text, main_keyboard())
                if session_id:
                    await api.mark_reminder_sent(session_id)
        except Exception:
            LOGGER.exception("Reminder loop failed")
        await asyncio.sleep(3600)


async def morning_summary_loop() -> None:
    if not SETTINGS.morning_summary_enabled or not SETTINGS.admin_ids:
        LOGGER.warning("Morning summary disabled or VK_ADMIN_IDS is empty")
        return

    last_sent: str | None = None
    while True:
        try:
            now = datetime.now()
            today = now.strftime("%Y-%m-%d")
            if now.hour == SETTINGS.morning_summary_hour and last_sent != today:
                start, end = period_today()
                sessions = await api.sessions(start=start, end=end, status="scheduled", limit=200)
                total = sum(float(item.get("amount") or 0) for item in sessions)
                text = f"Сводка на сегодня\n\nЗапланировано: {len(sessions)}\nСумма: {total:.0f} руб."
                for admin_id in SETTINGS.admin_ids:
                    await vk.send_message(admin_id, text, main_keyboard())
                last_sent = today
        except Exception:
            LOGGER.exception("Morning summary loop failed")
        await asyncio.sleep(1800)


async def notify_admins(message: str) -> None:
    if not SETTINGS.admin_ids:
        LOGGER.info("Skip admin notification because VK_ADMIN_IDS is empty")
        return
    for admin_id in SETTINGS.admin_ids:
        await vk.send_message(admin_id, message, main_keyboard())


async def event_watcher_loop() -> None:
    if not SETTINGS.event_watcher_enabled:
        LOGGER.warning("Event watcher disabled")
        return

    event_state.load()
    while True:
        try:
            future_sessions, past_sessions, payments = await asyncio.gather(
                api.sessions(past=False, limit=500),
                api.sessions(past=True, limit=500),
                api.payments(limit=100),
            )

            current_sessions = {str(item.get("id")): item for item in future_sessions + past_sessions if item.get("id")}
            current_payments = {str(item.get("id")): item for item in payments if item.get("id")}

            if event_state.initialized:
                for session_id, session in current_sessions.items():
                    previous = event_state.sessions.get(session_id)
                    if not previous:
                        await notify_admins(format_booking_event("Новая запись", session, str(session.get("status") or "scheduled")))
                        continue

                    old_status = str(previous.get("status") or "")
                    new_status = str(session.get("status") or "")
                    if old_status != new_status:
                        title = "Запись отменена" if new_status == "cancelled" else "Статус записи изменен"
                        await notify_admins(format_booking_event(title, session, new_status))

                for payment_id, payment in current_payments.items():
                    previous = event_state.payments.get(payment_id)
                    new_status = str(payment.get("status") or "")
                    if not previous and new_status in {"succeeded", "canceled", "expired"}:
                        title = "Оплата получена" if new_status == "succeeded" else "Оплата отменена"
                        await notify_admins(format_payment_event(title, payment, new_status))
                        continue

                    old_status = str(previous.get("status") or "") if previous else ""
                    if previous and old_status != new_status and new_status in {"succeeded", "canceled", "expired"}:
                        title = "Оплата получена" if new_status == "succeeded" else "Оплата отменена"
                        await notify_admins(format_payment_event(title, payment, new_status))

            event_state.sessions = {
                key: {
                    "status": value.get("status"),
                    "session_datetime": value.get("session_datetime"),
                }
                for key, value in current_sessions.items()
            }
            event_state.payments = {
                key: {
                    "status": value.get("status"),
                    "paid_at": value.get("paid_at"),
                }
                for key, value in current_payments.items()
            }
            event_state.initialized = True
            event_state.save()
        except Exception:
            LOGGER.exception("Event watcher failed")

        await asyncio.sleep(SETTINGS.event_poll_interval_seconds)


async def handle_update(update: dict[str, Any]) -> None:
    if update.get("type") != "message_new":
        return

    message = update.get("object", {}).get("message", {})
    if message.get("out"):
        return

    peer_id = int(message.get("peer_id", 0) or 0)
    user_id = int(message.get("from_id", 0) or 0)
    text = str(message.get("text") or "").strip()
    if not peer_id or not user_id or not text:
        return

    LOGGER.info("Incoming VK message from %s: %s", user_id, text)
    try:
        await handle_command(peer_id, user_id, text)
    except ValueError:
        await vk.send_message(peer_id, "Нужен числовой ID записи. Например: /complete 12", main_keyboard())
    except Exception:
        LOGGER.exception("Failed to handle VK message")
        await vk.send_message(peer_id, "Произошла ошибка. Проверьте логи бота.", main_keyboard())


async def run_bot() -> None:
    if not SETTINGS.vk_token:
        raise RuntimeError("VK_BOT_TOKEN is not configured")
    if SETTINGS.vk_group_id <= 0:
        raise RuntimeError("VK_GROUP_ID is not configured")
    if not SETTINGS.admin_ids:
        LOGGER.warning("VK_ADMIN_IDS is empty; bot access is open to every VK user")

    health = await api.health()
    protected = await api.can_access_protected_api() if SETTINGS.api_key else False
    LOGGER.info("Backend: %s", "ok" if health else "unavailable")
    LOGGER.info("Protected backend API: %s", "ok" if protected else "unavailable")

    await vk.refresh_long_poll()
    asyncio.create_task(reminders_loop())
    asyncio.create_task(morning_summary_loop())
    asyncio.create_task(event_watcher_loop())

    while True:
        try:
            for update in await vk.poll():
                await handle_update(update)
        except Exception:
            LOGGER.exception("VK polling failed")
            await asyncio.sleep(5)


async def main_async() -> None:
    try:
        await run_bot()
    finally:
        await api.close()
        await vk.close()


def main() -> None:
    try:
        asyncio.run(main_async())
    except KeyboardInterrupt:
        LOGGER.info("VK bot stopped")


if __name__ == "__main__":
    main()
