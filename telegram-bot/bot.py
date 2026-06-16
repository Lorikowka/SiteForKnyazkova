"""
Telegram admin bot built with python-telegram-bot.

The bot talks only to the backend API and never opens SQLite directly.
"""

from __future__ import annotations

import asyncio
import html
import logging
from logging.handlers import RotatingFileHandler
import os
import urllib.parse
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import aiohttp
from telegram import (
    BotCommand,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardMarkup,
    Update,
)
from telegram.ext import (
    Application,
    ApplicationBuilder,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)
from telegram.request import HTTPXRequest


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
    
    logger = logging.getLogger("knyazkova_bot")
    logger.setLevel(logging.INFO)
    logger.addHandler(file_handler)
    logger.addHandler(console_handler)
    
    # Подавляем лишний шум от библиотек
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    
    return logger

LOGGER = setup_logging()


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


@dataclass(frozen=True)
class Settings:
    bot_token: str
    admin_id: int
    backend_url: str
    api_key: str
    telegram_proxy: str
    reminders_enabled: bool
    morning_summary_enabled: bool
    morning_summary_hour: int

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            bot_token=os.getenv("TELEGRAM_BOT_TOKEN", "").strip(),
            admin_id=int(os.getenv("TELEGRAM_ADMIN_ID", "0") or "0"),
            backend_url=os.getenv("BACKEND_URL", "http://localhost:1488").rstrip("/"),
            api_key=(os.getenv("BOT_API_KEY") or os.getenv("API_KEY", "")).strip(),
            telegram_proxy=os.getenv("TELEGRAM_PROXY", "").strip(),
            reminders_enabled=os.getenv("REMINDERS_ENABLED", "true").lower() == "true",
            morning_summary_enabled=os.getenv("MORNING_SUMMARY_ENABLED", "true").lower() == "true",
            morning_summary_hour=int(os.getenv("MORNING_SUMMARY_HOUR", "8") or "8"),
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
                    if response.status == 401:
                        LOGGER.warning("Check BOT_API_KEY/API_KEY in telegram-bot/.env and BOT_API_KEYS in backend/.env")
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


api = BackendClient(SETTINGS.backend_url, SETTINGS.api_key)


def is_admin(user_id: int | None) -> bool:
    return SETTINGS.admin_id <= 0 or bool(user_id and user_id == SETTINGS.admin_id)


async def guard(update: Update) -> bool:
    user = update.effective_user
    if is_admin(user.id if user else None):
        return True

    if update.message:
        await update.message.reply_text("Access denied.")
    elif update.callback_query:
        await update.callback_query.answer("Access denied.", show_alert=True)
    return False


def esc(value: Any) -> str:
    return html.escape(str(value or ""))


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


def main_keyboard() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        [
            [KeyboardButton("Сегодня"), KeyboardButton("Завтра")],
            [KeyboardButton("Эта неделя"), KeyboardButton("Все записи")],
            [KeyboardButton("Статистика"), KeyboardButton("Платежи")],
            [KeyboardButton("Экспорт календаря"), KeyboardButton("Обновить")],
        ],
        resize_keyboard=True,
    )


def session_keyboard(session_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton("Проведен", callback_data=f"session:complete:{session_id}"),
                InlineKeyboardButton("Отменить", callback_data=f"session:cancel:{session_id}"),
            ],
            [InlineKeyboardButton("Детали", callback_data=f"session:detail:{session_id}")],
        ]
    )


def export_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton("Эта неделя .ics", callback_data="export:week"),
                InlineKeyboardButton("Следующая .ics", callback_data="export:next_week"),
            ],
            [
                InlineKeyboardButton("Месяц .ics", callback_data="export:month"),
                InlineKeyboardButton("Все будущие .ics", callback_data="export:all"),
            ],
        ]
    )


def status_label(status: str) -> str:
    return {
        "scheduled": "запланирован",
        "completed": "проведен",
        "cancelled": "отменен",
        "pending": "ожидает",
        "succeeded": "оплачен",
        "canceled": "отменен",
        "expired": "истек",
    }.get(status, status or "неизвестно")


def format_session_short(session: dict[str, Any]) -> str:
    dt = parse_dt(session)
    when = dt.strftime("%d.%m.%Y %H:%M") if dt else f"{session.get('session_date', '?')} {session.get('session_time', '?')}"
    return (
        f"<b>{esc(when)}</b>\n"
        f"{esc(session.get('client_name'))}\n"
        f"{esc(session.get('service_name'))} | {esc(session.get('amount'))} руб.\n"
        f"Телефон: <code>{esc(session.get('client_phone'))}</code>\n"
        f"Статус: {esc(status_label(session.get('status', '')))}"
    )


