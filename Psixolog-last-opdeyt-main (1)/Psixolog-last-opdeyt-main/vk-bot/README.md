# VK admin bot

Отдельный Python-бот для управления записями через сообщения ВК.

Бот не читает SQLite напрямую. Все данные он получает и изменяет через backend API:

- `GET /api/sessions`
- `GET /api/payments`
- `PATCH /api/sessions/:id/status`
- `DELETE /api/sessions/:id`
- `GET /api/reminders/due`
- `POST /api/reminders/:id/mark-sent`

## Запуск

```bash
cd vk-bot
python -m pip install -r requirements.txt
copy .env.example .env
python bot.py
```

В `.env` заполните:

- `VK_BOT_TOKEN` - токен сообщества ВК с правом на сообщения;
- `VK_GROUP_ID` - id сообщества без минуса;
- `VK_ADMIN_IDS` - id заказчика/админов через запятую;
- `BACKEND_URL` - адрес Node.js backend;
- `BOT_API_KEY` - ключ, совпадающий с `BOT_API_KEYS` или `API_KEY` в backend.
- `EVENT_WATCHER_ENABLED=true` - Python-бот сам отправляет уведомления о новых событиях.

Если включен Python watcher, оставьте `VK_BOT_TOKEN` в `backend/.env` пустым, иначе уведомления из backend и Python-бота будут дублироваться.

## Команды

- `/start`, `/menu` - меню;
- `/today` - записи на сегодня;
- `/tomorrow` - записи на завтра;
- `/week` - записи на текущую неделю;
- `/sessions` - будущие записи;
- `/payments` - последние платежи;
- `/stats` - статистика;
- `/complete ID` - отметить запись проведенной;
- `/cancel ID` - отменить запись.

Также работают кнопки меню: `Сегодня`, `Завтра`, `Неделя`, `Все записи`, `Платежи`, `Статистика`.
