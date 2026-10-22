"""Telegram admin bot for bookings (aiogram 3).

Бот общается только с backend API и никогда не открывает SQLite напрямую.
Общая логика (клиент backend, форматирование, напоминания, экспорт .ics)
вынесена в пакет ``bots_common``.
"""

from __future__ import annotations

import asyncio
import html
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent
_SHARED_DIR = BASE_DIR.parent / "bots-common"
if _SHARED_DIR.is_dir():
    sys.path.insert(0, str(_SHARED_DIR))

from aiogram import Bot, Dispatcher, F, Router  # noqa: E402
from aiogram.client.default import DefaultBotProperties  # noqa: E402
from aiogram.client.session.aiohttp import AiohttpSession  # noqa: E402
from aiogram.enums import ParseMode  # noqa: E402
from aiogram.filters import Command, CommandStart  # noqa: E402
from aiogram.types import (  # noqa: E402
    BufferedInputFile,
    BotCommand,
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    Message,
    ReplyKeyboardMarkup,
)

from bots_common.backend import BackendClient  # noqa: E402
from bots_common.env import load_env_files  # noqa: E402
from bots_common.formatting import (  # noqa: E402
    generate_ics,
    parse_dt,
    period_today,
    period_tomorrow,
    period_week,
    status_label,
)
from bots_common.logging_setup import setup_logging  # noqa: E402
from bots_common.loops import morning_summary_loop, reminders_loop  # noqa: E402
from bots_common.settings import env_bool, env_int, env_str  # noqa: E402

# Локальный .env бота имеет приоритет над корневым.
load_env_files(BASE_DIR / ".env", BASE_DIR.parent / ".env")

LOGGER = setup_logging("knyazkova_telegram_bot", BASE_DIR / "logs")


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
        admin_raw = env_str("TELEGRAM_ADMIN_ID") or env_str("TELEGRAM_CHAT_ID")
        admin_id = int(admin_raw) if admin_raw.lstrip("-").isdigit() else 0
        return cls(
            bot_token=env_str("TELEGRAM_BOT_TOKEN"),
            admin_id=admin_id,
            backend_url=env_str("BACKEND_URL", "http://localhost:1488").rstrip("/"),
            api_key=env_str("BOT_API_KEY") or env_str("API_KEY"),
            telegram_proxy=env_str("TELEGRAM_PROXY"),
            reminders_enabled=env_bool("REMINDERS_ENABLED", True),
            morning_summary_enabled=env_bool("MORNING_SUMMARY_ENABLED", True),
            morning_summary_hour=env_int("MORNING_SUMMARY_HOUR", 8),
        )


SETTINGS = Settings.from_env()
BACKEND = BackendClient(SETTINGS.backend_url, SETTINGS.api_key)

BOT: Bot | None = None
router = Router()
_background_tasks: set[asyncio.Task] = set()


# —————————————————————————————— Разметка ——————————————————————————————


def esc(value: Any) -> str:
    """Экранирует значение для HTML-разметки Telegram."""
    return html.escape(str(value if value is not None else ""))


def main_keyboard() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="Сегодня"), KeyboardButton(text="Завтра")],
            [KeyboardButton(text="Эта неделя"), KeyboardButton(text="Все записи")],
            [KeyboardButton(text="Статистика"), KeyboardButton(text="Платежи")],
            [KeyboardButton(text="Экспорт календаря"), KeyboardButton(text="Обновить")],
        ],
        resize_keyboard=True,
    )


def session_keyboard(session_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="Проведен", callback_data=f"session:complete:{session_id}"),
                InlineKeyboardButton(text="Отменить", callback_data=f"session:cancel:{session_id}"),
            ],
            [InlineKeyboardButton(text="Детали", callback_data=f"session:detail:{session_id}")],
        ]
    )


def export_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="Эта неделя .ics", callback_data="export:week"),
                InlineKeyboardButton(text="Следующая .ics", callback_data="export:next_week"),
            ],
            [
                InlineKeyboardButton(text="Месяц .ics", callback_data="export:month"),
                InlineKeyboardButton(text="Все будущие .ics", callback_data="export:all"),
            ],
        ]
    )