def format_session_full(session: dict[str, Any]) -> str:
    lines = [
        f"<b>Сеанс #{esc(session.get('id'))}</b>",
        "",
        f"Клиент: <b>{esc(session.get('client_name'))}</b>",
        f"Телефон: <code>{esc(session.get('client_phone'))}</code>",
    ]
    if session.get("client_email"):
        lines.append(f"Email: <code>{esc(session.get('client_email'))}</code>")
    lines.extend(
        [
            "",
            f"Услуга: {esc(session.get('service_name'))}",
            f"Дата: {esc(session.get('session_date'))}",
            f"Время: {esc(session.get('session_time'))}",
            f"Сумма: {esc(session.get('amount'))} руб.",
            f"Статус: {esc(status_label(session.get('status', '')))}",
        ]
    )
    if session.get("comment"):
        lines.extend(["", f"Комментарий: {esc(session.get('comment'))}"])
    if session.get("payment_id"):
        lines.extend(["", f"Payment ID: <code>{esc(session.get('payment_id'))}</code>"])
    return "\n".join(lines)


def format_header(title: str, sessions: list[dict[str, Any]]) -> str:
    active = [item for item in sessions if item.get("status") != "cancelled"]
    total = sum(float(item.get("amount") or 0) for item in active)
    return f"<b>{esc(title)}</b>\n\nЗаписей: {len(sessions)}\nАктивных: {len(active)}\nСумма: {total:.0f} руб."


async def send_sessions(update: Update, title: str, sessions: list[dict[str, Any]], limit: int = 30) -> None:
    message = update.effective_message
    if not message:
        return

    if not sessions:
        await message.reply_text(f"<b>{esc(title)}</b>\n\nЗаписей нет.", reply_markup=main_keyboard(), parse_mode="HTML")
        return

    await message.reply_text(format_header(title, sessions), reply_markup=main_keyboard(), parse_mode="HTML")
    for item in sessions[:limit]:
        await message.reply_text(
            format_session_short(item),
            reply_markup=session_keyboard(int(item["id"])),
            parse_mode="HTML",
        )
    if len(sessions) > limit:
        await message.reply_text(f"Показано {limit} из {len(sessions)} записей.")


async def find_session(session_id: int) -> dict[str, Any] | None:
    future, past = await asyncio.gather(api.sessions(past=False, limit=500), api.sessions(past=True, limit=500))
    return next((item for item in future + past if int(item.get("id", 0)) == session_id), None)


def generate_ics(sessions: list[dict[str, Any]], title: str) -> str:
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Knyazkova Booking//Telegram Bot//RU",
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
        session_id = esc(session.get("id"))
        client = str(session.get("client_name") or "Клиент").replace("\n", " ")
        phone = str(session.get("client_phone") or "").replace("\n", " ")
        service = str(session.get("service_name") or "Консультация").replace("\n", " ")
        lines.extend(
            [
                "BEGIN:VEVENT",
                f"UID:knyazkova-{session_id}@booking",
                f"DTSTAMP:{datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')}",
                f"DTSTART:{start}",
                f"DTEND:{end}",
                f"SUMMARY:{service} - {client}",
                f"DESCRIPTION:Клиент: {client}\\nТелефон: {phone}\\nУслуга: {service}",
                "END:VEVENT",
            ]
        )
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await guard(update):
        return
    health = await api.health()
    status = "ok" if health else "unavailable"
    await update.effective_message.reply_text(
            f"<b>Админ-панель записи</b>\n\nBackend: {status}\nВыберите действие.\n\n"
            f"<i>Управление расписанием:</i>\n"
            f"<code>/block YYYY-MM-DD</code> — закрыть дату\n"
            f"<code>/unblock YYYY-MM-DD</code> — открыть дату\n"
            f"Например: <code>/block 2026-06-15 Отпуск</code>",
        reply_markup=main_keyboard(),
        parse_mode="HTML",
    )

