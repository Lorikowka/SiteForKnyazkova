import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta

import vk_api
from dotenv import load_dotenv
from requests.exceptions import RequestException
from vk_api.longpoll import VkEventType, VkLongPoll
from vk_api.utils import get_random_id


load_dotenv()

TOKEN = os.getenv("VK_TOKEN") or os.getenv("VK_BOT_TOKEN")
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:1488").rstrip("/")
BOT_API_KEY = os.getenv("BOT_API_KEY") or os.getenv("API_KEY") or ""
SUBSCRIBERS_FILE = os.path.join(os.path.dirname(__file__), "subscribers.txt")

vk_session = vk_api.VkApi(token=TOKEN)
vk = vk_session.get_api()
longpoll = VkLongPoll(vk_session)
USER_STATE = {}

SERVICE_LABELS = {
    "Консультация": "consult",
    "Пакет 2": "consult-2",
    "Пакет 5": "consult-5",
    "Группа": "group",
}


def make_button(label, color="secondary"):
    return {"action": {"type": "text", "label": label}, "color": color}


def keyboard(rows, one_time=False):
    return {"one_time": one_time, "buttons": [[make_button(*button) for button in row] for row in rows]}


def main_keyboard():
    return keyboard([
        [("Записи", "primary"), ("Расписание", "primary")],
        [("Финансы", "secondary"), ("Помощь", "secondary")],
    ])


def back_keyboard():
    return keyboard([[("Назад", "secondary"), ("Меню", "secondary")]])


def bookings_keyboard():
    return keyboard([
        [("Сегодня", "primary"), ("Завтра", "primary")],
        [("Неделя", "secondary"), ("Все записи", "secondary")],
        [("Новая запись", "positive"), ("Отменить запись", "negative")],
        [("Меню", "secondary")],
    ])


def schedule_keyboard():
    return keyboard([
        [("Выходные", "negative"), ("Список выходных", "secondary")],
        [("Меню", "secondary")],
    ])


def finance_keyboard():
    return keyboard([
        [("Платежи", "primary")],
        [("Меню", "secondary")],
    ])


def write_msg(peer_id, message, kb=None):
    params = {
        "peer_id": peer_id,
        "message": message[:4000],
        "random_id": get_random_id(),
    }
    if kb:
        params["keyboard"] = json.dumps(kb, ensure_ascii=False)
    vk.messages.send(**params)