def format_session_short(session: dict[str, Any]) -> str:
    dt = parse_dt(session)
    when = (
        dt.strftime("%d.%m.%Y %H:%M")
        if dt
        else f"{session.get('session_date', '?')} {session.get('session_time', '?')}"
    )
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
    return (
        f"<b>{esc(title)}</b>\n\n"
        f"Записей: {len(sessions)}\nАктивных: {len(active)}\nСумма: {total:.0f} руб."
    )


# —————————————————————————————— Доступ ——————————————————————————————


def is_admin(user_id: int | None) -> bool:
    return SETTINGS.admin_id > 0 and bool(user_id and user_id == SETTINGS.admin_id)


async def guard_message(message: Message) -> bool:
    if is_admin(message.from_user.id if message.from_user else None):
        return True
    await message.answer("Access denied.")
    return False


async def guard_callback(query: CallbackQuery) -> bool:
    if is_admin(query.from_user.id if query.from_user else None):
        return True
    await query.answer("Access denied.", show_alert=True)
    return False


# —————————————————————————————— Отправка ——————————————————————————————


async def send_sessions(message: Message, title: str, sessions: list[dict[str, Any]], limit: int = 30) -> None:
    if not sessions:
        await message.answer(f"<b>{esc(title)}</b>\n\nЗаписей нет.", reply_markup=main_keyboard())
        return

    await message.answer(format_header(title, sessions), reply_markup=main_keyboard())
    for item in sessions[:limit]:
        await message.answer(
            format_session_short(item),
            reply_markup=session_keyboard(int(item["id"])),
        )
    if len(sessions) > limit:
        await message.answer(f"Показано {limit} из {len(sessions)} записей.")


async def find_session(session_id: int) -> dict[str, Any] | None:
    future, past = await asyncio.gather(
        BACKEND.sessions(past=False, limit=500),
        BACKEND.sessions(past=True, limit=500),
    )
    return next((item for item in future + past if int(item.get("id", 0)) == session_id), None)


async def notify_admin(text: str) -> None:
    if BOT is None or SETTINGS.admin_id <= 0:
        LOGGER.warning("Cannot notify admin: TELEGRAM_ADMIN_ID is not set")
        return
    await BOT.send_message(SETTINGS.admin_id, text)


# —————————————————————————————— Обработчики ——————————————————————————————


async def cmd_start(message: Message) -> None:
    if not await guard_message(message):
        return
    health = await BACKEND.health()
    status = "ok" if health else "unavailable"
    await message.answer(
        "<b>Админ-панель записи</b>\n\n"
        f"Backend: {status}\nВыберите действие.\n\n"
        "<i>Управление расписанием:</i>\n"
        "<code>/block YYYY-MM-DD</code> — закрыть дату\n"
        "<code>/unblock YYYY-MM-DD</code> — открыть дату\n"
        "Например: <code>/block 2026-06-15 Отпуск</code>",
        reply_markup=main_keyboard(),
    )


async def cmd_block(message: Message) -> None:
    if not await guard_message(message):
        return
    parts = (message.text or "").split(maxsplit=2)
    if len(parts) < 2:
        await message.answer("Использование: /block YYYY-MM-DD [причина]")
        return

    date_str = parts[1]
    reason = parts[2] if len(parts) > 2 else ""
    data = await BACKEND.request("POST", "/api/schedule/admin/block", json={"date": date_str, "reason": reason})
    if data and data.get("success"):
        await message.answer(f"✅ Дата {date_str} успешно закрыта для записи.")
    else:
        await message.answer("❌ Ошибка. Убедитесь, что формат даты YYYY-MM-DD.")


async def cmd_unblock(message: Message) -> None:
    if not await guard_message(message):
        return
    parts = (message.text or "").split(maxsplit=1)
    if len(parts) < 2:
        await message.answer("Использование: /unblock YYYY-MM-DD")
        return

    date_str = parts[1]
    data = await BACKEND.request("DELETE", f"/api/schedule/admin/block/{date_str}")
    if data and data.get("success"):
        await message.answer(f"✅ Дата {date_str} снова открыта для записи.")
    else:
        await message.answer("❌ Ошибка открытия даты.")


