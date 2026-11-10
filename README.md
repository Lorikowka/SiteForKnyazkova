# Сайт и система онлайн-записи — Екатерина Князькова

Подготовка сервера, HTTPS, резервные копии и ограничения запуска: [PRODUCTION.md](PRODUCTION.md).

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
| Backend | Node.js ≥ 20, Fastify 5 (ESM), SQLite (`better-sqlite3`), `@fastify/helmet`, `@fastify/rate-limit`, `@fastify/cors`, `@fastify/static`, zod, pino, nodemailer |
| Frontend | Vanilla HTML/CSS/JS (без сборки) |
| Боты | Python 3.11+ (`aiogram` 3 для Telegram, `vkbottle` 4 для VK, `aiohttp`) + общий пакет `bots-common` |
| Инфраструктура | Docker / docker-compose, nginx |

## Структура проекта

```
.
├── backend/            # API + раздача статики + SQLite
│   ├── server.js       # entrypoint (listen + graceful shutdown)
│   ├── config.json     # услуги, цены, расписание
│   ├── diplomas.json   # список дипломов для галереи
│   └── src/            # app.js, config, db, domain, controllers, routes, services, middleware, lib
├── frontend/           # HTML/CSS/JS (отдаётся backend или nginx)
│   ├── index.html
│   ├── payment-check.html
│   ├── payment-failed.html
│   ├── offer.html / privacy.html / consent.html
│   ├── css/  js/  images/
│   └── nginx.conf      # для контейнера: статика + прокси /api
├── bots-common/        # общее ядро Python-ботов (клиент backend, форматирование)
├── telegram-bot/       # админ-бот Telegram (aiogram 3)
├── vk-bot/             # админ-бот VK (vkbottle 4)
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
Общий код лежит в `bots-common/` — каждый бот подключает его автоматически
(локально через `sys.path`, в Docker — через `PYTHONPATH`).

## Переменные окружения

Основные настройки лежат в `.env` (см. `.env.example`).

| Переменная | Назначение |
|------------|-----------|
| `PORT` | Порт backend (по умолчанию `1488`) |
| `SITE_URL` | Публичный адрес сайта (для return_url и ссылок) |
| `MOCK_MODE` | `true` — оплата без обращения к ЮKassa |
| `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY` | Ключи магазина ЮKassa |
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
| POST | `/api/admin/webhook` | проверка через API ЮKassa | Вебхук ЮKassa |
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

Черновик записи хранится в `sessionStorage`, но сервер использует только данные, сохранённые при создании платежа. Вебхук и фоновая сверка создают запись даже без возврата клиента на сайт.
Если черновика нет, backend берёт данные из метаданных платежа.

## Деплой

### Предварительная версия без сервера

```bash
node scripts/build-preview.mjs
node --test test/frontend.test.mjs
```

Папку `dist/` можно разместить на статическом хостинге. Сборка берёт изображения
и текст из `frontend/`, каталог услуг из `backend/config.json`, а список дипломов
из `backend/diplomas.json`. Она показывает стоимость и галерею без API.
Запись, оплата и отправка отзывов исключены из этой сборки; сверху показано
уведомление о предварительной версии. Сервер, SQLite, `.env` и боты не публикуются.
Индексация предварительной версии отключена. Конфигурация `.openai/hosting.json`
относится только к этой статической версии в Sites.

Для настоящей записи и оплаты используйте постоянный сервер по инструкции ниже.
Проверенные в браузере дипломы поддерживают Tab, Enter, стрелки и Escape.

### Docker Compose (рекомендуется)

```bash
cp .env.example .env     # заполните ключи
docker compose up -d --build
```

- `backend` — API + БД, порт `1488`;
- `frontend` — nginx на порту `80`, проксирует `/api` на backend;
- `vk-bot`, `telegram-bot` — опциональные админ-боты (образ собирается из корня репозитория, чтобы был доступен `bots-common`).

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
