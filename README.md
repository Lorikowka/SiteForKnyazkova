# 💳 Система оплаты и записи для психолога

Полнофункциональная система для приёма платежей и управления записями клиентов.

## 📁 Структура проекта

```
lorikowka.github.io-main/
├── backend/                 # Node.js backend
│   ├── server.js           # Основной сервер
│   ├── database.js         # Модуль базы данных
│   ├── .env                # Переменные окружения
│   └── data/               # SQLite база данных
│
├── frontend/               # Frontend (HTML/CSS/JS)
│   ├── index.html         # Главная страница
│   ├── payment-check.html # Проверка и подтверждение оплаты
│   ├── css/styles.css     # Стили
│   └── js/main.js         # Логика frontend
│
└── telegram-bot/          # Python Telegram бот
    ├── bot.py            # Основной код бота
    ├── requirements.txt  # Python зависимости
    └── .env              # Настройки бота
```

## 🚀 Быстрый старт

### 1. Backend (Node.js)

```bash
cd backend
npm install
npm run dev
```

Откройте http://localhost:1488

### 2. Telegram бот (Python)

```bash
cd telegram-bot

# Создать .env файл
copy .env.example .env

# Отредактировать .env (указать токен и ID)

# Установить зависимости
pip install -r requirements.txt

# Запустить
python bot.py
```

Или запустите `start-bot.bat`

## ⚙️ Настройка

### Backend (.env)

```env
PORT=1488
MOCK_MODE=false  # false для реальных платежей

# ЮKassa (тестовые ключи)
YOOKASSA_SHOP_ID=ваш_shop_id
YOOKASSA_SECRET_KEY=ваш_ключ

# Telegram
TELEGRAM_BOT_TOKEN=токен_бота
TELEGRAM_CHAT_ID=ваш_telegram_id
```

### Telegram бот (.env)

```env
TELEGRAM_BOT_TOKEN=токен_от_BotFather
TELEGRAM_ADMIN_ID=ваш_ID_от_userinfobot
BACKEND_URL=http://localhost:1488
```

## 📋 Получение ключей

### 1. Токен Telegram бота

1. Откройте [@BotFather](https://t.me/BotFather)
2. `/newbot` → введите имя и username
3. Скопируйте токен

### 2. Ваш Telegram ID

1. Откройте [@userinfobot](https://t.me/userinfobot)
2. Отправьте любое сообщение
3. Скопируйте ID

### 3. ЮKassa ключи

1. Зарегистрируйтесь в [ЮKassa](https://yookassa.ru/)
2. Перейдите в настройки → API-ключи
3. Скопируйте Shop ID и Secret Key

##  Функции

### Frontend
- ✅ Форма записи (3 шага)
- ✅ Выбор услуги и времени
- ✅ Оплата через ЮKassa
- ✅ Страница подтверждения

### Backend
- ✅ Приём платежей (ЮKassa/MOCK)
- ✅ SQLite база данных
- ✅ Сохранение сеансов
- ✅ Автоматические напоминания
- ✅ API для бота
- ✅ Админ-API для смены статуса сеанса и выборки напоминаний

### Telegram бот
- ✅ Просмотр сеансов
- ✅ Управление сеансами (отменить/завершить)
- ✅ Просмотр платежей
- ✅ Статистика
- ✅ Напоминания за 48 часов

Примечание: следующим этапом бот планируется заменить на VK-бота, поэтому дальнейшие интеграционные изменения лучше делать уже в новой VK-ветке.

## 🔔 Напоминания

Бот автоматически отправляет напоминания:
- За 48 часов до сеанса
- Проверка каждый час
- После отправки помечается как отправленное

## 📊 API Endpoints

| Endpoint | Метод | Описание |
|----------|-------|----------|
| `/api/create-payment` | POST | Создать платёж |
| `/api/payment/:id?token=...` | GET | Проверить статус платёжа по одноразовому токену |
| `/api/sessions` | GET | Получить сеансы |
| `/api/sessions/:id/status` | PATCH | Обновить статус сеанса |
| `/api/payments` | GET | Получить платежи |
| `/api/reminders/due` | GET | Получить сеансы для напоминаний |
| `/api/reminders/:id/mark-sent` | POST | Отметить напоминание как отправленное |
| `/api/health` | GET | Проверка сервера |
| `/api/webhook` | POST | Webhook ЮKassa |

## 🛠 Troubleshooting

### Порт 1488 занят
```bash
taskkill /F /IM node.exe
npm run dev
```

### Бот не запускается
1. Проверьте токен в `.env`
2. Убедитесь, что БД существует: `backend/data/payments.db`
3. Проверьте `TELEGRAM_ADMIN_ID`

### Платежи не работают
1. Проверьте ключи ЮKassa в `.env`
2. Установите `MOCK_MODE=true` для тестов
3. Проверьте логи backend

## 📝 Тестовые карты ЮKassa

- **Успешно:** `1111 1111 1111 1026`
- **Неуспешно:** `1111 1111 1111 0263`
- Любые будущие дата и CVC

## 📄 Лицензия

MIT
"# SiteForKnyazkova" 

## QA

Документация для ручной и технической проверки сайта: [QA_CHECKLIST.md](QA_CHECKLIST.md).
