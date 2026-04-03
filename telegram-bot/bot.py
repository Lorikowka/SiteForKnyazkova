"""
═══════════════════════════════════════════════════════════
🤖 TELEGRAM БОТ для просмотра записей и напоминаний
═══════════════════════════════════════════════════════════
Психолог Екатерина Князькова
"""

import os
import asyncio
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import Command, CommandStart
from aiogram.types import ReplyKeyboardMarkup, KeyboardButton, InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.utils.keyboard import InlineKeyboardBuilder
import aiohttp

# ═══════════════════════════════════════════════════════════
# НАСТРОЙКИ
# ═══════════════════════════════════════════════════════════

# Токен бота (получить у @BotFather)
BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN', 'YOUR_BOT_TOKEN_HERE')

# ID администратора (ваш Telegram ID - узнать у @userinfobot)
ADMIN_ID = int(os.getenv('TELEGRAM_ADMIN_ID', '0'))

# URL backend API
BACKEND_URL = os.getenv('BACKEND_URL', 'http://localhost:1488')

# Путь к базе данных
DB_PATH = Path(__file__).parent.parent / 'backend' / 'data' / 'payments.db'

# ═══════════════════════════════════════════════════════════
# ИНИЦИАЛИЗАЦИЯ
# ═══════════════════════════════════════════════════════════

bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()

# ═══════════════════════════════════════════════════════════
# КЛАВИАТУРЫ
# ═══════════════════════════════════════════════════════════

def get_main_keyboard() -> ReplyKeyboardMarkup:
    """Главное меню бота"""
    kb = [
        [KeyboardButton(text="📅 Ближайшие сеансы"), KeyboardButton(text="📊 Статистика")],
        [KeyboardButton(text="💰 Платежи"), KeyboardButton(text="🔔 Напоминания")],
        [KeyboardButton(text="🔄 Обновить")]
    ]
    return ReplyKeyboardMarkup(keyboard=kb, resize_keyboard=True)

def get_session_actions_keyboard(session_id: int) -> InlineKeyboardMarkup:
    """Кнопки действий для сеанса"""
    builder = InlineKeyboardBuilder()
    builder.button(text="❌ Отменить", callback_data=f"cancel_{session_id}")
    builder.button(text="✅ Проведён", callback_data=f"completed_{session_id}")
    builder.adjust(2)
    return builder.as_markup()

def get_payments_keyboard() -> InlineKeyboardMarkup:
    """Кнопки для фильтрации платежей"""
    builder = InlineKeyboardBuilder()
    builder.button(text="Все", callback_data="payments_all")
    builder.button(text="Успешные", callback_data="payments_success")
    builder.button(text="Ожидают", callback_data="payments_pending")
    builder.adjust(3)
    return builder.as_markup()

# ═══════════════════════════════════════════════════════════
# ПРЯМОЙ ДОСТУП К БД
# ═══════════════════════════════════════════════════════════

def get_db_connection():
    """Подключение к SQLite"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def get_all_sessions(limit: int = 20, past: bool = False):
    """Получить все сеансы из БД"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    now = datetime.now().isoformat()
    
    if past:
        cursor.execute("""
            SELECT * FROM sessions 
            WHERE session_datetime < ?
            ORDER BY session_datetime DESC 
            LIMIT ?
        """, (now, limit))
    else:
        cursor.execute("""
            SELECT * FROM sessions 
            WHERE session_datetime >= ?
            ORDER BY session_datetime ASC 
            LIMIT ?
        """, (now, limit))
    
    rows = cursor.fetchall()
    conn.close()
    return rows

def get_session_by_id(session_id: int):
    """Получить сеанс по ID"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM sessions WHERE id = ?", (session_id,))
    row = cursor.fetchone()
    conn.close()
    return row

def update_session_status(session_id: int, status: str):
    """Обновить статус сеанса"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE sessions SET status = ? WHERE id = ?", (status, session_id))
    conn.commit()
    changes = cursor.rowcount
    conn.close()
    return changes