def backend_request(method, endpoint, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"}
    if BOT_API_KEY:
        headers["X-Bot-API-Key"] = BOT_API_KEY
        headers["X-API-Key"] = BOT_API_KEY

    request = urllib.request.Request(f"{BACKEND_URL}{endpoint}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="ignore")
        print(f"Backend error {method} {endpoint}: {error.code} {raw}")
    except Exception as error:
        print(f"Backend request failed {method} {endpoint}: {error}")
    return None


def load_subscribers():
    if not os.path.exists(SUBSCRIBERS_FILE):
        return set()
    with open(SUBSCRIBERS_FILE, "r", encoding="utf-8") as file:
        return {int(line.strip()) for line in file if line.strip().isdigit()}


def add_subscriber(user_id):
    subscribers = load_subscribers()
    if user_id in subscribers:
        return
    subscribers.add(user_id)
    with open(SUBSCRIBERS_FILE, "w", encoding="utf-8") as file:
        for subscriber_id in sorted(subscribers):
            file.write(f"{subscriber_id}\n")


def get_services_payload():
    data = backend_request("GET", "/api/services")
    return data if data and data.get("success") else {"services": [], "schedule": {}}


def get_services():
    return get_services_payload().get("services", [])


def get_schedule_config():
    return get_services_payload().get("schedule", {})


def service_by_id(service_id):
    for service in get_services():
        if service.get("id") == service_id:
            return service
    return {"id": service_id, "name": service_id, "price": 0}


def get_sessions(past=False, limit=100, start=None, end=None):
    params = {"past": str(past).lower(), "limit": str(limit)}
    if start:
        params["from"] = start
    if end:
        params["to"] = end
    data = backend_request("GET", f"/api/sessions?{urllib.parse.urlencode(params)}")
    return data.get("sessions", []) if data and data.get("success") else []


def get_payments(limit=20):
    data = backend_request("GET", f"/api/payments?limit={limit}")
    return data.get("payments", []) if data and data.get("success") else []


def delete_session(session_id):
    data = backend_request("DELETE", f"/api/sessions/{session_id}")
    return bool(data and data.get("success"))


def get_schedule(service_id):
    data = backend_request("GET", f"/api/schedule?days=45&serviceId={urllib.parse.quote(service_id)}")
    return data if data and data.get("success") else {"freeSlots": {}}


def get_unavailable_days():
    start = datetime.now().strftime("%Y-%m-%d")
    end = (datetime.now() + timedelta(days=60)).strftime("%Y-%m-%d")
    data = backend_request("GET", f"/api/admin/unavailable-days?from={start}&to={end}")
    return data.get("days", []) if data and data.get("success") else []


def set_unavailable_day(date):
    data = backend_request("POST", "/api/admin/unavailable-days", {"date": date, "reason": "Нерабочий день"})
    return bool(data and data.get("success"))


def delete_unavailable_day(date):
    data = backend_request("DELETE", f"/api/admin/unavailable-days/{date}")
    return bool(data and data.get("success"))


def create_session(payload):
    return backend_request("POST", "/api/sessions", payload)


def period(days_from_now=0, length=1):
    start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=days_from_now)
    return start.isoformat(), (start + timedelta(days=length)).isoformat()


def format_date(value):
    try:
        return datetime.strptime(value, "%Y-%m-%d").strftime("%d.%m.%Y")
    except ValueError:
        return value


def format_session(session):
    return "\n".join([
        f"Запись #{session.get('id')}",
        f"{format_date(session.get('session_date', ''))} в {session.get('session_time') or '-'}",
        f"Клиент: {session.get('client_name') or '-'}",
        f"Услуга: {session.get('service_name') or '-'}",
        f"Телефон: {session.get('client_phone') or '-'}",
        f"Статус: {session.get('status') or '-'}",
    ])


def send_sessions(peer_id, title, sessions):
    if not sessions:
        write_msg(peer_id, f"{title}\n\nЗаписей нет.", bookings_keyboard())
        return
    blocks = [title, f"Всего: {len(sessions)}"]
    blocks.extend(format_session(item) for item in sessions[:12])
    write_msg(peer_id, "\n\n".join(blocks), bookings_keyboard())


def send_payments(peer_id):
    payments = get_payments()
    if not payments:
        write_msg(peer_id, "Платежей нет.", finance_keyboard())
        return
    blocks = ["Последние платежи"]
    for payment in payments[:10]:
        blocks.append("\n".join([
            f"{payment.get('amount')} {payment.get('currency', 'RUB')}",
            f"Клиент: {payment.get('customer_name') or '-'}",
            f"Услуга: {payment.get('service_name') or payment.get('description') or '-'}",
            f"Статус: {payment.get('status') or '-'}",
        ]))
    write_msg(peer_id, "\n\n".join(blocks), finance_keyboard())


def date_buttons_from_schedule(service_id):
    free_slots = get_schedule(service_id).get("freeSlots", {})
    dates = sorted(key for key, slots in free_slots.items() if slots)[:8]
    rows = []
    for i in range(0, len(dates), 2):
        rows.append([(format_date(date), "primary") for date in dates[i:i + 2]])
    rows.append([("Назад", "secondary"), ("Меню", "secondary")])
    return dates, keyboard(rows)


def build_date_keyboard(dates):
    rows = []
    for i in range(0, len(dates), 2):
        rows.append([(format_date(date), "primary") for date in dates[i:i + 2]])
    rows.append([("Назад", "secondary"), ("Меню", "secondary")])
    return keyboard(rows)


def is_regular_weekend(date, schedule=None):
    schedule = schedule or get_schedule_config()
    if not schedule.get("excludeWeekends", True):
        return False
    try:
        return datetime.strptime(date, "%Y-%m-%d").weekday() >= 5
    except ValueError:
        return False


def date_buttons_for_available_days():
    blocked = {day.get("date") for day in get_unavailable_days()}
    schedule = get_schedule_config()
    dates = []
    cursor = datetime.now() + timedelta(days=1)
    checked = 0
    while len(dates) < 14 and checked < 120:
        date = cursor.strftime("%Y-%m-%d")
        if date not in blocked and not is_regular_weekend(date, schedule):
            dates.append(date)
        cursor += timedelta(days=1)
        checked += 1
    return dates, build_date_keyboard(dates)


def date_buttons_for_blocked_days():
    dates = [day.get("date") for day in get_unavailable_days() if day.get("date")]
    dates = sorted(dates)[:14]
    return dates, build_date_keyboard(dates)


def time_keyboard(service_id, date):
    slots = get_schedule(service_id).get("freeSlots", {}).get(date, [])
    rows = []
    for i in range(0, len(slots), 3):
        rows.append([(time, "primary") for time in slots[i:i + 3]])
    rows.append([("Назад", "secondary"), ("Меню", "secondary")])
    return slots, keyboard(rows)


def start_new_booking(peer_id, user_id):
    USER_STATE[user_id] = {"flow": "booking", "step": "service", "data": {}}
    write_msg(
        peer_id,
        "Создание новой записи\n\nВыберите услугу:",
        keyboard([
            [("Консультация", "primary"), ("Группа", "primary")],
            [("Пакет 2", "secondary"), ("Пакет 5", "secondary")],
            [("Назад", "secondary")],
        ]),
    )


def start_days(peer_id, user_id):
    USER_STATE[user_id] = {"flow": "days", "step": "action", "data": {}}
    write_msg(
        peer_id,
        "Управление нерабочими днями",
        keyboard([
            [("Отметить выходной", "negative"), ("Снять выходной", "positive")],
            [("Список выходных", "secondary"), ("Назад", "secondary")],
        ]),
    )


def start_cancel_booking(peer_id, user_id):
    sessions = [item for item in get_sessions(past=False, limit=30) if item.get("id")]
    if not sessions:
        write_msg(peer_id, "Будущих записей для отмены нет.", bookings_keyboard())
        return

    buttons = []
    labels = {}
    for session in sessions[:10]:
        label = f"#{session.get('id')} {format_date(session.get('session_date', ''))} {session.get('session_time')}"
        buttons.append([(label[:40], "negative")])
        labels[label[:40]] = session

    buttons.append([("Назад", "secondary"), ("Меню", "secondary")])
    USER_STATE[user_id] = {
        "flow": "cancel",
        "step": "select",
        "sessions": labels,
    }
    write_msg(peer_id, "Выберите запись для отмены:", keyboard(buttons))


def handle_booking_state(peer_id, user_id, text):
    state = USER_STATE[user_id]
    data = state["data"]

    if text in {"Назад", "Меню"}:
        USER_STATE.pop(user_id, None)
        write_msg(peer_id, "Главное меню", main_keyboard())
        return

    if state["step"] == "service":
        service_id = SERVICE_LABELS.get(text)
        if not service_id:
            write_msg(peer_id, "Выберите услугу кнопкой.", main_keyboard())
            return
        service = service_by_id(service_id)
        data.update({"serviceId": service_id, "serviceName": service.get("name") or text})
        dates, kb = date_buttons_from_schedule(service_id)
        if not dates:
            USER_STATE.pop(user_id, None)
            write_msg(peer_id, "Для этой услуги нет свободных дат.", main_keyboard())
            return
        state["step"] = "date"
        state["dates"] = {format_date(date): date for date in dates}
        write_msg(peer_id, "Выберите дату:", kb)
        return

    if state["step"] == "date":
        date = state.get("dates", {}).get(text)
        if not date:
            write_msg(peer_id, "Выберите дату кнопкой.", back_keyboard())
            return
        data["sessionDate"] = date
        slots, kb = time_keyboard(data["serviceId"], date)
        if not slots:
            write_msg(peer_id, "На эту дату свободного времени нет. Выберите другую дату.", back_keyboard())
            return
        state["step"] = "time"
        state["slots"] = set(slots)
        write_msg(peer_id, "Выберите время:", kb)
        return

    if state["step"] == "time":
        if text not in state.get("slots", set()):
            write_msg(peer_id, "Выберите время кнопкой.", back_keyboard())
            return
        data["sessionTime"] = text
        state["step"] = "name"
        write_msg(peer_id, "Введите имя клиента:", back_keyboard())
        return

    if state["step"] == "name":
        if len(text) < 2:
            write_msg(peer_id, "Имя слишком короткое. Введите имя клиента:", back_keyboard())
            return
        data["clientName"] = text
        state["step"] = "phone"
        write_msg(peer_id, "Введите телефон клиента:", back_keyboard())
        return

    if state["step"] == "phone":
        if len(text) < 5:
            write_msg(peer_id, "Телефон слишком короткий. Введите телефон клиента:", back_keyboard())
            return
        data["clientPhone"] = text
        state["step"] = "confirm"
        write_msg(
            peer_id,
            "\n".join([
                "Проверьте запись:",
                f"Клиент: {data['clientName']}",
                f"Телефон: {data['clientPhone']}",
                f"Услуга: {data['serviceName']}",
                f"Дата: {format_date(data['sessionDate'])}",
                f"Время: {data['sessionTime']}",
            ]),
            keyboard([[("Создать запись", "positive"), ("Отмена", "negative")]]),
        )
        return

    if state["step"] == "confirm":
        if text == "Отмена":
            USER_STATE.pop(user_id, None)
            write_msg(peer_id, "Создание записи отменено.", main_keyboard())
            return
        if text != "Создать запись":
            write_msg(peer_id, "Подтвердите создание кнопкой.", keyboard([[("Создать запись", "positive"), ("Отмена", "negative")]]))
            return
        result = create_session(data)
        USER_STATE.pop(user_id, None)
        if result and result.get("success"):
            write_msg(peer_id, f"Запись создана. ID: {result.get('sessionId')}", main_keyboard())
        else:
            write_msg(peer_id, "Не удалось создать запись. Возможно, слот уже занят.", main_keyboard())


def handle_days_state(peer_id, user_id, text):
    state = USER_STATE[user_id]
    data = state["data"]

    if text in {"Записи", "Расписание", "Финансы", "Помощь"}:
        USER_STATE.pop(user_id, None)
        handle_command(peer_id, user_id, text)
        return

    if text in {"Назад", "Меню"}:
        USER_STATE.pop(user_id, None)
        write_msg(peer_id, "Главное меню", main_keyboard())
        return

    if state["step"] == "action":
        if text == "Список выходных":
            USER_STATE.pop(user_id, None)
            days = get_unavailable_days()
            if not days:
                write_msg(peer_id, "Дополнительных нерабочих дней пока нет.", schedule_keyboard())
                return
            write_msg(peer_id, "\n".join(["Дополнительные нерабочие дни:"] + [format_date(day["date"]) for day in days]), schedule_keyboard())
            return
        if text not in {"Отметить выходной", "Снять выходной"}:
            USER_STATE.pop(user_id, None)
            write_msg(peer_id, "Выберите действие в разделе расписания.", schedule_keyboard())
            return
        data["action"] = "set" if text == "Отметить выходной" else "delete"
        if data["action"] == "set":
            dates, kb = date_buttons_for_available_days()
            empty_message = "Все ближайшие даты уже отмечены как нерабочие."
        else:
            dates, kb = date_buttons_for_blocked_days()
            empty_message = "Нерабочих дней пока нет."

        if not dates:
            USER_STATE.pop(user_id, None)
            write_msg(peer_id, empty_message, main_keyboard())
            return

        state["step"] = "date"
        state["dates"] = {format_date(date): date for date in dates}
        write_msg(peer_id, "Выберите дату:", kb)
        return

    if state["step"] == "date":
        date = state.get("dates", {}).get(text)
        if not date:
            write_msg(peer_id, "Выберите дату кнопкой.", back_keyboard())
            return
        ok = set_unavailable_day(date) if data.get("action") == "set" else delete_unavailable_day(date)
        USER_STATE.pop(user_id, None)
        if ok:
            action_text = "отмечен как нерабочий" if data.get("action") == "set" else "снова открыт для записи"
            write_msg(peer_id, f"{format_date(date)} {action_text}.", main_keyboard())
        else:
            write_msg(peer_id, "Не удалось обновить день.", main_keyboard())


def handle_cancel_state(peer_id, user_id, text):
    state = USER_STATE[user_id]

    if text in {"Назад", "Меню"}:
        USER_STATE.pop(user_id, None)
        show_bookings_menu(peer_id) if text == "Назад" else write_msg(peer_id, "Главное меню", main_keyboard())
        return

    if state["step"] == "select":
        session = state.get("sessions", {}).get(text)
        if not session:
            write_msg(peer_id, "Выберите запись кнопкой.", bookings_keyboard())
            return

        state["step"] = "confirm"
        state["session"] = session
        write_msg(
            peer_id,
            "\n".join([
                "Удалить эту запись из базы?",
                "",
                format_session(session),
            ]),
            keyboard([[("Да, удалить", "negative"), ("Не удалять", "secondary")]]),
        )
        return

    if state["step"] == "confirm":
        if text == "Не удалять":
            USER_STATE.pop(user_id, None)
            write_msg(peer_id, "Отмена удаления.", bookings_keyboard())
            return

        if text != "Да, удалить":
            write_msg(peer_id, "Подтвердите удаление кнопкой.", keyboard([[("Да, удалить", "negative"), ("Не удалять", "secondary")]]))
            return

        session = state.get("session", {})
        session_id = int(session.get("id", 0) or 0)
        USER_STATE.pop(user_id, None)
        if session_id and delete_session(session_id):
            write_msg(peer_id, f"Запись #{session_id} удалена из базы.", bookings_keyboard())
        else:
            write_msg(peer_id, "Не удалось удалить запись. Возможно, её уже нет.", bookings_keyboard())


def show_bookings_menu(peer_id):
    write_msg(peer_id, "Записи\n\nВыберите действие:", bookings_keyboard())


def show_schedule_menu(peer_id):
    write_msg(peer_id, "Расписание\n\nВыберите действие:", schedule_keyboard())


def show_finance_menu(peer_id):
    write_msg(peer_id, "Финансы\n\nВыберите действие:", finance_keyboard())


def handle_command(peer_id, user_id, text):
    lower = text.strip().lower()

    if lower in {"/start", "/menu", "меню", "помощь", "/help"}:
        USER_STATE.pop(user_id, None)
        write_msg(peer_id, "Главное меню\n\nВыберите раздел:", main_keyboard())
        return

    if lower in {"записи", "раздел записи"}:
        USER_STATE.pop(user_id, None)
        show_bookings_menu(peer_id)
        return

    if lower in {"расписание", "раздел расписание"}:
        USER_STATE.pop(user_id, None)
        show_schedule_menu(peer_id)
        return

    if lower in {"финансы", "раздел финансы"}:
        USER_STATE.pop(user_id, None)
        show_finance_menu(peer_id)
        return

    if user_id in USER_STATE:
        flow = USER_STATE[user_id].get("flow")
        if flow == "booking":
            handle_booking_state(peer_id, user_id, text)
            return
        if flow == "days":
            handle_days_state(peer_id, user_id, text)
            return
        if flow == "cancel":
            handle_cancel_state(peer_id, user_id, text)
            return

    if lower in {"новая запись", "/new"}:
        start_new_booking(peer_id, user_id)
    elif lower in {"отменить запись", "удалить запись", "/cancel"}:
        start_cancel_booking(peer_id, user_id)
    elif lower in {"выходные", "нерабочие дни", "/days"}:
        start_days(peer_id, user_id)
    elif lower in {"список выходных"}:
        days = get_unavailable_days()
        if not days:
            write_msg(peer_id, "Дополнительных нерабочих дней пока нет.", schedule_keyboard())
        else:
            write_msg(peer_id, "\n".join(["Дополнительные нерабочие дни:"] + [format_date(day["date"]) for day in days]), schedule_keyboard())
    elif lower in {"сегодня", "/today"}:
        start, end = period(0)
        send_sessions(peer_id, "Записи на сегодня", get_sessions(start=start, end=end, limit=100))
    elif lower in {"завтра", "/tomorrow"}:
        start, end = period(1)
        send_sessions(peer_id, "Записи на завтра", get_sessions(start=start, end=end, limit=100))
    elif lower in {"неделя", "/week"}:
        start, end = period(0, 7)
        send_sessions(peer_id, "Записи на 7 дней", get_sessions(start=start, end=end, limit=200))
    elif lower in {"все записи", "записи", "/sessions"}:
        send_sessions(peer_id, "Будущие записи", get_sessions(past=False, limit=200))
    elif lower in {"платежи", "/payments"}:
        send_payments(peer_id)
    else:
        write_msg(peer_id, "Не понял команду. Выберите раздел в меню.", main_keyboard())


if not TOKEN:
    raise RuntimeError("VK_TOKEN or VK_BOT_TOKEN is not configured")

while True:
    try:
        for event in longpoll.listen():
            if event.type == VkEventType.MESSAGE_NEW and event.to_me and event.text:
                add_subscriber(event.user_id)
                handle_command(event.peer_id, event.user_id, event.text.strip())
    except RequestException as error:
        print(f"VK long poll connection error: {error}. Reconnecting in 5 seconds...")
        time.sleep(5)
        longpoll = VkLongPoll(vk_session)
    except Exception as error:
        print(f"VK bot loop error: {error}. Reconnecting in 10 seconds...")
        time.sleep(10)
        longpoll = VkLongPoll(vk_session)
