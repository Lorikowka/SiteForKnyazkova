"""VK admin bot for bookings (vkbottle).

Бот общается только с backend API и никогда не открывает SQLite напрямую.
Общая логика (клиент backend, форматирование, напоминания) вынесена в пакет
``bots_common``.
"""

from __future__ import annotations

import asyncio
import random
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent
_SHARED_DIR = BASE_DIR.parent / "bots-common"
if _SHARED_DIR.is_dir():
    sys.path.insert(0, str(_SHARED_DIR))

import aiohttp  # noqa: E402
from vkbottle import API, Keyboard, KeyboardButtonColor, Text  # noqa: E402
from vkbottle.bot import Bot, Message  # noqa: E402
from vkbottle.http import AiohttpClient  # noqa: E402
from vkbottle.polling import BotPolling  # noqa: E402

from bots_common.backend import BackendClient  # noqa: E402
from bots_common.env import load_env_files  # noqa: E402
from bots_common.events import EventState, event_watcher_loop  # noqa: E402
from bots_common.formatting import (  # noqa: E402
    format_header,
    format_session_short,
    parse_dt,
    period_today,
    period_tomorrow,
    period_week,
    split_messages,
    status_label,
)
from bots_common.logging_setup import setup_logging  # noqa: E402
from bots_common.loops import morning_summary_loop, reminders_loop  # noqa: E402
from bots_common.parsers import (  # noqa: E402
    parse_add_command,
    parse_block_command,
    parse_unblock_command,
)
from bots_common.settings import env_bool, env_int, env_str, parse_int_list  # noqa: E402

# Локальный .env бота имеет приоритет над корневым.
load_env_files(BASE_DIR / ".env", BASE_DIR.parent / ".env")

LOGGER = setup_logging("knyazkova_vk_bot", BASE_DIR / "logs")

PRIMARY = KeyboardButtonColor.PRIMARY
SECONDARY = KeyboardButtonColor.SECONDARY
POSITIVE = KeyboardButtonColor.POSITIVE
NEGATIVE = KeyboardButtonColor.NEGATIVE


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
    disable_ssl_verify: bool

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            vk_token=env_str("VK_BOT_TOKEN"),
            vk_group_id=env_int("VK_GROUP_ID", 0),
            admin_ids=parse_int_list(env_str("VK_ADMIN_IDS")),
            backend_url=env_str("BACKEND_URL", "http://localhost:1488").rstrip("/"),
            api_key=env_str("BOT_API_KEY") or env_str("API_KEY"),
            reminders_enabled=env_bool("REMINDERS_ENABLED", False),
            morning_summary_enabled=env_bool("MORNING_SUMMARY_ENABLED", False),
            morning_summary_hour=env_int("MORNING_SUMMARY_HOUR", 8),
            event_watcher_enabled=env_bool("EVENT_WATCHER_ENABLED", False),
            event_poll_interval_seconds=max(10, env_int("EVENT_POLL_INTERVAL_SECONDS", 30)),
            disable_ssl_verify=env_bool("DISABLE_SSL_VERIFY", False),
        )


SETTINGS = Settings.from_env()
BACKEND = BackendClient(
    SETTINGS.backend_url,
    SETTINGS.api_key,
    disable_ssl_verify=SETTINGS.disable_ssl_verify,
)
STATE = EventState(BASE_DIR / "data" / "state.json")

BOT: Bot | None = None


# —————————————————————————————— Клавиатуры ——————————————————————————————


def _keyboard(rows: list[list[tuple[str, KeyboardButtonColor]]]) -> str:
    keyboard = Keyboard(one_time=False)
    for index, row in enumerate(rows):
        if index:
            keyboard.row()
        for label, color in row:
            keyboard.add(Text(label), color=color)
    return keyboard.get_json()


def main_keyboard() -> str:
    return _keyboard(
        [
            [("Записи", PRIMARY), ("Управление", PRIMARY)],
            [("Выходные", SECONDARY), ("Платежи", SECONDARY)],
            [("Статистика", SECONDARY)],
        ]
    )


def records_keyboard() -> str:
    return _keyboard(
        [
            [("Все записи", PRIMARY), ("Ближайшие", PRIMARY)],
            [("Назад", SECONDARY)],
        ]
    )


def management_keyboard() -> str:
    return _keyboard(
        [
            [("Создать запись", POSITIVE), ("Удалить запись", NEGATIVE)],
            [("Назад", SECONDARY)],
        ]
    )


