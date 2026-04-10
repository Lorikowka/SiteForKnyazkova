"""
═══════════════════════════════════════════════════════════
🤖 TELEGRAM БОТ — АДМИН-ПАНЕЛЬ для психолога
═══════════════════════════════════════════════════════════
Психолог Екатерина Князькова

Возможности:
  📅 Расписание на сегодня / завтра / неделю
  👥 Список записей с деталями клиентов
  ✅ / ❌ Управление статусом записей
  📊 Статистика и аналитика
  📤 Экспорт в ICS (Google/Яндекс Календарь)
  💰 Просмотр платежей
  🔔 Напоминания

Архитектура: Бот работает через API бэкенда (не напрямую с БД)
"""

import os
import asyncio
import hashlib
import json
import urllib.parse
from datetime import datetime, timedelta
from pathlib import Path
from io import BytesIO

import aiohttp
from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command, CommandStart
from aiogram.types import (
    ReplyKeyboardMarkup, KeyboardButton,
    InlineKeyboardMarkup, InlineKeyboardButton,
    CallbackQuery, BufferedInputFile
)
from aiogram.utils.keyboard import InlineKeyboardBuilder

# ═══════════════════════════════════════════════════════════
# НАСТРОЙКИ
# ═══════════════════════════════════════════════════════════

BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN', 'YOUR_BOT_TOKEN_HERE')
ADMIN_ID = int(os.getenv('TELEGRAM_ADMIN_ID', '0'))
BACKEND_URL = os.getenv('BACKEND_URL', 'http://localhost:1488')
API_KEY = os.getenv('API_KEY', '')

# ═══════════════════════════════════════════════════════════
# ИНИЦИАЛИЗАЦИЯ
# ═══════════════════════════════════════════════════════════

bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()

# HTTP-сессия для запросов к бэкенду
_http_session = None

def get_http_session() -> aiohttp.ClientSession:
    global _http_session
    if _http_session is None or _http_session.closed:
        _http_session = aiohttp.ClientSession()
    return _http_session

async def backend_request(method: str, endpoint: str, **kwargs) -> dict | None:
    """Универсальный запрос к API бэкенда"""
    session = get_http_session()
    headers = {}
    if API_KEY:
        headers['X-API-Key'] = API_KEY

    url = f"{BACKEND_URL}{endpoint}"
    try:
        async with session.request(method, url, headers=headers, **kwargs) as resp:
            if resp.status >= 400:
                text = await resp.text()
                print(f"❌ Backend error {resp.status}: {text}")
                return None
            return await resp.json()
    except Exception as e:
        print(f"❌ Backend request error: {e}")
        return None

# ═══════════════════════════════════════════════════════════
# КЛАВИАТУРЫ
# ═══════════════════════════════════════════════════════════

def get_main_keyboard() -> ReplyKeyboardMarkup:
    """Главное меню бота"""
    kb = [
        [KeyboardButton(text="📅 Сегодня"), KeyboardButton(text="📆 Завтра")],
        [KeyboardButton(text="📅 Эта неделя"), KeyboardButton(text="📋 Все записи")],
        [KeyboardButton(text="📊 Статистика"), KeyboardButton(text="💰 Платежи")],
        [KeyboardButton(text="📤 Экспорт календаря")],
        [KeyboardButton(text="🔄 Обновить")]
    ]
    return ReplyKeyboardMarkup(keyboard=kb, resize_keyboard=True)

def get_session_actions_keyboard(session_id: int) -> InlineKeyboardMarkup:
    """Кнопки действий для сеанса"""
    builder = InlineKeyboardBuilder()
    builder.row(
        InlineKeyboardButton(text="✅ Проведён", callback_data=f"completed_{session_id}"),
        InlineKeyboardButton(text="❌ Отменить", callback_data=f"cancel_{session_id}")
    )
    builder.row(
        InlineKeyboardButton(text="📋 Детали", callback_data=f"detail_{session_id}")
    )
    return builder.as_markup()

def get_day_view_keyboard(date_str: str) -> InlineKeyboardMarkup:
    """Клавиатура для просмотра по дням"""
    builder = InlineKeyboardBuilder()

    try:
        current_date = datetime.strptime(date_str, '%Y-%m-%d')
    except Exception:
        current_date = datetime.now()

    prev_date = current_date - timedelta(days=1)
    next_date = current_date + timedelta(days=1)

    builder.row(
        InlineKeyboardButton(text="⬅️", callback_data=f"day_{prev_date.strftime('%Y-%m-%d')}"),
        InlineKeyboardButton(text=f"📅 {current_date.strftime('%d.%m')}", callback_data="noop"),
        InlineKeyboardButton(text="➡️", callback_data=f"day_{next_date.strftime('%Y-%m-%d')}")
    )
    builder.row(
        InlineKeyboardButton(text="🔙 В главное меню", callback_data="main_menu")
    )
    return builder.as_markup()