def delete_session(session_id: int):
    """Удалить сеанс"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
    conn.commit()
    changes = cursor.rowcount
    conn.close()
    return changes

def get_all_payments(limit: int = 50):
    """Получить все платежи"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT * FROM payments 
        ORDER BY created_at DESC 
        LIMIT ?
    """, (limit,))
    rows = cursor.fetchall()
    conn.close()
    return rows

def get_statistics():
    """Получить статистику"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Всего сеансов
    cursor.execute("SELECT COUNT(*) FROM sessions")
    total_sessions = cursor.fetchone()[0]
    
    # Запланировано
    cursor.execute("SELECT COUNT(*) FROM sessions WHERE status = 'scheduled'")
    scheduled = cursor.fetchone()[0]
    
    # Проведено
    cursor.execute("SELECT COUNT(*) FROM sessions WHERE status = 'completed'")
    completed = cursor.fetchone()[0]
    
    # Отменено
    cursor.execute("SELECT COUNT(*) FROM sessions WHERE status = 'cancelled'")
    cancelled = cursor.fetchone()[0]
    
    # Общая сумма
    cursor.execute("SELECT SUM(amount) FROM sessions WHERE status != 'cancelled'")
    total_amount = cursor.fetchone()[0] or 0
    
    # Сегодня
    today = datetime.now().strftime('%Y-%m-%d')
    cursor.execute("""
        SELECT COUNT(*) FROM sessions 
        WHERE date(session_datetime) = ?
    """, (today,))
    today_sessions = cursor.fetchone()[0]
    
    conn.close()
    
    return {
        'total_sessions': total_sessions,
        'scheduled': scheduled,
        'completed': completed,
        'cancelled': cancelled,
        'total_amount': total_amount,
        'today_sessions': today_sessions
    }

# ═══════════════════════════════════════════════════════════
# ФОРМАТИРОВАНИЕ
# ═══════════════════════════════════════════════════════════

def format_session(session: sqlite3.Row, short: bool = False) -> str:
    """Форматировать сообщение о сеансе"""
    emoji = {'scheduled': '📅', 'completed': '✅', 'cancelled': '❌'}.get(session['status'], '⏳')
    
    # Форматируем дату
    try:
        dt = datetime.fromisoformat(session['session_datetime'])
        date_str = dt.strftime('%d.%m.%Y (%A)')
        time_str = dt.strftime('%H:%M')
    except:
        date_str = session['session_date']
        time_str = session['session_time']
    
    msg = f"""{emoji} <b>Сеанс #{session['id']}</b>

👤 <b>Клиент:</b> {session['client_name']}
📞 <b>Телефон:</b> {session['client_phone']}
{f"📧 <b>Email:</b> {session['client_email']}" if session['client_email'] else ""}

📋 <b>Услуга:</b> {session['service_name']}
📅 <b>Дата:</b> {date_str}
🕐 <b>Время:</b> {time_str}
💰 <b>Оплата:</b> {session['amount']} ₽
📊 <b>Статус:</b> {session['status']}
"""
    
    if session['comment']:
        msg += f"\n📝 <b>Комментарий:</b> {session['comment']}"
    
    if not short:
        msg += f"\n\n🆔 Payment ID: {session['payment_id']}"
    
    return msg

def format_payment(payment: sqlite3.Row) -> str:
    """Форматировать сообщение о платеже"""
    emoji = {'succeeded': '✅', 'pending': '⏳', 'failed': '❌'}.get(payment['status'], '⏳')
    
    msg = f"""{emoji} <b>Платёж #{payment['id'][:8]}...</b>

💰 <b>Сумма:</b> {payment['amount']} {payment['currency']}
📋 <b>Описание:</b> {payment['description']}
👤 <b>Клиент:</b> {payment['customer_name'] or 'не указан'}
📊 <b>Статус:</b> {payment['status']}

📅 <b>Создан:</b> {payment['created_at'][:16].replace('T', ' ')}
"""
    
    if payment['paid_at']:
        msg += f"✅ <b>Оплачен:</b> {payment['paid_at'][:16].replace('T', ' ')}"
    
    return msg

# ═══════════════════════════════════════════════════════════
# ОБРАБОТЧИКИ КОМАНД
# ═══════════════════════════════════════════════════════════

@dp.message(CommandStart())
async def cmd_start(message: types.Message):
    """Команда /start"""
    if message.from_user.id != ADMIN_ID:
        await message.answer("⛔ Доступ запрещён")
        return
    
    await message.answer(
        f"👋 <b>Приветствую!</b>\n\n"
        f"Я бот для управления записями психолога Екатерины Князьковой.\n\n"
        f"Используйте кнопки меню для управления записями.",
        reply_markup=get_main_keyboard()
    )