def blocked_keyboard() -> str:
    return _keyboard(
        [
            [("Показать выходные", SECONDARY), ("Добавить выходной", PRIMARY)],
            [("Удалить выходной", NEGATIVE), ("Назад", SECONDARY)],
        ]
    )


# —————————————————————————————— Отправка ——————————————————————————————


def is_admin(user_id: int) -> bool:
    return user_id > 0 and user_id in SETTINGS.admin_ids


async def send_message(peer_id: int, text: str, keyboard: str | None = None) -> None:
    """Отправляет сообщение в произвольный чат (для уведомлений)."""
    if BOT is None:
        return
    params: dict[str, Any] = {
        "peer_id": peer_id,
        "random_id": random.randint(1, 2_147_483_647),
        "message": text[:4000],
    }
    if keyboard:
        params["keyboard"] = keyboard
    try:
        await BOT.api.messages.send(**params)
    except Exception as error:  # noqa: BLE001 - отправка не должна ронять обработчик
        LOGGER.warning("Failed to send VK message to %s: %s", peer_id, error)


async def notify_admins(text: str) -> None:
    if not SETTINGS.admin_ids:
        LOGGER.info("Skip admin notification because VK_ADMIN_IDS is empty")
        return
    for admin_id in SETTINGS.admin_ids:
        await send_message(admin_id, text, main_keyboard())


# ————————————————————————————— Списки записей —————————————————————————————


async def send_blocked_dates(message: Message) -> None:
    blocks = await BACKEND.blocked_dates()
    if not blocks:
        await message.answer("Закрытых дат нет.", keyboard=main_keyboard())
        return

    lines = ["Закрытые даты (выходные):"]
    for item in blocks[:40]:
        lines.append(f"• {item.get('date')} — {item.get('reason') or 'без причины'}")
    if len(blocks) > 40:
        lines.append(f"Показано 40 из {len(blocks)}.")
    await message.answer("\n".join(lines), keyboard=main_keyboard())


async def send_sessions(
    message: Message,
    title: str,
    sessions: list[dict[str, Any]],
    limit: int = 25,
    keyboard: str | None = None,
) -> None:
    if not sessions:
        await message.answer(f"{title}\n\nЗаписей нет.", keyboard=keyboard or records_keyboard())
        return

    blocks = [format_header(title, sessions)]
    blocks.extend(format_session_short(item) for item in sessions[:limit])
    if len(sessions) > limit:
        blocks.append(f"Показано {limit} из {len(sessions)} записей.")

    for chunk in split_messages("\n\n".join(blocks)):
        await message.answer(chunk, keyboard=keyboard or records_keyboard())


async def send_all_sessions(message: Message) -> None:
    future, past = await asyncio.gather(
        BACKEND.sessions(past=False, limit=500),
        BACKEND.sessions(past=True, limit=500),
    )
    sessions = sorted(
        future + past,
        key=lambda item: (parse_dt(item) or datetime.min, item.get("id", 0)),
    )
    await send_sessions(message, "Все записи за всё время", sessions, limit=40, keyboard=records_keyboard())


async def send_upcoming_sessions(message: Message) -> None:
    sessions = await BACKEND.sessions(past=False, limit=200)
    await send_sessions(message, "Ближайшие записи", sessions, limit=30, keyboard=records_keyboard())


async def send_payments(message: Message) -> None:
    payments = await BACKEND.payments(limit=20)
    if not payments:
        await message.answer("Платежей нет.", keyboard=main_keyboard())
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
    await message.answer("\n\n".join(blocks), keyboard=main_keyboard())


async def send_stats(message: Message) -> None:
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
        keyboard=main_keyboard(),
    )


# ————————————————————————————— Маршрутизация —————————————————————————————


