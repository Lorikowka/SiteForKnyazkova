# Email-уведомления и обработка платежей

## Что изменилось

### ✅ При успешной оплате:
1. **Email клиенту** — автоматическое письмо с деталями записи
2. **Telegram уведомление** — владельцу сайта
3. **Сохранение в БД** — сеанс сохраняется

### ❌ При отмене/ошибке оплаты:
1. **НЕ сохраняется в БД** — сеанс НЕ создаётся
2. **Telegram уведомление** — владелец получает уведомление об отмене
3. **Email НЕ отправляется** — клиент не получает письмо

## Настройка Email (SMTP)

### Gmail:

1. **Включите двухфакторную аутентификацию** в Google аккаунте
2. **Создайте пароль приложения**:
   - Перейдите в https://myaccount.google.com/apppasswords
   - Выберите "Другое приложение"
   - Скопируйте сгенерированный пароль

3. **Добавьте в `.env`:**
   ```env
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=your_email@gmail.com
   SMTP_PASS=abcd efgh ijkl mnop  # Пароль приложения (без пробелов)
   SMTP_FROM=your_email@gmail.com
   ```

### Другие почтовые сервисы:

**Yandex:**
```env
SMTP_HOST=smtp.yandex.ru
SMTP_PORT=587
SMTP_USER=your_email@yandex.ru
SMTP_PASS=your_app_password
```

**Mail.ru:**
```env
SMTP_HOST=smtp.mail.ru
SMTP_PORT=587
SMTP_USER=your_email@mail.ru
SMTP_PASS=your_app_password
```

## Как это работает

### Поток оплаты:

```
Пользователь заполняет форму
         ↓
Нажимает "Оплатить"
         ↓
POST /api/create-payment
         ↓
ЮKassa (страница оплаты)
         ↓
    ┌───────┴───────┐
    ↓               ↓
  Оплатил        Отменил
    ↓               ↓
Webhook:       Webhook:
payment.       payment.
succeeded      canceled
    ↓               ↓
✅ Email       ❌ Email НЕ
✅ БД          ❌ БД НЕ
✅ Telegram    ✅ Telegram
```

### Backend логика:

**При создании платежа (`/api/create-payment`):**
- В MOCK режиме: сразу сохраняет сеанс и отправляет email
- В реальном режиме: ждёт webhook от ЮKassa

**При webhook от ЮKassa (`/api/webhook`):**

✅ `payment.succeeded`:
- Обновляет статус платежа
- Сохраняет сеанс в БД
- Отправляет email клиенту
- Уведомление в Telegram

❌ `payment.canceled` или `payment.expired`:
- Обновляет статус платежа
- **НЕ сохраняет сеанс в БД**
- **НЕ отправляет email**
- Уведомление в Telegram (об ошибке)

## Тестирование

### В MOCK режиме:

1. **Запустите сервер:**
   ```bash
   cd backend
   npm install  # Установить nodemailer
   node server.js
   ```

2. **Заполните форму и оплатите**

3. **Результат:**
   - ✅ Сеанс сохранён в БД
   - ✅ Email отправлен (если SMTP настроен)
   - ✅ Telegram уведомление

### Проверка email:

Если SMTP не настроен, в логах будет:
```
⚠️ SMTP не настроен. Email не отправлен.
```

## Пример письма

**Тема:** ✅ Оплата принята — Консультация психолога

**Содержание:**
```
✅ Оплата прошла успешно!

Здравствуйте, Иванов Иван!

Ваша оплата принята. Детали записи:

Услуга: Индивидуальная консультация — 3 500 ₽
Дата: 15.04.2025
Время: 14:00
Сумма: 3500 ₽
ID платежа: pay_xxxxx

Мы свяжемся с вами для подтверждения записи.
Если у вас есть вопросы, напишите нам в Telegram
```

## Переменные окружения

```env
# Email (SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
SMTP_FROM=your_email@gmail.com

# Telegram (уведомления владельцу)
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

## Файлы

- ✅ `backend/server.js` — добавлена функция `sendEmailConfirmation()`
- ✅ `backend/package.json` — добавлен `nodemailer`
- ✅ `backend/.env.example` — добавлены SMTP настройки
- ✅ `frontend/index.html` — убраны лишние модальные окна
- ✅ `frontend/js/main.js` — убрана логика проверки оплаты
