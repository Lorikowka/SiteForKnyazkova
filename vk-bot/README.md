# VK admin bot

Отдельный Python-бот для управления записями через сообщения ВК.
Построен на **vkbottle 4** (асинхронный long-poll).

Бот не читает SQLite напрямую. Все данные он получает и изменяет через backend
API (общий клиент — пакет [`bots-common`](../bots-common/README.md)):

- `GET /api/health`
- `GET /api/sessions`
- `GET /api/payments`
- `POST /api/sessions` — добавить запись вручную
- `PATCH /api/sessions/:id/status`
- `DELETE /api/sessions/:id`
- `GET /api/sessions/reminders/due`
- `POST /api/sessions/reminders/:id/mark-sent`
- `GET /api/schedule/admin/blocks`
- `POST /api/schedule/admin/block` / `DELETE /api/schedule/admin/block/:date` — выходные

## Запуск

Бот использует локальный `.env` в папке `vk-bot` (имеет приоритет) и корневой
`.env` проекта.

1. Скопируйте `vk-bot/.env.example` в `vk-bot/.env` (или заполните секцию
   VK-бота в корневом `.env`).
2. Установите зависимости и запустите бота:

```bash
cd vk-bot
python -m pip install -r requirements.txt
python bot.py
```

### Переменные окружения

| Переменная | По умолчанию | Описание |
|------------|--------------|----------|
| `VK_BOT_TOKEN` | — | токен сообщества ВК с правом на сообщения (обязательно) |
| `VK_GROUP_ID` | `0` | id сообщества без минуса (обязательно) |
| `VK_ADMIN_IDS` | — | id админов через запятую; пусто = доступ всем |
| `BACKEND_URL` | `http://localhost:1488` | адрес Node.js backend |
| `BOT_API_KEY` / `API_KEY` | — | ключ к защищённым эндпоинтам |
| `REMINDERS_ENABLED` | `false` | напоминания о записях (каждый час) |
| `MORNING_SUMMARY_ENABLED` | `false` | утренняя сводка |
| `MORNING_SUMMARY_HOUR` | `8` | час отправки сводки |
| `EVENT_WATCHER_ENABLED` | `false` | бот сам опрашивает backend и шлёт уведомления о новых событиях |
| `EVENT_POLL_INTERVAL_SECONDS` | `30` | период опроса (минимум 10) |
| `DISABLE_SSL_VERIFY` | `false` | отключить проверку SSL (только при `CERTIFICATE_VERIFY_FAILED`) |

Если включён Python watcher (`EVENT_WATCHER_ENABLED=true`), оставьте
`VK_BOT_TOKEN` в `backend/.env` пустым, иначе уведомления из backend и
Python-бота будут дублироваться.

## Команды

- `/start`, `/menu` — меню;
- `/today`, `сегодня` — записи на сегодня;
- `/tomorrow`, `завтра` — записи на завтра;
- `/week`, `неделя` — записи на текущую неделю;
- `/sessions`, `все записи` — все записи за всё время;
- `/records`, `записи` — меню просмотра записей;
- `/payments`, `платежи` — последние платежи;
- `/stats`, `статистика` — статистика;
- `/complete ID` — отметить запись проведённой;
- `/cancel ID` — отменить запись;
- `/delete ID` — то же, что `/cancel`;
- `/add ДАТА ВРЕМЯ | Имя | Телефон | [услуга] | [комментарий]` — добавить запись;
- `/block YYYY-MM-DD [причина]` — закрыть день (выходной);
- `/unblock YYYY-MM-DD` — открыть день;
- `/blocks` — список закрытых дат;
- `/help`, `помощь` — справка.

Также работают кнопки меню: `Записи`, `Управление`, `Выходные`, `Платежи`,
`Статистика`, а внутри них — `Все записи`, `Ближайшие`, `Показать выходные`,
`Добавить выходной`, `Удалить выходной`, `Назад`.

## Docker

Образ собирается из корня репозитория (чтобы был доступен `bots-common`):

```bash
docker build -f vk-bot/Dockerfile -t vk-bot .
```

Или через `docker compose up vk-bot` из корня проекта. Логи и состояние
монтируются в `vk-bot/logs` и `vk-bot/data`.
