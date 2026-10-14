# Backend

API-сервер сайта: приём оплаты через ЮKassa, управление записями (SQLite),
раздача статики фронтенда, уведомления.

Общая документация — в корневом [`README.md`](../README.md), архитектура —
в [`ARCHITECTURE.md`](../ARCHITECTURE.md).

## Запуск

```bash
npm install
cp ../.env.example .env      # Windows: copy ..\.env.example .env
npm start                    # http://localhost:1488
npm run dev                  # автоперезапуск (node --watch)
```

## Скрипты

| Скрипт | Назначение |
|--------|-----------|
| `npm start` | Запуск сервера |
| `npm run dev` | Запуск с автоперезапуском |
| `npm test` | Интеграционные тесты API (временная БД) |
| `npm run check` | `node --check` + тесты |
| `npm run security:check` | Проверка базовых требований безопасности |

## Структура

```
backend/
├── server.js            # сборка приложения, middleware, статика, shutdown
├── database.js          # обёртка над sqlite3 (WAL, retry, методы домена)
├── migrations.js        # схема БД
├── config.json          # услуги, цены, расписание
├── diplomas.json        # список дипломов для галереи
├── security-check.js    # скрипт проверки безопасности
└── src/
    ├── controllers/     # payments, sessions, schedule, reviews, services, admin
    ├── routes/          # монтирование под /api/*
    ├── services/        # paymentService (ЮKassa), email, vk, notifications
    ├── middleware/      # auth, rateLimit, validation
    └── utils/           # config, logger
```

## Конфигурация

Все переменные окружения читаются через `src/utils/config.js`.
Список переменных — в корневом [`.env.example`](../.env.example).

Ключевые:

- `PORT` (по умолчанию `1488`), `SITE_URL`, `MOCK_MODE`;
- `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY`, `YOOKASSA_WEBHOOK_SECRET`;
- `API_KEY`, `ADMIN_API_KEYS`, `BOT_API_KEYS`, `ALLOWED_ORIGINS`;
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `VK_BOT_TOKEN`.

## API

Полная таблица эндпоинтов — в корневом `README.md`. Кратко:

- публичные: `/api/health`, `/api/services`, `/api/diplomas`, `/api/schedule`,
  `/api/reviews`, `/api/payments/create-payment`;
- по токену платежа: `/api/payments/:id`, `/:id/confirm-booking`, `/:id/discard`;
- по API-ключу (`X-API-Key` / `X-Bot-API-Key`): `/api/sessions*`,
  `/api/schedule/admin/*`, `/api/admin/*`.

## Проверка

```bash
npm test                 # 19 интеграционных проверок
npm run security:check
```

## Заметки о безопасности

- Секреты — только в `.env` (файл в `.gitignore`).
- Публичные эндпоинты лимитированы (`src/middleware/rateLimit.js`).
- Ввод валидируется (express-validator) и санитизируется.
- Вебхук ЮKassa проверяется по подписи (`YOOKASSA_WEBHOOK_SECRET`).
- Логи не содержат секретов и платёжных данных целиком.