@dp.message(Command("help"))
async def cmd_help(message: types.Message):
    """Команда /help"""
    if message.from_user.id != ADMIN_ID:
        return
    
    await message.answer("""
<b>📚 Справка по командам:</b>

/start - Запустить бота
/help - Эта справка
/sessions - Ближайшие сеансы
/payments - Последние платежи
/stats - Статистика
/refresh - Обновить данные
    """)

@dp.message(Command("sessions"))
async def cmd_sessions(message: types.Message):
    """Команда /sessions - ближайшие сеансы"""
    if message.from_user.id != ADMIN_ID:
        return
    
    await show_sessions(message, past=False)

@dp.message(Command("payments"))
async def cmd_payments(message: types.Message):
    """Команда /payments - последние платежи"""
    if message.from_user.id != ADMIN_ID:
        return
    
    await show_payments(message)

@dp.message(Command("stats"))
async def cmd_stats(message: types.Message):
    """Команда /stats - статистика"""
    if message.from_user.id != ADMIN_ID:
        return
    
    stats = get_statistics()
    
    msg = f"""
📊 <b>Статистика записей</b>

📅 Всего сеансов: {stats['total_sessions']}
✅ Проведено: {stats['completed']}
📅 Запланировано: {stats['scheduled']}
❌ Отменено: {stats['cancelled']}

💰 Общая сумма: {stats['total_amount']} ₽
📅 Сегодня сеансов: {stats['today_sessions']}
    """
    
    await message.answer(msg.strip())

@dp.message(Command("refresh"))
async def cmd_refresh(message: types.Message):
    """Команда /refresh - обновить данные"""
    if message.from_user.id != ADMIN_ID:
        return
    
    await message.answer("🔄 Данные обновлены!")

# ═══════════════════════════════════════════════════════════
# ОБРАБОТЧИКИ КНОПОК
# ═══════════════════════════════════════════════════════════

@dp.message(F.text == "📅 Ближайшие сеансы")
async def show_upcoming_sessions(message: types.Message):
    """Показать ближайшие сеансы"""
    await show_sessions(message, past=False)

@dp.message(F.text == "📊 Статистика")
async def show_statistics(message: types.Message):
    """Показать статистику"""
    await cmd_stats(message)

@dp.message(F.text == "💰 Платежи")
async def show_payments_menu(message: types.Message):
    """Показать платежи"""
    await show_payments(message)