async def text_router(message: Message) -> None:
    if not await guard_message(message):
        return
    text = message.text or ""
    LOGGER.info(
        "Incoming message from %s: %s",
        message.from_user.id if message.from_user else "unknown",
        text,
    )

    if text == "Сегодня":
        start_at, end_at = period_today()
        return await send_sessions(message, "Записи на сегодня", await BACKEND.sessions(start=start_at, end=end_at, limit=200))
    if text == "Завтра":
        start_at, end_at = period_tomorrow()
        return await send_sessions(message, "Записи на завтра", await BACKEND.sessions(start=start_at, end=end_at, limit=200))
    if text == "Эта неделя":
        start_at, end_at = period_week()
        return await send_sessions(message, "Записи на эту неделю", await BACKEND.sessions(start=start_at, end=end_at, limit=300))
    if text == "Все записи":
        return await send_sessions(message, "Будущие записи", await BACKEND.sessions(past=False, limit=200))
    if text == "Платежи":
        return await payments(message)
    if text == "Статистика":
        return await stats(message)
    if text == "Экспорт календаря":
        return await message.answer("Выберите период.", reply_markup=export_keyboard())
    if text == "Обновить":
        return await cmd_start(message)

    await message.answer("Сообщение получено. Нажмите /start.", reply_markup=main_keyboard())


async def payments(message: Message) -> None:
    items = await BACKEND.payments(limit=20)
    if not items:
        await message.answer("Платежей нет.", reply_markup=main_keyboard())
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
    await message.answer("\n".join(lines), reply_markup=main_keyboard())


async def stats(message: Message) -> None:
    future, past = await asyncio.gather(
        BACKEND.sessions(past=False, limit=500),
        BACKEND.sessions(past=True, limit=500),
    )
    sessions = future + past
    scheduled = sum(1 for item in sessions if item.get("status") == "scheduled")
    completed = sum(1 for item in sessions if item.get("status") == "completed")
    cancelled = sum(1 for item in sessions if item.get("status") == "cancelled")
    earned = sum(float(item.get("amount") or 0) for item in sessions if item.get("status") == "completed")
    await message.answer(
        "<b>Статистика</b>\n\n"
        f"Всего записей: {len(sessions)}\n"
        f"Запланировано: {scheduled}\n"
        f"Проведено: {completed}\n"
        f"Отменено: {cancelled}\n"
        f"Доход по проведенным: {earned:.0f} руб.",
        reply_markup=main_keyboard(),
    )


async def on_session_callback(query: CallbackQuery) -> None:
    if not await guard_callback(query):
        return
    if not query.data or query.message is None:
        return
    await query.answer()

    _, action, raw_id = query.data.split(":", 2)
    session_id = int(raw_id)

    if action == "complete":
        ok = await BACKEND.update_session_status(session_id, "completed")
        if ok:
            await _clear_reply_markup(query)
        await query.message.answer("Статус обновлен." if ok else "Не удалось обновить статус.")
    elif action == "cancel":
        ok = await BACKEND.delete_session(session_id)
        if ok:
            await _clear_reply_markup(query)
        await query.message.answer("Запись отменена." if ok else "Не удалось отменить запись.")
    elif action == "detail":
        session = await find_session(session_id)
        if session:
            await query.message.answer(format_session_full(session), reply_markup=session_keyboard(session_id))
        else:
            await query.message.answer("Сеанс не найден.")


async def _clear_reply_markup(query: CallbackQuery) -> None:
    try:
        await query.message.edit_reply_markup(reply_markup=None)
    except Exception:  # noqa: BLE001 - сообщение могло устареть
        LOGGER.debug("Could not clear reply markup", exc_info=True)