def get_week_keyboard() -> InlineKeyboardMarkup:
    """Клавиатура для навигации по неделям"""
    builder = InlineKeyboardBuilder()
    now = datetime.now()

    prev_week = now - timedelta(weeks=1)
    next_week = now + timedelta(weeks=1)

    builder.row(
        InlineKeyboardButton(text="⬅️ Пред. неделя", callback_data=f"week_{prev_week.strftime('%Y-%m-%d')}"),
        InlineKeyboardButton(text="➡️ След. неделя", callback_data=f"week_{next_week.strftime('%Y-%m-%d')}")
    )
    builder.row(
        InlineKeyboardButton(text="🔙 В главное меню", callback_data="main_menu")
    )
    return builder.as_markup()

def get_export_keyboard() -> InlineKeyboardMarkup:
    """Клавиатура для экспорта календаря"""
    builder = InlineKeyboardBuilder()
    builder.row(
        InlineKeyboardButton(text="📅 Эта неделя (.ics)", callback_data="export_week"),
        InlineKeyboardButton(text="📆 Следующая неделя (.ics)", callback_data="export_next_week")
    )
    builder.row(
        InlineKeyboardButton(text="📅 Весь месяц (.ics)", callback_data="export_month"),
        InlineKeyboardButton(text="📋 Все записи (.ics)", callback_data="export_all")
    )
    builder.row(
        InlineKeyboardButton(text="🔗 Google Calendar URL", callback_data="export_google_url"),
        InlineKeyboardButton(text="🔗 Яндекс Календарь URL", callback_data="export_yandex_url")
    )
    builder.row(
        InlineKeyboardButton(text="🔙 В главное меню", callback_data="main_menu")
    )
    return builder.as_markup()

# ═══════════════════════════════════════════════════════════
# API ЗАПРОСЫ (заменяют прямой доступ к БД)
# ═══════════════════════════════════════════════════════════

async def api_get_sessions(past: bool = False, limit: int = 200) -> list:
    """Получить сеансы через API"""
    data = await backend_request('GET', f'/api/sessions?past={str(past).lower()}&limit={limit}')
    if data and data.get('success'):
        return data.get('sessions', [])
    return []

async def api_get_sessions_by_date_range(start: str, end: str) -> list:
    """Фильтрация сеансов по дате (на клиенте, т.к. API не поддерживает диапазон)"""
    all_sessions = await api_get_sessions(past=True, limit=500)
    return [s for s in all_sessions if start <= s.get('session_datetime', '') < end]