@dp.message(F.text == "🔔 Напоминания")
async def show_reminders_info(message: types.Message):
    """Информация о напоминаниях"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Сеансы без напоминания
    cursor.execute("""
        SELECT * FROM sessions 
        WHERE reminder_sent = 0 
        AND status = 'scheduled'
        AND session_datetime > datetime('now')
        ORDER BY session_datetime ASC
        LIMIT 10
    """)
    rows = cursor.fetchall()
    conn.close()
    
    if rows:
        msg = "🔔 <b>Сеансы без напоминания:</b>\n\n"
        for session in rows:
            msg += f"• {session['client_name']} - {session['session_date']} {session['session_time']}\n"
        await message.answer(msg)
    else:
        await message.answer("✅ Все напоминания настроены!")

@dp.message(F.text == "🔄 Обновить")
async def refresh_data(message: types.Message):
    """Обновить данные"""
    await message.answer("🔄 Данные обновлены!")

# ═══════════════════════════════════════════════════════════
# ФУНКЦИИ ПОКАЗА ДАННЫХ
# ═══════════════════════════════════════════════════════════

async def show_sessions(message: types.Message, past: bool = False):
    """Показать сеансы"""
    sessions = get_all_sessions(limit=20, past=past)
    
    if not sessions:
        await message.answer("📭 Нет сеансов" + (" в прошлом" if past else " на ближайшее время"))
        return
    
    title = "📅 <b>Ближайшие сеансы:</b>" if not past else "📁 <b>Прошедшие сеансы:</b>"
    await message.answer(title)
    
    for session in sessions:
        msg = format_session(session)
        keyboard = get_session_actions_keyboard(session['id']) if not past else None
        
        try:
            await message.answer(msg, reply_markup=keyboard, parse_mode='HTML')
        except Exception as e:
            await message.answer(f"Ошибка отображения: {e}")

async def show_payments(message: types.Message):
    """Показать платежи"""
    payments = get_all_payments(limit=20)
    
    if not payments:
        await message.answer("📭 Нет платежей")
        return
    
    await message.answer("💰 <b>Последние платежи:</b>")
    
    for payment in payments[:10]:
        msg = format_payment(payment)
        try:
            await message.answer(msg, parse_mode='HTML')
        except Exception as e:
            await message.answer(f"Ошибка: {e}")

# ═══════════════════════════════════════════════════════════
# ОБРАБОТКА CALLBACK (ДЕЙСТВИЯ С СЕАНСАМИ)
# ═══════════════════════════════════════════════════════════

@dp.callback_query(F.data.startswith("cancel_"))
async def cancel_session(callback: types.CallbackQuery):
    """Отменить сеанс"""
    session_id = int(callback.data.split("_")[1])
    session = get_session_by_id(session_id)
    
    if session:
        update_session_status(session_id, 'cancelled')
        await callback.answer("❌ Сеанс отменён")
        
        # Удаляем сообщение с кнопками
        await callback.message.edit_reply_markup(reply_markup=None)
        
        # Отправляем уведомление
        await callback.message.answer(
            f"❌ <b>Сеанс отменён</b>\n\n"
            f"Клиент: {session['client_name']}\n"
            f"Дата: {session['session_date']} {session['session_time']}",
            parse_mode='HTML'
        )
    else:
        await callback.answer("Сеанс не найден")

@dp.callback_query(F.data.startswith("completed_"))
async def complete_session(callback: types.CallbackQuery):
    """Отметить сеанс как проведённый"""
    session_id = int(callback.data.split("_")[1])
    session = get_session_by_id(session_id)
    
    if session:
        update_session_status(session_id, 'completed')
        await callback.answer("✅ Сеанс проведён")
        
        await callback.message.edit_reply_markup(reply_markup=None)
        
        await callback.message.answer(
            f"✅ <b>Сеанс проведён</b>\n\n"
            f"Клиент: {session['client_name']}\n"
            f"Сумма: {session['amount']} ₽",
            parse_mode='HTML'
        )
    else:
        await callback.answer("Сеанс не найден")

# ═══════════════════════════════════════════════════════════
# НАПОМИНАНИЯ (фоновая задача)
# ═══════════════════════════════════════════════════════════

async def send_reminders():
    """Фоновая задача для отправки напоминаний"""
    while True:
        try:
            conn = get_db_connection()
            cursor = conn.cursor()
            
            # Находим сеансы через ~48 часов
            now = datetime.now()
            reminder_time = now + timedelta(hours=48)
            reminder_from = (reminder_time - timedelta(hours=1)).isoformat()
            reminder_to = (reminder_time + timedelta(hours=1)).isoformat()
            
            cursor.execute("""
                SELECT * FROM sessions 
                WHERE session_datetime BETWEEN ? AND ?
                AND reminder_sent = 0
                AND status = 'scheduled'
            """, (reminder_from, reminder_to))
            
            sessions = cursor.fetchall()
            
            for session in sessions:
                # Отправляем напоминание
                msg = f"""
🔔 <b>Напоминание о сеансе!</b>

👤 Клиент: {session['client_name']}
📞 Телефон: {session['client_phone']}
{f"📧 Email: {session['client_email']}" if session['client_email'] else ""}

📅 Дата: {session['session_date']}
🕐 Время: {session['session_time']}
💰 Оплата: {session['amount']} ₽
                """.strip()
                
                try:
                    await bot.send_message(ADMIN_ID, msg, parse_mode='HTML')
                    
                    # Помечаем напоминание как отправленное
                    cursor.execute(
                        "UPDATE sessions SET reminder_sent = 1 WHERE id = ?",
                        (session['id'],)
                    )
                    conn.commit()
                except Exception as e:
                    print(f"Ошибка отправки напоминания: {e}")
            
            conn.close()
            
        except Exception as e:
            print(f"Ошибка в задаче напоминаний: {e}")
        
        # Проверяем каждый час
        await asyncio.sleep(3600)

# ═══════════════════════════════════════════════════════════
# ЗАПУСК
# ═══════════════════════════════════════════════════════════

async def main():
    """Запуск бота"""
    # Проверяем существование БД
    if not DB_PATH.exists():
        print(f"❌ База данных не найдена: {DB_PATH}")
        print("Убедитесь, что backend запущен и есть записи в БД")
        return
    
    print("✅ Telegram бот запущен...")
    print(f"📊 База данных: {DB_PATH}")
    print(f"👤 Admin ID: {ADMIN_ID}")
    
    # Запускаем фоновую задачу напоминаний
    asyncio.create_task(send_reminders())
    
    # Запускаем бота
    await dp.start_polling(bot)

if __name__ == '__main__':
    asyncio.run(main())
