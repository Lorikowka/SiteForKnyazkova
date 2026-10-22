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

## Стек

- **Fastify 5** (ESM) — HTTP-сервер и роутинг;
- **better-sqlite3** — синхронный доступ к SQLite (WAL);
- **zod** — валидация входных данных;
- **pino** — структурированные логи;
- **nodemailer**, **@fastify/helmet**, **@fastify/cors**, **@fastify/rate-limit**,
  **@fastify/static**.

Проект — чистый ESM (`"type": "module"`), Node.js ≥ 20.

## Структура

```
backend/
├── server.js            # entrypoint: listen + graceful shutdown
├── config.json          # услуги, цены, расписание
├── diplomas.json        # список дипломов для галереи
├── security-check.js    # скрипт проверки безопасности
└── src/
    ├── app.js           # сборка приложения (плагины, статика, обработчики ошибок)
    ├── config/          # env (zod-валидация) + собранная конфигурация
    ├── db/              # соединение, миграции, репозитории
    ├── domain/          # доменная логика: каталог услуг, слоты расписания
    ├── controllers/     # payments, sessions, schedule, reviews, services, admin
    ├── routes/          # монтирование под /api/* и zod-схемы
    ├── services/        # ЮKassa, email, уведомления
    ├── middleware/      # auth, rateLimit
    ├── lib/             # security, sessionBooking, vkNotifier, text
    └── utils/           # logger, errors
```

## Конфигурация

Переменные окружения читаются и валидируются через `src/config/env.js`
(zod). Список переменных — в корневом [`.env.example`](../.env.example).

Ключевые:

- `PORT` (по умолчанию `1488`), `SITE_URL`, `MOCK_MODE`;
- `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY`;
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
npm test                 # 21 интеграционная проверка
npm run security:check
```

## Заметки о безопасности

- Секреты — только в `.env` (файл в `.gitignore`).
- Публичные эндпоинты лимитированы (`src/middleware/rateLimit.js`).
- Ввод валидируется (zod) и санитизируется.
- Вебхук ЮKassa проверяется запросом статуса платежа через API; сумма, валюта и ID сверяются с БД.

### Восстановление оплаты и запись

Успешная оплата создаёт запись на сервере по сохранённым данным. Вебхук,
проверка статуса клиентом и фоновая сверка используют один идемпотентный обработчик.
Повторный `confirm-booking` возвращает существующую запись; поля услуги и даты
из тела этого запроса не меняют оплаченный заказ.

При обычном запуске сервера незавершённые платежи сверяются с ЮKassa каждую минуту.
Резерв освобождается после подтверждённой отмены или явного отказа в создании.
Тайм-аут/HTTP 5xx не означает отмену: запрос создания повторяется с тем же ключом
идемпотентности и данными, пока возраст платежа меньше 23 часов.
Если результат неизвестен дольше, либо у старой записи нет данных для безопасного
повтора, сервер пишет `requires manual provider reconciliation` в журнал и
сохраняет резерв. Такие платежи нужно сверить вручную с кабинетом ЮKassa;
автоматическое освобождение может привести к продаже уже оплаченного места.
Фоновая сверка требует постоянно работающего процесса; на serverless полагайтесь
на вебхуки и отдельный планировщик. `YOOKASSA_WEBHOOK_SECRET` больше не используется.

Проверка: `npm run check` (основные тесты и регрессионные сценарии с имитацией API).
Проверки доступа ботов без SDK: `python ../bots-common/test_access.py` из `backend`.
Перед production проверьте уведомление на тестовом магазине ЮKassa по
[официальной инструкции](https://yookassa.ru/developers/using-api/webhooks).
- Логи не содержат секретов и платёжных данных целиком.