async def block_date(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await guard(update):
        return
    text_parts = (update.effective_message.text or "").split(maxsplit=2)
    if len(text_parts) < 2:
        await update.effective_message.reply_text("Использование: /block YYYY-MM-DD [причина]")
        return
    
    date_str = text_parts[1]
    reason = text_parts[2] if len(text_parts) > 2 else ""
    
    data = await api.request("POST", "/api/admin/schedule/block", json={"date": date_str, "reason": reason})
    if data and data.get("success"):
        await update.effective_message.reply_text(f"✅ Дата {date_str} успешно закрыта для записи.")
    else:
        await update.effective_message.reply_text(f"❌ Ошибка. Убедитесь, что формат даты YYYY-MM-DD.")

async def unblock_date(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await guard(update):
        return
    text_parts = (update.effective_message.text or "").split(maxsplit=1)
    if len(text_parts) < 2:
        await update.effective_message.reply_text("Использование: /unblock YYYY-MM-DD")
        return
    
    date_str = text_parts[1]
    data = await api.request("DELETE", f"/api/admin/schedule/block/{date_str}")
    if data and data.get("success"):
        await update.effective_message.reply_text(f"✅ Дата {date_str} снова открыта для записи.")
    else:
        await update.effective_message.reply_text(f"❌ Ошибка открытия даты.")

async def text_router(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await guard(update):
        return
    text = update.effective_message.text or ""
    LOGGER.info("Incoming message from %s: %s", update.effective_user.id if update.effective_user else "unknown", text)

    if text == "Сегодня":
        start_at, end_at = period_today()
        return await send_sessions(update, "Записи на сегодня", await api.sessions(start=start_at, end=end_at, limit=200))
    if text == "Завтра":
        start_at, end_at = period_tomorrow()
        return await send_sessions(update, "Записи на завтра", await api.sessions(start=start_at, end=end_at, limit=200))
    if text == "Эта неделя":
        start_at, end_at = period_week()
        return await send_sessions(update, "Записи на эту неделю", await api.sessions(start=start_at, end=end_at, limit=300))
    if text == "Все записи":
        return await send_sessions(update, "Будущие записи", await api.sessions(past=False, limit=200))
    if text == "Платежи":
        return await payments(update, context)
    if text == "Статистика":
        return await stats(update, context)
    if text == "Экспорт календаря":
        return await update.effective_message.reply_text("Выберите период.", reply_markup=export_keyboard())
    if text == "Обновить":
        return await start(update, context)

    await update.effective_message.reply_text("Сообщение получено. Нажмите /start.", reply_markup=main_keyboard())


async def payments(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await guard(update):
        return
    items = await api.payments(limit=20)
    if not items:
        await update.effective_message.reply_text("Платежей нет.", reply_markup=main_keyboard())
        return
    lines = ["<b>Последние платежи</b>"]
    for payment in items[:15]:
        lines.extend(
            [
                "",
                f"<b>{esc(payment.get('amount'))} {esc(payment.get('currency', 'RUB'))}</b>",
                f"{esc(payment.get('service_name') or payment.get('description'))}",
                f"Клиент: {esc(payment.get('customer_name') or 'не указан')}",
                f"Статус: {esc(status_label(payment.get('status', '')))}",
                f"ID: <code>{esc(payment.get('id'))}</code>",
            ]
        )
    await update.effective_message.reply_text("\n".join(lines), reply_markup=main_keyboard(), parse_mode="HTML")


async def stats(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await guard(update):
        return
    future, past = await asyncio.gather(api.sessions(past=False, limit=500), api.sessions(past=True, limit=500))
    sessions = future + past
    scheduled = sum(1 for item in sessions if item.get("status") == "scheduled")
    completed = sum(1 for item in sessions if item.get("status") == "completed")
    cancelled = sum(1 for item in sessions if item.get("status") == "cancelled")
    earned = sum(float(item.get("amount") or 0) for item in sessions if item.get("status") == "completed")
    await update.effective_message.reply_text(
        "<b>Статистика</b>\n\n"
        f"Всего записей: {len(sessions)}\n"
        f"Запланировано: {scheduled}\n"
        f"Проведено: {completed}\n"
        f"Отменено: {cancelled}\n"
        f"Доход по проведенным: {earned:.0f} руб.",
        reply_markup=main_keyboard(),
        parse_mode="HTML",
    )


async def callbacks(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not await guard(update):
        return
    query = update.callback_query
    if not query or not query.data:
        return
    await query.answer()

    if query.data.startswith("session:"):
        _, action, raw_id = query.data.split(":", 2)
        session_id = int(raw_id)
        if action == "complete":
            ok = await api.update_session_status(session_id, "completed")
            await query.edit_message_reply_markup(reply_markup=None) if ok else None
            await query.message.reply_text("Статус обновлен." if ok else "Не удалось обновить статус.")
        elif action == "cancel":
            ok = await api.delete_session(session_id)
            await query.edit_message_reply_markup(reply_markup=None) if ok else None
            await query.message.reply_text("Запись отменена." if ok else "Не удалось отменить запись.")
        elif action == "detail":
            session = await find_session(session_id)
            if session:
                await query.message.reply_text(format_session_full(session), reply_markup=session_keyboard(session_id), parse_mode="HTML")
            else:
                await query.message.reply_text("Сеанс не найден.")
        return

    if query.data.startswith("export:"):
        export_type = query.data.split(":", 1)[1]
        now = datetime.now()
        if export_type == "week":
            start_at, end_at = period_week(now)
            title, filename = "Записи на эту неделю", "knyazkova_week.ics"
            sessions = await api.sessions(start=start_at, end=end_at, limit=500)
        elif export_type == "next_week":
            start_at, end_at = period_week(now + timedelta(days=7))
            title, filename = "Записи на следующую неделю", "knyazkova_next_week.ics"
            sessions = await api.sessions(start=start_at, end=end_at, limit=500)
        elif export_type == "month":
            start_dt = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            next_month = (start_dt.replace(day=28) + timedelta(days=4)).replace(day=1)
            title, filename = "Записи на месяц", "knyazkova_month.ics"
            sessions = await api.sessions(start=start_dt.isoformat(), end=next_month.isoformat(), limit=500)
        else:
            title, filename = "Все будущие записи", "knyazkova_all.ics"
            sessions = await api.sessions(past=False, limit=500)

        if not sessions:
            await query.message.reply_text("Записей для экспорта нет.")
            return
        await query.message.reply_document(
            document=generate_ics(sessions, title).encode("utf-8"),
            filename=filename,
            caption=f"{title}\nЗаписей: {len(sessions)}",
        )


async def reminders_loop(application: Application) -> None:
    if not SETTINGS.reminders_enabled or SETTINGS.admin_id <= 0:
        LOGGER.warning("Reminders disabled or TELEGRAM_ADMIN_ID is 0")
        return
    while True:
        try:
            for item in await api.reminders_due():
                session_id = int(item.get("id", 0))
                await application.bot.send_message(
                    SETTINGS.admin_id,
                    "<b>Напоминание о сеансе</b>\n\n" + format_session_full(item),
                    parse_mode="HTML",
                )
                if session_id:
                    await api.mark_reminder_sent(session_id)
        except Exception:
            LOGGER.exception("Reminder loop failed")
        await asyncio.sleep(3600)


async def morning_summary_loop(application: Application) -> None:
    if not SETTINGS.morning_summary_enabled or SETTINGS.admin_id <= 0:
        LOGGER.warning("Morning summary disabled or TELEGRAM_ADMIN_ID is 0")
        return
    last_sent = None
    while True:
        try:
            now = datetime.now()
            today = now.strftime("%Y-%m-%d")
            if now.hour == SETTINGS.morning_summary_hour and last_sent != today:
                start_at, end_at = period_today()
                sessions = await api.sessions(start=start_at, end=end_at, status="scheduled", limit=200)
                total = sum(float(item.get("amount") or 0) for item in sessions)
                await application.bot.send_message(
                    SETTINGS.admin_id,
                    f"<b>Сводка на сегодня</b>\n\nЗапланировано: {len(sessions)}\nСумма: {total:.0f} руб.",
                    parse_mode="HTML",
                )
                last_sent = today
        except Exception:
            LOGGER.exception("Morning summary loop failed")
        await asyncio.sleep(1800)


async def post_init(application: Application) -> None:
    health = await api.health()
    LOGGER.info("Backend: %s", "ok" if health else "unavailable")
    protected = await api.can_access_protected_api() if SETTINGS.api_key else False
    LOGGER.info("Protected backend API: %s", "ok" if protected else "unavailable")
    if SETTINGS.telegram_proxy:
        LOGGER.info("Telegram proxy: configured")
    else:
        LOGGER.warning("Telegram proxy is not configured; direct api.telegram.org connection will be used")

    me = await application.bot.get_me()
    LOGGER.info("Telegram bot: @%s (%s)", me.username, me.id)
    await application.bot.delete_webhook(drop_pending_updates=False)
    await application.bot.set_my_commands([BotCommand("start", "Open menu"), BotCommand("menu", "Open menu")])
    application.create_task(reminders_loop(application))
    application.create_task(morning_summary_loop(application))


async def post_shutdown(application: Application) -> None:
    await api.close()


def build_application() -> Application:
    if not SETTINGS.bot_token:
        raise RuntimeError("TELEGRAM_BOT_TOKEN is not configured")

    builder = ApplicationBuilder().token(SETTINGS.bot_token).post_init(post_init).post_shutdown(post_shutdown)
    if SETTINGS.telegram_proxy:
        request = HTTPXRequest(proxy_url=SETTINGS.telegram_proxy, connect_timeout=30, read_timeout=30)
        builder = builder.request(request).get_updates_request(request)

    app = builder.build()
    app.add_handler(CommandHandler(["start", "menu"], start))
    app.add_handler(CommandHandler("block", block_date))
    app.add_handler(CommandHandler("unblock", unblock_date))
    app.add_handler(CallbackQueryHandler(callbacks))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_router))
    return app


def main() -> None:
    if SETTINGS.admin_id <= 0:
        LOGGER.warning("TELEGRAM_ADMIN_ID is 0; bot access is open to every Telegram user")
    app = build_application()
    app.run_polling(drop_pending_updates=False, allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