async def on_export_callback(query: CallbackQuery) -> None:
    if not await guard_callback(query):
        return
    if not query.data or query.message is None:
        return
    await query.answer()

    export_type = query.data.split(":", 1)[1]
    now = datetime.now()
    if export_type == "week":
        start_at, end_at = period_week(now)
        title, filename = "Записи на эту неделю", "knyazkova_week.ics"
        sessions = await BACKEND.sessions(start=start_at, end=end_at, limit=500)
    elif export_type == "next_week":
        start_at, end_at = period_week(now + timedelta(days=7))
        title, filename = "Записи на следующую неделю", "knyazkova_next_week.ics"
        sessions = await BACKEND.sessions(start=start_at, end=end_at, limit=500)
    elif export_type == "month":
        start_dt = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        next_month = (start_dt.replace(day=28) + timedelta(days=4)).replace(day=1)
        title, filename = "Записи на месяц", "knyazkova_month.ics"
        sessions = await BACKEND.sessions(start=start_dt.isoformat(), end=next_month.isoformat(), limit=500)
    else:
        title, filename = "Все будущие записи", "knyazkova_all.ics"
        sessions = await BACKEND.sessions(past=False, limit=500)

    if not sessions:
        await query.message.answer("Записей для экспорта нет.")
        return

    await query.message.answer_document(
        BufferedInputFile(generate_ics(sessions, title).encode("utf-8"), filename=filename),
        caption=f"{title}\nЗаписей: {len(sessions)}",
    )


# ——————————————————————————————— Запуск ———————————————————————————————


def _track(task: asyncio.Task) -> None:
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


async def on_startup(bot: Bot) -> None:
    health = await BACKEND.health()
    LOGGER.info("Backend: %s", "ok" if health else "unavailable")
    protected = await BACKEND.can_access_protected_api() if SETTINGS.api_key else False
    LOGGER.info("Protected backend API: %s", "ok" if protected else "unavailable")

    if SETTINGS.telegram_proxy:
        LOGGER.info("Telegram proxy: configured")
    else:
        LOGGER.warning("Telegram proxy is not configured; direct api.telegram.org connection will be used")

    me = await bot.get_me()
    LOGGER.info("Telegram bot: @%s (%s)", me.username, me.id)
    await bot.delete_webhook(drop_pending_updates=False)
    await bot.set_my_commands(
        [
            BotCommand(command="start", description="Открыть меню"),
            BotCommand(command="menu", description="Открыть меню"),
        ]
    )

    _track(
        asyncio.create_task(
            reminders_loop(
                BACKEND,
                notify_admin,
                enabled=SETTINGS.reminders_enabled and SETTINGS.admin_id > 0,
                build_text=lambda session: "<b>Напоминание о сеансе</b>\n\n" + format_session_full(session),
            )
        )
    )
    _track(
        asyncio.create_task(
            morning_summary_loop(
                BACKEND,
                notify_admin,
                enabled=SETTINGS.morning_summary_enabled and SETTINGS.admin_id > 0,
                hour=SETTINGS.morning_summary_hour,
                build_text=lambda count, total: (
                    f"<b>Сводка на сегодня</b>\n\nЗапланировано: {count}\nСумма: {total:.0f} руб."
                ),
            )
        )
    )


async def on_shutdown() -> None:
    for task in list(_background_tasks):
        task.cancel()
    if _background_tasks:
        await asyncio.gather(*_background_tasks, return_exceptions=True)
    await BACKEND.close()


def build_dispatcher() -> Dispatcher:
    dispatcher = Dispatcher()
    dispatcher.include_router(router)

    router.message.register(cmd_start, CommandStart())
    router.message.register(cmd_start, Command("menu"))
    router.message.register(cmd_block, Command("block"))
    router.message.register(cmd_unblock, Command("unblock"))
    router.callback_query.register(on_session_callback, F.data.startswith("session:"))
    router.callback_query.register(on_export_callback, F.data.startswith("export:"))
    router.message.register(text_router, F.text & ~F.text.startswith("/"))

    dispatcher.startup.register(on_startup)
    dispatcher.shutdown.register(on_shutdown)
    return dispatcher


def main() -> None:
    if not SETTINGS.bot_token:
        raise RuntimeError("TELEGRAM_BOT_TOKEN is not configured")
    if SETTINGS.admin_id <= 0:
        raise RuntimeError("A positive TELEGRAM_ADMIN_ID is required")
    if not SETTINGS.api_key:
        raise RuntimeError("BOT_API_KEY is required for protected backend access")

    session = AiohttpSession(proxy=SETTINGS.telegram_proxy) if SETTINGS.telegram_proxy else None
    global BOT
    BOT = Bot(
        SETTINGS.bot_token,
        session=session,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )
    dispatcher = build_dispatcher()
    dispatcher.run_polling(BOT, allowed_updates=dispatcher.resolve_used_update_types())


if __name__ == "__main__":
    main()