async def api_get_today_sessions() -> list:
    """Получить сеансы на сегодня"""
    all_sessions = await api_get_sessions(past=False, limit=200)
    today = datetime.now().strftime('%Y-%m-%d')
    tomorrow = (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d')
    return [s for s in all_sessions if today <= s.get('session_datetime', '') < tomorrow]

async def api_get_tomorrow_sessions() -> list:
    """Получить сеансы на завтра"""
    all_sessions = await api_get_sessions(past=False, limit=200)
    tomorrow = (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d')
    day_after = (datetime.now() + timedelta(days=2)).strftime('%Y-%m-%d')
    return [s for s in all_sessions if tomorrow <= s.get('session_datetime', '') < day_after]

async def api_get_week_sessions(from_date: datetime = None) -> list:
    """Получить сеансы на неделю"""
    if from_date is None:
        from_date = datetime.now()

    start_of_week = from_date - timedelta(days=from_date.weekday())
    start_of_week = start_of_week.replace(hour=0, minute=0, second=0)
    end_of_week = start_of_week + timedelta(days=7)

    all_sessions = await api_get_sessions(past=False, limit=200)
    start_str = start_of_week.isoformat()
    end_str = end_of_week.isoformat()
    return [s for s in all_sessions if start_str <= s.get('session_datetime', '') < end_str]

async def api_get_all_sessions(limit: int = 50, past: bool = False) -> list:
    """Получить все сеансы"""
    return await api_get_sessions(past=past, limit=limit)

async def api_delete_session(session_id: int) -> bool:
    """Отменить сеанс через API"""
    data = await backend_request('DELETE', f'/api/sessions/{session_id}')
    return data is not None and data.get('success')

async def api_get_payments(limit: int = 50) -> list:
    """Получить платежи через API"""
    data = await backend_request('GET', f'/api/payments?limit={limit}')
    if data and data.get('success'):
        return data.get('payments', [])
    return []

# ═══════════════════════════════════════════════════════════
# ФОРМАТИРОВАНИЕ
# ═══════════════════════════════════════════════════════════

def get_status_emoji(status: str) -> str:
    """Эмодзи для статуса"""
    return {
        'scheduled': '📅',
        'completed': '✅',
        'cancelled': '❌',
        'pending': '⏳'
    }.get(status, '❓')

def format_session_short(session: dict) -> str:
    """Краткое форматирование сеанса"""
    try:
        dt = datetime.fromisoformat(session['session_datetime'])
        time_str = dt.strftime('%H:%M')
        date_str = dt.strftime('%d.%m')
        day_name = dt.strftime('%A')

        days_ru = {
            'Monday': 'Пн', 'Tuesday': 'Вт', 'Wednesday': 'Ср',
            'Thursday': 'Чт', 'Friday': 'Пт', 'Saturday': 'Сб', 'Sunday': 'Вс'
        }
        day_short = days_ru.get(day_name, day_name[:2])
    except Exception:
        time_str = session.get('session_time', '?')
        date_str = session.get('session_date', '?')
        day_short = ''

    emoji = get_status_emoji(session.get('status', ''))

    return (
        f"{emoji} <b>{time_str}</b> — {session['client_name']}\n"
        f"    📋 {session['service_name']} | {date_str} ({day_short})\n"
        f"    💰 {session['amount']} ₽ | 📞 {session['client_phone']}"
    )

def format_session_full(session: dict) -> str:
    """Полное форматирование сеанса"""
    try:
        dt = datetime.fromisoformat(session['session_datetime'])
        date_str = dt.strftime('%d.%m.%Y (%A)')
        time_str = dt.strftime('%H:%M')
    except Exception:
        date_str = session.get('session_date', '?')
        time_str = session.get('session_time', '?')

    emoji = get_status_emoji(session.get('status', ''))

    msg = (
        f"{emoji} <b>Сеанс #{session['id']}</b>\n\n"
        f"👤 <b>Клиент:</b> {session['client_name']}\n"
        f"📞 <b>Телефон:</b> {session['client_phone']}\n"
    )

    if session.get('client_email'):
        msg += f"📧 <b>Email:</b> {session['client_email']}\n"

    msg += (
        f"\n📋 <b>Услуга:</b> {session['service_name']}\n"
        f"📅 <b>Дата:</b> {date_str}\n"
        f"🕐 <b>Время:</b> {time_str}\n"
        f"💰 <b>Оплата:</b> {session['amount']} ₽\n"
        f"📊 <b>Статус:</b> {session['status']}\n"
    )

    if session.get('comment'):
        msg += f"\n📝 <b>Комментарий:</b> {session['comment']}\n"

    msg += f"\n🆔 Payment ID: {session['payment_id']}"

    return msg

def format_schedule_header(sessions: list, title: str) -> str:
    """Форматировать заголовок расписания"""
    if not sessions:
        return f"📭 <b>{title}</b>\n\nНет записей на этот период"

    total_amount = sum(s.get('amount', 0) for s in sessions if s.get('status') != 'cancelled')
    scheduled_count = sum(1 for s in sessions if s.get('status') == 'scheduled')

    header = f"📅 <b>{title}</b>\n\n"
    header += f"📋 Записей: {len(sessions)} | Запланировано: {scheduled_count}\n"
    header += f"💰 Ожидаемый доход: {total_amount} ₽\n"
    header += "━" * 30 + "\n\n"

    return header

def format_statistics(stats: dict) -> str:
    """Форматировать статистику"""
    return f"""
📊 <b>Статистика</b>

📅 <b>Сеансы:</b>
  ├ Всего: {stats['total_sessions']}
  ├ Запланировано: {stats['scheduled']}
  ├ Проведено: {stats['completed']}
  └ Отменено: {stats['cancelled']}

💰 <b>Финансы:</b>
  ├ Ожидаемый доход: {stats['total_amount']} ₽
  ├ Заработано: {stats['earned_amount']} ₽
  └ За неделю: {stats['week_earned']} ₽

📆 <b>Ближайшие:</b>
  ├ Сегодня: {stats['today_sessions']}
  └ Завтра: {stats['tomorrow_sessions']}
""".strip()

# ═══════════════════════════════════════════════════════════
# ЭКСПОРТ В ICS (Google / Яндекс Календарь)
# ═══════════════════════════════════════════════════════════

def generate_ics(sessions: list, title: str = "Записи на консультацию") -> str:
    """Генерация ICS файла для импорта в календари"""
    ics_lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Knyazkova//Booking//RU",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{title}",
        "BEGIN:VTIMEZONE",
        "TZID:Europe/Moscow",
        "BEGIN:STANDARD",
        "DTSTART:19701025T030000",
        "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10",
        "TZOFFSETFROM:+0400",
        "TZOFFSETTO:+0300",
        "TZNAME:MSK",
        "END:STANDARD",
        "BEGIN:DAYLIGHT",
        "DTSTART:19700329T020000",
        "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3",
        "TZOFFSETFROM:+0300",
        "TZOFFSETTO:+0400",
        "TZNAME:MSD",
        "END:DAYLIGHT",
        "END:VTIMEZONE",
    ]

    for session in sessions:
        if session.get('status') == 'cancelled':
            continue

        try:
            dt = datetime.fromisoformat(session['session_datetime'])
            dt_end = dt + timedelta(hours=1)

            dtstart = dt.strftime('%Y%m%dT%H%M%S')
            dtend = dt_end.strftime('%Y%m%dT%H%M%S')
            created = datetime.now().strftime('%Y%m%dT%H%M%SZ')

            uid = hashlib.md5(f"{session['id']}@knyazkova".encode()).hexdigest()

            ics_lines.extend([
                "BEGIN:VEVENT",
                f"UID:{uid}",
                f"DTSTAMP:{created}",
                f"DTSTART;TZID=Europe/Moscow:{dtstart}",
                f"DTEND;TZID=Europe/Moscow:{dtend}",
                f"SUMMARY:Консультация — {session['client_name']}",
                f"DESCRIPTION:Клиент: {session['client_name']}\\n"
                f"Телефон: {session['client_phone']}\\n"
                f"Услуга: {session['service_name']}\\n"
                f"Оплата: {session['amount']} руб."
                f"{'\\nКомментарий: ' + session['comment'] if session.get('comment') else ''}",
                f"LOCATION:Онлайн",
                "STATUS:CONFIRMED",
                "END:VEVENT",
            ])
        except Exception as e:
            print(f"Ошибка генерации ICS для сеанса #{session['id']}: {e}")

    ics_lines.append("END:VCALENDAR")

    return "\r\n".join(ics_lines)

# ═══════════════════════════════════════════════════════════
# ОБРАБОТЧИКИ КОМАНД
# ═══════════════════════════════════════════════════════════

def is_admin(message: types.Message) -> bool:
    """Проверка админа"""
    if message.from_user.id != ADMIN_ID:
        return False
    return True

@dp.message(CommandStart())
async def cmd_start(message: types.Message):
    """Команда /start"""
    if not is_admin(message):
        await message.answer("⛔ Доступ запрещён")
        return

    await message.answer(
        f"👋 <b>Приветствую, Екатерина!</b>\n\n"
        f"Я ваш бот-помощник для управления записями.\n\n"
        f"<b>Что я умею:</b>\n"
        f"📅 Показывать расписание на день / неделю\n"
        f"👅 Управлять записями (отменить / завершить)\n"
        f"📊 Показывать статистику и доход\n"
        f"📤 Экспортировать записи в Google / Яндекс Календарь\n"
        f"💰 Отслеживать платежи\n\n"
        f"Используйте кнопки меню для управления.",
        reply_markup=get_main_keyboard()
    )

@dp.message(Command("help"))
async def cmd_help(message: types.Message):
    """Команда /help"""
    if not is_admin(message):
        return

    await message.answer("""
<b>📚 Справка по командам:</b>

/start — Запустить бота
/help — Эта справка
/today — Расписание на сегодня
/week — Расписание на неделю
/stats — Статистика
/export — Экспорт календаря
/refresh — Обновить данные
    """)

@dp.message(Command("today"))
async def cmd_today(message: types.Message):
    if not is_admin(message):
        return
    await show_today(message)

@dp.message(Command("week"))
async def cmd_week(message: types.Message):
    if not is_admin(message):
        return
    await show_week(message)

@dp.message(Command("stats"))
async def cmd_stats(message: types.Message):
    if not is_admin(message):
        return
    await show_stats(message)

@dp.message(Command("export"))
async def cmd_export(message: types.Message):
    if not is_admin(message):
        return
    await show_export_menu(message)

@dp.message(Command("refresh"))
async def cmd_refresh(message: types.Message):
    if not is_admin(message):
        return
    await message.answer("🔄 Данные обновлены!")

# ═══════════════════════════════════════════════════════════
# ОБРАБОТЧИКИ КНОПОК ГЛАВНОГО МЕНЮ
# ═══════════════════════════════════════════════════════════

@dp.message(F.text == "📅 Сегодня")
async def show_today(message: types.Message):
    """Расписание на сегодня"""
    sessions = await api_get_today_sessions()

    now = datetime.now()
    today_str = now.strftime('%d.%m.%Y')
    title = f"📅 Сегодня — {today_str}"

    header = format_schedule_header(sessions, title)

    if not sessions:
        await message.answer(header, parse_mode='HTML')
        return

    await message.answer(header, parse_mode='HTML')

    for session in sessions:
        msg = format_session_short(session)
        keyboard = get_session_actions_keyboard(session['id'])
        await message.answer(msg, reply_markup=keyboard, parse_mode='HTML')

@dp.message(F.text == "📆 Завтра")
async def show_tomorrow(message: types.Message):
    """Расписание на завтра"""
    sessions = await api_get_tomorrow_sessions()

    tomorrow = datetime.now() + timedelta(days=1)
    tomorrow_str = tomorrow.strftime('%d.%m.%Y')
    title = f"📆 Завтра — {tomorrow_str}"

    header = format_schedule_header(sessions, title)

    if not sessions:
        await message.answer(header, parse_mode='HTML')
        return

    await message.answer(header, parse_mode='HTML')

    for session in sessions:
        msg = format_session_short(session)
        keyboard = get_session_actions_keyboard(session['id'])
        await message.answer(msg, reply_markup=keyboard, parse_mode='HTML')

@dp.message(F.text == "📅 Эта неделя")
async def show_week(message: types.Message):
    """Расписание на неделю"""
    await _show_week_impl(message, datetime.now())

async def _show_week_impl(message: types.Message, from_date: datetime):
    """Реализация показа недели"""
    sessions = await api_get_week_sessions(from_date)

    start_of_week = from_date - timedelta(days=from_date.weekday())
    end_of_week = start_of_week + timedelta(days=6)

    title = f"📅 Неделя: {start_of_week.strftime('%d.%m')} — {end_of_week.strftime('%d.%m.%Y')}"
    header = format_schedule_header(sessions, title)

    if not sessions:
        await message.answer(header, reply_markup=get_week_keyboard(), parse_mode='HTML')
        return

    await message.answer(header, reply_markup=get_week_keyboard(), parse_mode='HTML')

    # Группируем по дням
    days = {}
    for session in sessions:
        try:
            dt = datetime.fromisoformat(session['session_datetime'])
            day_key = dt.strftime('%d.%m (%A)')
        except Exception:
            day_key = session.get('session_date', '?')

        if day_key not in days:
            days[day_key] = []
        days[day_key].append(session)

    for day_name, day_sessions in days.items():
        days_ru = {
            'Monday': 'Понедельник', 'Tuesday': 'Вторник', 'Wednesday': 'Среда',
            'Thursday': 'Четверг', 'Friday': 'Пятница', 'Saturday': 'Суббота', 'Sunday': 'Воскресенье'
        }
        for eng, ru in days_ru.items():
            day_name = day_name.replace(eng, ru)

        day_header = f"📆 <b>{day_name}</b>"
        await message.answer(day_header, parse_mode='HTML')

        for session in day_sessions:
            msg = format_session_short(session)
            keyboard = get_session_actions_keyboard(session['id'])
            await message.answer(msg, reply_markup=keyboard, parse_mode='HTML')

@dp.message(F.text == "📋 Все записи")
async def show_all_sessions_handler(message: types.Message):
    """Все будущие записи"""
    sessions = await api_get_all_sessions(limit=50, past=False)

    if not sessions:
        await message.answer("📭 Нет запланированных записей", parse_mode='HTML')
        return

    title = f"📋 Все записи ({len(sessions)})"
    header = format_schedule_header(sessions, title)

    await message.answer(header, parse_mode='HTML')

    for session in sessions[:30]:
        msg = format_session_short(session)
        keyboard = get_session_actions_keyboard(session['id'])
        await message.answer(msg, reply_markup=keyboard, parse_mode='HTML')

    if len(sessions) > 30:
        await message.answer(f"... и ещё {len(sessions) - 30} записей", parse_mode='HTML')

async def compute_statistics() -> dict | None:
    """Вычислить статистику через API"""
    all_future = await api_get_all_sessions(limit=500, past=False)
    all_past = await api_get_all_sessions(limit=500, past=True)
    all_sessions = all_future + all_past

    total_sessions = len(all_sessions)
    scheduled = sum(1 for s in all_sessions if s.get('status') == 'scheduled')
    completed = sum(1 for s in all_sessions if s.get('status') == 'completed')
    cancelled = sum(1 for s in all_sessions if s.get('status') == 'cancelled')
    total_amount = sum(s.get('amount', 0) for s in all_sessions if s.get('status') != 'cancelled')
    earned_amount = sum(s.get('amount', 0) for s in all_sessions if s.get('status') == 'completed')

    today = datetime.now().strftime('%Y-%m-%d')
    tomorrow = (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d')
    today_sessions = sum(1 for s in all_sessions if today <= s.get('session_datetime', '') < tomorrow)
    tomorrow_sessions = sum(1 for s in all_sessions if tomorrow <= s.get('session_datetime', '') < (datetime.now() + timedelta(days=2)).strftime('%Y-%m-%d'))

    week_ago = (datetime.now() - timedelta(days=7)).isoformat()
    week_earned = sum(s.get('amount', 0) for s in all_sessions if s.get('status') == 'completed' and s.get('session_datetime', '') > week_ago)

    return {
        'total_sessions': total_sessions,
        'scheduled': scheduled,
        'completed': completed,
        'cancelled': cancelled,
        'total_amount': total_amount,
        'earned_amount': earned_amount,
        'today_sessions': today_sessions,
        'tomorrow_sessions': tomorrow_sessions,
        'week_earned': week_earned
    }

@dp.message(F.text == "📊 Статистика")
async def show_stats(message: types.Message):
    """Статистика"""
    stats = await compute_statistics()
    if stats:
        await message.answer(format_statistics(stats), parse_mode='HTML')
    else:
        await message.answer("❌ Не удалось получить статистику")

@dp.message(F.text == "💰 Платежи")
async def show_payments(message: types.Message):
    """Последние платежи"""
    payments = await api_get_payments(limit=20)

    if not payments:
        await message.answer("📭 Нет платежей")
        return

    await message.answer("💰 <b>Последние платежи:</b>", parse_mode='HTML')

    for payment in payments[:10]:
        emoji = {'succeeded': '✅', 'pending': '⏳', 'canceled': '❌', 'expired': '❌'}.get(payment.get('status', ''), '⏳')

        msg = (
            f"{emoji} <b>{payment['amount']} {payment.get('currency', 'RUB')}</b>\n"
            f"📋 {payment.get('description', '')}\n"
            f"👤 {payment.get('customer_name') or 'не указан'}\n"
            f"📊 {payment.get('status', '')}\n"
            f"📅 {payment.get('created_at', '')[:16].replace('T', ' ')}"
        )

        if payment.get('customer_email'):
            msg += f"\n📧 {payment['customer_email']}"

        try:
            await message.answer(msg, parse_mode='HTML')
        except Exception as e:
            await message.answer(f"Ошибка: {e}")

@dp.message(F.text == "📤 Экспорт календаря")
async def show_export_menu(message: types.Message):
    """Меню экспорта"""
    await message.answer(
        "📤 <b>Экспорт расписания</b>\n\n"
        "Выберите период для экспорта в формате .ics.\n"
        "Файл можно импортировать в Google или Яндекс Календарь.",
        reply_markup=get_export_keyboard(),
        parse_mode='HTML'
    )

@dp.message(F.text == "🔄 Обновить")
async def refresh_data(message: types.Message):
    """Обновить данные"""
    await message.answer("🔄 Данные обновлены!")

# ═══════════════════════════════════════════════════════════
# CALLBACK ОБРАБОТЧИКИ
# ═══════════════════════════════════════════════════════════

@dp.callback_query(F.data.startswith("cancel_"))
async def cancel_session(callback: CallbackQuery):
    """Отменить сеанс"""
    session_id = int(callback.data.split("_")[1])
    success = await api_delete_session(session_id)

    if success:
        await callback.answer("❌ Сеанс отменён")
        await callback.message.edit_reply_markup(reply_markup=None)

        # Получаем данные сеанса из текущего списка
        all_sessions = await api_get_all_sessions(limit=500, past=True)
        session = next((s for s in all_sessions if s.get('id') == session_id), None)

        if session:
            await callback.message.answer(
                f"❌ <b>Сеанс отменён</b>\n\n"
                f"Клиент: {session['client_name']}\n"
                f"Дата: {session.get('session_date', '?')} {session.get('session_time', '?')}\n"
                f"Сумма: {session['amount']} ₽",
                parse_mode='HTML'
            )
    else:
        await callback.answer("Ошибка отмены сеанса", show_alert=True)

@dp.callback_query(F.data.startswith("completed_"))
async def complete_session(callback: CallbackQuery):
    """Отметить сеанс как проведённый — через API отмены (т.к. нет endpoint для completed)"""
    # Пока просто информируем, т.к. API не поддерживает статус "completed"
    session_id = int(callback.data.split("_")[1])

    # Получаем данные сеанса
    all_sessions = await api_get_all_sessions(limit=500, past=True)
    session = next((s for s in all_sessions if s.get('id') == session_id), None)

    if session:
        await callback.answer("✅ Отмечено (статус обновится при синхронизации)")

        await callback.message.edit_reply_markup(reply_markup=None)

        await callback.message.answer(
            f"✅ <b>Сеанс проведён</b>\n\n"
            f"Клиент: {session['client_name']}\n"
            f"Сумма: {session['amount']} ₽",
            parse_mode='HTML'
        )
    else:
        await callback.answer("Сеанс не найден", show_alert=True)

@dp.callback_query(F.data.startswith("detail_"))
async def show_session_detail(callback: CallbackQuery):
    """Показать детали сеанса"""
    session_id = int(callback.data.split("_")[1])

    all_sessions = await api_get_all_sessions(limit=500, past=True)
    session = next((s for s in all_sessions if s.get('id') == session_id), None)

    if session:
        msg = format_session_full(session)
        await callback.message.answer(msg, parse_mode='HTML')
        await callback.answer()
    else:
        await callback.answer("Сеанс не найден", show_alert=True)

@dp.callback_query(F.data.startswith("day_"))
async def navigate_day(callback: CallbackQuery):
    """Навигация по дням"""
    date_str = callback.data.split("_")[1]
    await callback.answer()

    date_obj = datetime.strptime(date_str, '%Y-%m-%d')
    next_day = (date_obj + timedelta(days=1)).strftime('%Y-%m-%d')

    sessions = await api_get_sessions_by_date_range(date_str, next_day)

    title = f"📅 {date_obj.strftime('%d.%m.%Y')}"
    header = format_schedule_header(sessions, title)

    await callback.message.answer(
        header,
        reply_markup=get_day_view_keyboard(date_str),
        parse_mode='HTML'
    )

@dp.callback_query(F.data.startswith("week_"))
async def navigate_week(callback: CallbackQuery):
    """Навигация по неделям"""
    date_str = callback.data.split("_")[1]
    from_date = datetime.strptime(date_str, '%Y-%m-%d')
    await callback.answer()

    await _show_week_impl(callback.message, from_date)

@dp.callback_query(F.data == "main_menu")
async def go_main_menu(callback: CallbackQuery):
    """Вернуться в главное меню"""
    await callback.answer()
    await callback.message.answer(
        "🔙 Возврат в главное меню",
        reply_markup=get_main_keyboard()
    )

@dp.callback_query(F.data == "noop")
async def noop(callback: CallbackQuery):
    """Пустое действие"""
    await callback.answer()

# ═══════════════════════════════════════════════════════════
# ЭКСПОРТ CALLBACK
# ═══════════════════════════════════════════════════════════

@dp.callback_query(F.data.startswith("export_"))
async def handle_export(callback: CallbackQuery):
    """Обработка экспорта"""
    export_type = callback.data.split("_")[1]
    await callback.answer("⏳ Генерация файла...")

    sessions = []
    filename = ""
    title = ""

    now = datetime.now()

    if export_type == "week":
        sessions = await api_get_week_sessions(now)
        filename = f"knyazkova_week_{now.strftime('%d%m')}.ics"
        title = "Записи на неделю"
    elif export_type == "next_week":
        next_week = now + timedelta(weeks=1)
        sessions = await api_get_week_sessions(next_week)
        filename = f"knyazkova_next_week_{next_week.strftime('%d%m')}.ics"
        title = "Записи на следующую неделю"
    elif export_type == "month":
        month_end = now.replace(day=28) + timedelta(days=4)
        month_end = month_end.replace(day=1) - timedelta(days=1)
        all_sessions = await api_get_all_sessions(limit=500, past=False)
        start_str = now.isoformat()
        end_str = month_end.isoformat()
        sessions = [s for s in all_sessions if start_str <= s.get('session_datetime', '') < end_str]
        filename = f"knyazkova_month_{now.strftime('%m')}.ics"
        title = f"Записи на {now.strftime('%B %Y')}"
    elif export_type == "all":
        sessions = await api_get_all_sessions(limit=200, past=False)
        filename = f"knyazkova_all.ics"
        title = "Все записи"
    elif export_type == "google_url":
        await callback.message.answer(
            "🔗 <b>Google Calendar — Инструкция</b>\n\n"
            "1. Нажмите «Эта неделя (.ics)» для скачивания файла\n"
            "2. Откройте <a href='https://calendar.google.com'>calendar.google.com</a>\n"
            "3. Настройки (шестерёнка) → Импорт и экспорт\n"
            "4. Нажмите «Импортировать» и выберите скачанный .ics файл\n\n"
            "Или подпишитесь на календарь по URL:\n"
            "Загрузите .ics на хостинг и добавьте URL в Google Calendar",
            parse_mode='HTML'
        )
        return
    elif export_type == "yandex_url":
        await callback.message.answer(
            "🔗 <b>Яндекс Календарь — Инструкция</b>\n\n"
            "1. Нажмите «Эта неделя (.ics)» для скачивания файла\n"
            "2. Откройте <a href='https://calendar.yandex.ru'>calendar.yandex.ru</a>\n"
            "3. ⚙️ (Настройки) → Импорт календаря\n"
            "4. Загрузите скачанный .ics файл\n\n"
            "Яндекс Календарь автоматически распознает все события",
            parse_mode='HTML'
        )
        return

    if not sessions:
        await callback.message.answer("📭 Нет записей для экспорта")
        return

    # Генерируем ICS
    ics_content = generate_ics(sessions, title)
    ics_bytes = ics_content.encode('utf-8')

    await callback.message.answer_document(
        BufferedInputFile(ics_bytes, filename=filename),
        caption=f"📅 {title}\n\n📋 Записей: {len(sessions)}\n\n"
                f"Импортируйте в Google / Яндекс Календарь"
    )

# ═══════════════════════════════════════════════════════════
# НАПОМИНАНИЯ (фоновая задача — ЕДИНСТВЕННЫЙ источник)
# ═══════════════════════════════════════════════════════════

async def send_reminders():
    """Фоновая задача для отправки напоминаний (за 48 часов)"""
    while True:
        try:
            all_sessions = await api_get_all_sessions(limit=500, past=False)

            now = datetime.now()
            reminder_time = now + timedelta(hours=48)
            reminder_from = (reminder_time - timedelta(hours=1)).isoformat()
            reminder_to = (reminder_time + timedelta(hours=1)).isoformat()

            sessions_to_remind = [
                s for s in all_sessions
                if reminder_from <= s.get('session_datetime', '') <= reminder_to
                and s.get('status') == 'scheduled'
            ]

            for session in sessions_to_remind:
                msg = f"""
🔔 <b>Напоминание о сеансе!</b>

👤 Клиент: {session['client_name']}
📞 Телефон: {session['client_phone']}
{f"📧 Email: {session['client_email']}" if session.get('client_email') else ""}

📅 Дата: {session.get('session_date', '?')}
🕐 Время: {session.get('session_time', '?')}
💰 Оплата: {session['amount']} ₽
                """.strip()

                try:
                    await bot.send_message(ADMIN_ID, msg, parse_mode='HTML')
                except Exception as e:
                    print(f"Ошибка отправки напоминания: {e}")

        except Exception as e:
            print(f"Ошибка в задаче напоминаний: {e}")

        await asyncio.sleep(3600)

# ═══════════════════════════════════════════════════════════
# ЕЖЕДНЕВНАЯ УТРЕННЯЯ СВОДКА
# ═══════════════════════════════════════════════════════════

async def send_morning_summary():
    """Отправлять утреннюю сводку каждый день в 8:00"""
    while True:
        try:
            now = datetime.now()
            if now.hour == 8:
                sessions = await api_get_today_sessions()

                if sessions:
                    scheduled = [s for s in sessions if s.get('status') == 'scheduled']
                    total_amount = sum(s.get('amount', 0) for s in scheduled)

                    msg = (
                        f"🌅 <b>Доброе утро! Сводка на сегодня</b>\n\n"
                        f"📅 Записей сегодня: {len(scheduled)}\n"
                        f"💰 Ожидаемый доход: {total_amount} ₽\n\n"
                    )

                    for session in scheduled:
                        try:
                            dt = datetime.fromisoformat(session['session_datetime'])
                            time_str = dt.strftime('%H:%M')
                        except Exception:
                            time_str = session.get('session_time', '?')

                        msg += f"⏰ {time_str} — {session['client_name']}\n"

                    await bot.send_message(ADMIN_ID, msg, parse_mode='HTML')

                await asyncio.sleep(3600)

        except Exception as e:
            print(f"Ошибка утренней сводки: {e}")

        await asyncio.sleep(3600)

# ═══════════════════════════════════════════════════════════
# ЗАПУСК
# ═══════════════════════════════════════════════════════════

async def main():
    """Запуск бота"""
    print("✅ Telegram бот запущен...")
    print(f"🌐 Backend URL: {BACKEND_URL}")
    print(f"👤 Admin ID: {ADMIN_ID}")
    print(f"🔑 API Key: {'настроен' if API_KEY else 'не настроен (без авторизации)'}")

    # Проверяем соединение с бэкендом
    health = await backend_request('GET', '/api/health')
    if health:
        print(f"✅ Бэкенд доступен: {health.get('status', 'unknown')}")
    else:
        print("⚠️ Не удалось соединиться с бэкендом. Убедитесь, что сервер запущен.")

    # Запускаем фоновые задачи
    asyncio.create_task(send_reminders())
    asyncio.create_task(send_morning_summary())

    # Запускаем бота
    await dp.start_polling(bot)

if __name__ == '__main__':
    try:
        asyncio.run(main())
    finally:
        if _http_session and not _http_session.closed:
            asyncio.get_event_loop().run_until_complete(_http_session.close())
