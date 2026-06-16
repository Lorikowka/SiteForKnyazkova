# Технологический стек проекта (Site For Knyazkova)

Этот файл содержит описание технологий, архитектуры и ключевых особенностей проекта.

## 🏗 Архитектура
Проект состоит из трех основных частей:
1.  **Backend:** Node.js сервер, управляющий бизнес-логикой, платежами и базой данных.
2.  **Frontend:** Статический веб-сайт на Vanilla JS/HTML/CSS.
3.  **Bots:** Админ-боты для Telegram и VK (на Python) для управления записями и уведомлений.

---

## 🛠 Технологии

### 🔙 Backend (Node.js)
- **Runtime:** Node.js (версия >= 18.0.0)
- **Framework:** [Express.js](https://expressjs.com/)
- **База данных:** SQLite ([sqlite3](https://www.npmjs.com/package/sqlite3))
  - Используется режим **WAL** для повышения конкурентности.
  - Реализована обертка `withRetry` для обработки блокировок базы данных.
- **Безопасность:**
  - [Helmet](https://helmetjs.github.io/) — защита заголовков HTTP.
  - [CORS](https://www.npmjs.com/package/cors) — управление доступом с разных доменов.
  - [Express Rate Limit](https://www.npmjs.com/package/express-rate-limit) — защита от брутфорса и DDoS.
  - [Express Validator](https://express-validator.github.io/docs/) — валидация входящих данных.
  - Авторизация по API-ключам для взаимодействия с ботами.
  - Проверка HMAC-подписей для вебхуков ЮKassa.
- **Логирование:** [Winston](https://www.npmjs.com/package/winston)
- **Уведомления:**
  - [Nodemailer](https://nodemailer.com/) — отправка email через SMTP.
  - Прямое взаимодействие с Telegram Bot API и VK API.
- **Интеграции:**
  - **ЮKassa:** Приём платежей через REST API.

### 🎨 Frontend (Vanilla)
- **HTML5 & CSS3:** Современная верстка, использование CSS переменных и Flexbox/Grid.
- **JavaScript:** Чистый JS (Vanilla JS) без фреймворков.
- **Шрифты:** Google Fonts (Sora).
- **Безопасность:** Строгая политика CSP (Content Security Policy).

### 🤖 Bots (Python)
- **Runtime:** Python 3.x
- **Telegram Bot:**
  - [python-telegram-bot](https://python-telegram-bot.org/) (v21.x)
  - [aiohttp](https://docs.aiohttp.org/) для HTTP-запросов к бэкенду.
- **VK Bot:**
  - [aiohttp](https://docs.aiohttp.org/) для работы с Long Poll и VK API.
- **Функционал:**
  - Просмотр и управление записями (подтверждение, отмена).
  - Статистика доходов.
  - Напоминания о предстоящих сеансах.
  - Блокировка/разблокировка дат в расписании.

---

## 📂 Структура проекта
- `/backend`: Исходный код сервера, миграции и логика работы с БД.
- `/frontend`: Статические файлы сайта.
- `/telegram-bot`: Код Telegram-бота и зависимости.
- `/vk-bot`: Код VK-бота и зависимости.
- `/backend/data`: Директория для файлов базы данных SQLite.

## 🚀 Команды разработки
- `npm start` (в `/backend`): запуск сервера.
- `npm run dev` (в `/backend`): запуск сервера в режиме разработки с автоперезагрузкой.
- `npm test` (в `/backend`): запуск тестов.
- `python bot.py` (в папках ботов): запуск ботов.
