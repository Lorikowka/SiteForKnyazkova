# Сайт и система онлайн-записи — Екатерина Князькова

Сайт психолога с онлайн-записью на консультации, приёмом оплаты через ЮKassa
и администрированием через Telegram/VK-ботов.

## Возможности

- **Онлайн-запись** в три шага: данные клиента → выбор даты и времени → оплата.
- **Оплата через ЮKassa** с корректной обработкой успеха, отмены и повторной оплаты.
- **Защита от дублей**: занятый слот или дубликат групповой записи получает `409`.
- **Календарь**: расписание формируется на лету, занятые слоты помечаются.
- **Отзывы**: форма обратной связи с серверной валидацией.
- **Админ-боты** (Telegram и VK): просмотр записей, смена статусов, выходные, напоминания.
- **Уведомления**: e-mail клиенту (SMTP) и уведомления администратору (Telegram/VK).

## Стек

| Слой | Технологии |
|------|-----------|
| Backend | Node.js ≥ 18, Express 4, SQLite (`sqlite3`), Helmet, express-rate-limit, express-validator, winston, nodemailer |
| Frontend | Vanilla HTML/CSS/JS (без сборки) |
| Боты | Python 3.10+ (`python-telegram-bot` 21.x, `aiohttp`) |
| Инфраструктура | Docker / docker-compose, nginx |

## Структура проекта

```
.
├── backend/            # API + раздача статики + SQLite
│   ├── server.js
│   ├── database.js
│   ├── migrations.js
│   ├── config.json     # услуги, цены, расписание
│   ├── diplomas.json   # список дипломов для галереи
│   └── src/            # controllers, routes, middleware, services, utils
├── frontend/           # HTML/CSS/JS (отдаётся backend или nginx)
│   ├── index.html
│   ├── payment-check.html
│   ├── payment-failed.html
│   ├── offer.html / privacy.html / consent.html
│   ├── css/  js/  images/
│   └── nginx.conf      # для контейнера: статика + прокси /api
├── telegram-bot/       # админ-бот Telegram
├── vk-bot/             # админ-бот VK
├── docker-compose.yml
└── .env.example
```

## Быстрый старт

### 1. Backend (он же отдаёт фронтенд)

```bash
cd backend
npm install
cp ../.env.example .env      # Windows: copy ..\.env.example .env
npm start
```

Сайт и API будут доступны по адресу <http://localhost:1488>.
Проверка: <http://localhost:1488/api/health> → `{"status":"ok"}`.

Для разработки с автоперезапуском: `npm run dev`.

### 2. Frontend

Отдельная сборка не нужна — backend отдаёт папку `frontend/` как статику.
Для локальной разработки через Live Server запустите backend на порту `1488`,
и фронтенд автоматически обратится к нему (см. `frontend/js/config.js`).

### 3. Боты (опционально)

```bash
cd telegram-bot && pip install -r requirements.txt && python bot.py
cd vk-bot       && pip install -r requirements.txt && python bot.py
```

Перед запуском скопируйте `.env.example` в `.env` в соответствующей папке.

## Переменные окружения

Основные настройки лежат в `.env` (см. `.env.example`).

| Переменная | Назначение |
|------------|-----------|
| `PORT` | Порт backend (по умолчанию `1488`) |
| `SITE_URL` | Публичный адрес сайта (для return_url и ссылок) |
| `MOCK_MODE` | `true` — оплата без обращения к ЮKassa |
| `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY` | Ключи магазина ЮKassa |
| `YOOKASSA_WEBHOOK_SECRET` | Секрет для проверки подписи вебхука |
| `API_KEY` | Общий ключ для защищённых эндпоинтов |
| `ADMIN_API_KEYS` | Ключи админ-эндпоинтов (через запятую) |
| `BOT_API_KEYS` | Ключи эндпоинтов ботов (через запятую) |
| `ALLOWED_ORIGINS` | Список origin для CORS (через запятую) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_ID`, `TELEGRAM_CHAT_ID` | Telegram |
| `VK_BOT_TOKEN`, `VK_GROUP_ID`, `VK_ADMIN_IDS` | VK |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Почта |

## HTTP API

| Метод | Путь | Доступ | Описание |
|-------|------|--------|----------|
| GET | `/api/health` | — | Статус сервиса |
| GET | `/api/services` | — | Услуги, цены, расписание |
| GET | `/api/diplomas` | — | Дипломы для галереи |
| GET | `/api/schedule` | — | Доступные слоты |
| POST | `/api/reviews` | — | Отправить отзыв |
| POST | `/api/payments/create-payment` | rate-limit | Создать платёж |
| GET | `/api/payments/:id` | токен | Статус платежа |
| POST | `/api/payments/:id/confirm-booking` | токен | Подтвердить запись после оплаты |
| POST | `/api/payments/:id/discard` | токен | Отменить незавершённый платёж |
| POST | `/api/admin/webhook` | подпись | Вебхук ЮKassa |
| GET | `/api/sessions` | API-ключ | Список записей |
| POST | `/api/sessions` | API-ключ | Создать запись вручную |
| PATCH | `/api/sessions/:id/status` | API-ключ | Сменить статус |
| DELETE | `/api/sessions/:id` | API-ключ | Отменить запись |
| POST | `/api/sessions/cancel-booking` | токен | Отмена клиентом |
| GET | `/api/sessions/reminders/due` | API-ключ | Кому отправить напоминание |
| POST | `/api/sessions/reminders/:id/mark-sent` | API-ключ | Отметить напоминание |
| POST/DELETE | `/api/schedule/admin/block[/:date]` | API-ключ | Закрыть/открыть день |
| GET | `/api/schedule/admin/blocks` | API-ключ | Список закрытых дней |
| POST | `/api/admin/database/cleanup` | API-ключ | Очистка данных |

## Поток оплаты

```
Клиент заполняет форму → POST /api/payments/create-payment → ЮKassa
        ↓ (успех)                                   ↓ (отмена)
   payment-check.html                     payment-failed.html
        ↓
   POST /api/payments/:id/confirm-booking → создаётся запись
```

Черновик записи (ФИО, время, услуга) хранится в `sessionStorage` до подтверждения.
Если черновика нет, backend берёт данные из метаданных платежа.

## Деплой

### Docker Compose (рекомендуется)

```bash
cp .env.example .env     # заполните ключи
docker compose up -d --build
```

- `backend` — API + БД, порт `1488`;
- `frontend` — nginx на порту `80`, проксирует `/api` на backend;
- `vk-bot` — опционально.

### Раздельный хостинг

Если фронтенд и backend размещены на разных доменах, задайте адрес API
до подключения скриптов:

```html
<script>window.API_BASE_URL = 'https://api.example.ru';</script>
```

и добавьте этот домен в `ALLOWED_ORIGINS`.

## Тесты

```bash
cd backend
npm test          # интеграционные тесты API
npm run check     # синтаксис + тесты
npm run security:check
```

## Лицензия

MIT.