async def handle_command(message: Message, text: str) -> None:
    user_id = message.from_id or 0
    if not is_admin(user_id):
        await message.answer("Доступ запрещен.")
        return

    normalized = text.strip()
    lower = normalized.lower()

    if lower in {"/start", "/menu", "меню", "обновить", "назад"}:
        health = await BACKEND.health()
        protected = await BACKEND.can_access_protected_api() if SETTINGS.api_key else False
        await message.answer(
            "Админ-панель записей\n\n"
            f"Backend: {'ok' if health else 'unavailable'}\n"
            f"Защищенный API: {'ok' if protected else 'unavailable'}\n\n"
            "Выберите раздел:\n"
            "• Записи — посмотреть записи\n"
            "• Управление — создать или удалить запись\n"
            "• Выходные — назначить или снять выходной",
            keyboard=main_keyboard(),
        )
        return

    if lower in {"/today", "сегодня"}:
        start, end = period_today()
        return await send_sessions(
            message,
            "Записи на сегодня",
            await BACKEND.sessions(start=start, end=end, limit=200),
            keyboard=records_keyboard(),
        )

    if lower in {"/tomorrow", "завтра"}:
        start, end = period_tomorrow()
        return await send_sessions(
            message,
            "Записи на завтра",
            await BACKEND.sessions(start=start, end=end, limit=200),
            keyboard=records_keyboard(),
        )

    if lower in {"/week", "неделя", "эта неделя"}:
        start, end = period_week()
        return await send_sessions(
            message,
            "Записи на эту неделю",
            await BACKEND.sessions(start=start, end=end, limit=300),
            keyboard=records_keyboard(),
        )

    if lower in {"записи", "записи меню", "/records"}:
        await message.answer("Выберите режим просмотра записей:", keyboard=records_keyboard())
        return

    if lower in {"/sessions", "все записи", "записи за всё время"}:
        return await send_all_sessions(message)

    if lower in {"ближайшие", "в ближайшее время", "следующие"}:
        return await send_upcoming_sessions(message)

    if lower in {"управление", "удалять создавать записи", "меню управления"}:
        await message.answer("Управление записями:", keyboard=management_keyboard())
        return

    if lower in {"создать запись", "создать"}:
        await message.answer(
            "Чтобы создать запись, отправьте команду:\n/add YYYY-MM-DD HH:MM | Имя | Телефон | [услуга]",
            keyboard=management_keyboard(),
        )
        return

    if lower in {"удалить запись", "удалить"}:
        await message.answer(
            "Чтобы удалить запись, отправьте команду:\n/cancel ID",
            keyboard=management_keyboard(),
        )
        return

    if lower in {"/payments", "платежи"}:
        return await send_payments(message)

    if lower in {"/stats", "статистика"}:
        return await send_stats(message)

    if lower in {"выходные", "меню выходных", "/blocks", "/выходные"}:
        await message.answer("Меню выходных:", keyboard=blocked_keyboard())
        return

    if lower in {"показать выходные", "список выходных"}:
        return await send_blocked_dates(message)

    if lower in {"добавить выходной", "добавить"}:
        await message.answer(
            "Чтобы назначить выходной, отправьте команду:\n/block YYYY-MM-DD [причина]",
            keyboard=blocked_keyboard(),
        )
        return

    if lower in {"удалить выходной", "снять выходной"}:
        await message.answer(
            "Чтобы убрать выходной, отправьте команду:\n/unblock YYYY-MM-DD",
            keyboard=blocked_keyboard(),
        )
        return

    add_payload = parse_add_command(normalized)
    if add_payload:
        data = await BACKEND.create_session(add_payload)
        if data and data.get("success"):
            await message.answer(
                "Запись создана.\n\n" + format_session_short(data.get("session") or {}),
                keyboard=main_keyboard(),
            )
        else:
            await message.answer(
                "Не удалось создать запись. Проверьте дату, время и свободный слот.",
                keyboard=main_keyboard(),
            )
        return

    block_args = parse_block_command(normalized)
    if block_args:
        date_str, reason = block_args
        ok = await BACKEND.block_date(date_str, reason)
        await message.answer(
            f"Дата {date_str} закрыта для записи." if ok else "Не удалось закрыть дату.",
            keyboard=main_keyboard(),
        )
        return

    unblock_date = parse_unblock_command(normalized)
    if unblock_date:
        ok = await BACKEND.unblock_date(unblock_date)
        await message.answer(
            f"Дата {unblock_date} снова открыта." if ok else "Не удалось открыть дату.",
            keyboard=main_keyboard(),
        )
        return

    if lower.startswith("/complete "):
        session_id = int(lower.split(maxsplit=1)[1])
        ok = await BACKEND.update_session_status(session_id, "completed")
        await message.answer(
            "Статус обновлен." if ok else "Не удалось обновить статус.",
            keyboard=main_keyboard(),
        )
        return

    if lower.startswith("/cancel ") or lower.startswith("/delete "):
        session_id = int(lower.split(maxsplit=1)[1])
        ok = await BACKEND.delete_session(session_id)
        await message.answer(
            "Запись отменена." if ok else "Не удалось отменить запись.",
            keyboard=main_keyboard(),
        )
        return

    if lower in {"/help", "помощь"}:
        await message.answer(
            "Команды:\n"
            "/today - сегодня\n"
            "/tomorrow - завтра\n"
            "/week - неделя\n"
            "/sessions - все записи за всё время\n"
            "Записи / Ближайшие — меню просмотра\n"
            "/payments - платежи\n"
            "/stats - статистика\n"
            "/complete ID - отметить проведенной\n"
            "/cancel ID - отменить запись\n"
            "/delete ID - то же, что /cancel\n\n"
            "Добавить запись:\n"
            "/add ДАТА ВРЕМЯ | Имя | Телефон | [услуга] | [комментарий]\n"
            "Пример: /add 2026-07-15 10:00 | Иван | +79001234567 | consult-online\n\n"
            "Выходные:\n"
            "/block YYYY-MM-DD [причина] — закрыть день\n"
            "/unblock YYYY-MM-DD — открыть день\n"
            "/blocks — список закрытых дат",
            keyboard=main_keyboard(),
        )
        return

    await message.answer("Не понял команду. Нажмите /menu или /help.", keyboard=main_keyboard())


