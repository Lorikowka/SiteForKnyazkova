# Настройка уведомлений и обработки платежей

## 📋 Обзор

После оплаты через ЮКассу система автоматически:
- ✅ Сохраняет сеанс в базу данных
- ✅ Отправляет email клиенту (если SMTP настроен)
- ✅ Отправляет уведомление владельцу в Telegram

## 🔄 Поток оплаты

```
Клиент заполняет форму → Выбирает время → Нажимает «Оплатить»
                              ↓
              POST /api/payments/create-payment
                              ↓
                    ЮКасса (страница оплаты)
                              ↓
               ┌──────────────┴──────────────┐
               ↓                             ↓
          ✅ Оплатил                     ❌ Отменил
               ↓                             ↓
   Webhook: payment.succeeded      Webhook: payment.canceled
   (POST /api/admin/webhook)       (POST /api/admin/webhook)
               ↓                             ↓
        • Обновить статус              • Обновить статус
        • /payment-check.html          • /payment-failed.html
        • confirm-booking → запись
        • email клиенту + уведомление
```

## 📧 Настройка Email (SMTP)

### Gmail
1. Включите **двухфакторную аутентификацию** в Google аккаунте
2. Создайте **пароль приложения**: https://myaccount.google.com/apppasswords
3. Добавьте в `.env`:
```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password  # без пробелов
SMTP_FROM=your_email@gmail.com
```

### Yandex
```env
SMTP_HOST=smtp.yandex.ru
SMTP_PORT=587
SMTP_USER=your_email@yandex.ru
SMTP_PASS=your_app_password
```

### Mail.ru
```env
SMTP_HOST=smtp.mail.ru
SMTP_PORT=587
SMTP_USER=your_email@mail.ru
SMTP_PASS=your_app_password
```

## 📝 Пример email клиенту

**Тема:** ✅ Оплата принята — Консультация психолога

```
✅ Оплата прошла успешно!

Здравствуйте, Иван!

Ваша оплата принята. Детали записи:

Услуга:     Индивидуальная консультация (онлайн)
Дата:       15.04.2025
Время:      14:00
Сумма:      3 000 ₽
ID платежа: pay_xxxxx

Мы свяжемся с вами для подтверждения записи.
Если у вас есть вопросы — напишите в Telegram.
```

## 🔍 Страницы проверки оплаты

### ✅ Успешная оплата
1. Клиент попадает на `/payment-check.html?payment_id=...`
2. Страница проверяет статус через API (до 20 попыток)
3. При успехе → редирект на главную с модальным окном
4. При повторной проверке — статус уже `succeeded`

### ❌ Отмена/ошибка
1. При отмене → `/payment-check.html` видит статус `canceled`
2. Показывает страницу ошибки с деталями платежа
3. Кнопки: «Попробовать снова» и «На главную»
4. Ссылка на Telegram для поддержки

### Файлы страниц
| Файл | Назначение |
|------|-----------|
| `payment-check.html` + `js/payment-check.js` | Проверка статуса и подтверждение записи |
| `payment-failed.html` + `js/payment-failed.js` | Страница ошибки с деталями и повтором |

## 🧪 Тестирование

### MOCK режим (локально)
```bash
cd backend && node server.js
```
- Платёж сразу считается успешным
- Редирект на главную с модальным окном
- Email отправляется (если SMTP настроен)

### Реальный режим
Установите `MOCK_MODE=false` и реальные ключи ЮКассы.

**Тестовые карты ЮКассы:**
- `1111 1111 1111 1026` — успешная оплата
- `1111 1111 1111 0263` — отказ

## 🔧 API endpoints

| Метод | Endpoint | Описание |
|-------|----------|----------|
| POST | `/api/payments/create-payment` | Создать платёж |
| GET | `/api/payments/:id` | Проверить статус платежа (по токену) |
| POST | `/api/payments/:id/confirm-booking` | Подтвердить запись после оплаты |
| POST | `/api/payments/:id/discard` | Отменить незавершённый платёж |
| POST | `/api/admin/webhook` | Webhook от ЮКассы |
| GET | `/api/services` | Список услуг и цен |
| GET | `/api/schedule` | Доступные слоты |
| GET | `/api/sessions` | Все сеансы (нужен API-Key) |
| GET | `/api/payments` | Все платежи (нужен API-Key) |

## 📁 Затронутые файлы

- `backend/server.js` — сборка приложения, middleware, статика, shutdown
- `backend/database.js` — модуль БД с retry-логикой
- `backend/src/services/paymentService.js` — интеграция с ЮKassa
- `backend/src/services/notificationService.js` — уведомления
- `backend/config.json` — услуги, цены, расписание
- `frontend/js/payment-check.js` — проверка статуса и подтверждение записи
- `frontend/js/payment-failed.js` — страница ошибки и повтор оплаты
- `frontend/index.html` — главная страница + модальное окно