async def handle_message(message: Message) -> None:
    peer_id = message.peer_id
    user_id = message.from_id or 0
    text = str(message.text or "").strip()
    if not peer_id or not user_id or not text:
        return

    LOGGER.info("Incoming VK message from %s: %s", user_id, text)
    try:
        await handle_command(message, text)
    except ValueError:
        await message.answer("Нужен числовой ID записи. Например: /complete 12", keyboard=main_keyboard())
    except Exception:
        LOGGER.exception("Failed to handle VK message")
        await message.answer("Произошла ошибка. Проверьте логи бота.", keyboard=main_keyboard())


# ——————————————————————————————— Запуск ———————————————————————————————


async def on_startup() -> None:
    health = await BACKEND.health()
    protected = await BACKEND.can_access_protected_api() if SETTINGS.api_key else False
    LOGGER.info("Backend: %s", "ok" if health else "unavailable")
    LOGGER.info("Protected backend API: %s", "ok" if protected else "unavailable")


async def on_shutdown() -> None:
    await BACKEND.close()


def build_bot() -> Bot:
    if not SETTINGS.vk_token:
        raise RuntimeError(
            "VK_BOT_TOKEN is not configured in .env file. Please provide a community token."
        )
    if SETTINGS.vk_group_id <= 0:
        raise RuntimeError(
            "VK_GROUP_ID is not configured in .env file. Please set it to your numeric VK community ID."
        )
    if not SETTINGS.admin_ids:
        raise RuntimeError("VK_ADMIN_IDS must contain administrator IDs")
    if not SETTINGS.api_key:
        raise RuntimeError("BOT_API_KEY is required for protected backend access")

    http_client = (
        AiohttpClient(connector=aiohttp.TCPConnector(ssl=False))
        if SETTINGS.disable_ssl_verify
        else None
    )
    vk_api = API(SETTINGS.vk_token, http_client=http_client) if http_client else API(SETTINGS.vk_token)
    polling = BotPolling(vk_api, group_id=SETTINGS.vk_group_id)

    bot = Bot(api=vk_api, polling=polling)
    bot.on.message()(handle_message)

    bot.on_startup.append(on_startup())
    bot.on_shutdown.append(on_shutdown())
    bot.startup_tasks.extend(
        [
            reminders_loop(
                BACKEND,
                notify_admins,
                enabled=SETTINGS.reminders_enabled and bool(SETTINGS.admin_ids),
                build_text=lambda session: "Напоминание о записи\n\n" + format_session_short(session),
            ),
            morning_summary_loop(
                BACKEND,
                notify_admins,
                enabled=SETTINGS.morning_summary_enabled and bool(SETTINGS.admin_ids),
                hour=SETTINGS.morning_summary_hour,
                build_text=lambda count, total: (
                    f"Сводка на сегодня\n\nЗапланировано: {count}\nСумма: {total:.0f} руб."
                ),
            ),
            event_watcher_loop(
                BACKEND,
                notify_admins,
                state=STATE,
                enabled=SETTINGS.event_watcher_enabled,
                interval=SETTINGS.event_poll_interval_seconds,
            ),
        ]
    )

    global BOT
    BOT = bot
    return bot


def main() -> None:
    try:
        build_bot().run()
    except KeyboardInterrupt:
        LOGGER.info("VK bot stopped")


if __name__ == "__main__":
    main()
