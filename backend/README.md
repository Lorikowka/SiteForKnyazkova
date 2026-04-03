# 🔒 Backend для приёма платежей — Безопасная Версия

Backend-сервер для интеграции с платёжной системой **ЮKassa** (для самозанятых) с усиленной безопасностью.

## 🛡️ Функции Безопасности

### Реализовано:

| Функция | Описание | Статус |
|---------|----------|--------|
| **Helmet** | Security headers (CSP, HSTS, X-Frame-Options) | ✅ |
| **CORS** | Доверенные домены только | ✅ |
| **Rate Limiting** | Защита от DDoS и брутфорса | ✅ |
| **Валидация** | express-validator для всех входных данных | ✅ |
| **Санитизация** | Очистка входных данных от XSS | ✅ |
| **Webhook Signature** | HMAC-SHA256 проверка подписи | ✅ |
| **Безопасные .env** | Разделение по окружениям | ✅ |
| **Логирование** | Winston без чувствительных данных | ✅ |
| **Graceful Shutdown** | Корректное завершение работы | ✅ |

---

## 🚀 Быстрый старт

### 1. Установка зависимостей

```bash
npm install
```

### 2. Настройка переменных окружения

#### Для разработки:
```bash
cp .env.example .env.development
# Отредактируйте .env.development
```

#### Для продакшена:
```bash
cp .env.example .env.production
# Отредактируйте .env.production с реальными ключами
```

### 3. Генерация секретного ключа

```bash
# Для JWT_SECRET (Linux/Mac)
openssl rand -hex 32

# Для JWT_SECRET (Windows PowerShell)
-join ((48..57 + 65..90 + 97..122) | Get-Random -Count 32 | ForEach-Object {[char]$_})
```

### 4. Запуск

```bash
# Разработка
npm run dev

# Продакшен
NODE_ENV=production npm start
```

---

## 📁 Структура Файлов

```
backend/
├── .env.development        # Переменные для разработки (НЕ коммитить!)
├── .env.production         # Переменные для продакшена (НЕ коммитить!)
├── .env.example            # Шаблон для .env (можно коммитить)
├── .gitignore              # Защита от коммита секретов
├── package.json            # Зависимости
├── server.js               # Главный файл (безопасная версия)
├── security-check.js       # Скрипт проверки безопасности
└── README.md               # Документация
```

---

## 🔐 Переменные Окружения

### Критические (обязательные):

| Переменная | Описание | Пример |
|------------|----------|--------|
| `YOOKASSA_SHOP_ID` | ID магазина в ЮKassa | `283451` |
| `YOOKASSA_SECRET_KEY` | Секретный ключ API | `test_xxx...` |

### Рекомендуемые:

| Переменная | Описание | Пример |
|------------|----------|--------|
| `YOOKASSA_WEBHOOK_SECRET` | Ключ для проверки подписи webhook | `xxx...` |
| `JWT_SECRET` | Секретный ключ для токенов | `xxx...` |
| `TELEGRAM_BOT_TOKEN` | Токен Telegram бота | `123:ABC...` |
| `TELEGRAM_CHAT_ID` | ID чата для уведомлений | `-100123...` |

### Безопасности:

| Переменная | Описание | Пример |
|------------|----------|--------|
| `RATE_LIMIT_WINDOW_MS` | Окно rate limiting (мс) | `60000` |
| `RATE_LIMIT_MAX_REQUESTS` | Макс. запросов в окно | `100` |
| `ALLOWED_ORIGINS` | Разрешённые домены | `https://site.ru` |

---

## 📡 API Endpoints

### POST `/api/create-payment`

Создать платёж.

**Rate Limit:** 10 запросов/минуту

**Запрос:**
```json
{
  "amount": 3500,
  "description": "Консультация психолога",
  "orderId": "order_123",
  "customerEmail": "client@example.com"
}
```

**Валидация:**
- `amount`: 10-250000 ₽
- `description`: макс. 200 символов
- `orderId`: макс. 50 символов, только `[a-zA-Z0-9_-]`
- `customerEmail`: валидный email

**Ответ:**
```json
{
  "success": true,
  "paymentId": "2d3df78f-000f-5000-9000-15b6d2c9ec46",
  "confirmationUrl": "https://yookassa.ru/checkout/...",
  "amount": "3500",
  "description": "Консультация психолога"
}
```

---

### GET `/api/payment-status/:id`

Проверить статус платежа.

**Rate Limit:** 10 запросов/минуту

**Валидация:**
- `id`: 10-50 символов, только `[a-zA-Z0-9-]`

**Ответ:**
```json
{
  "success": true,
  "paymentId": "2d3df78f-000f-5000-9000-15b6d2c9ec46",
  "status": "succeeded",
  "amount": "3500",
  "description": "Консультация психолога",
  "created_at": "2026-03-26T12:00:00.000Z",
  "paid": true
}
```

---

### POST `/api/webhook`

Webhook для уведомлений от ЮKassa.

**Rate Limit:** 50 запросов/минуту

**Заголовок:**
```
X-Yookassa-Signature: <hmac-sha256-signature>
```

**Проверка подписи:**
```javascript
const hmac = crypto.createHmac('sha256', YOOKASSA_WEBHOOK_SECRET);
hmac.update(JSON.stringify(req.body));
const calculatedSignature = hmac.digest('hex');

if (signature !== calculatedSignature) {
  return res.status(401).send('Invalid signature');
}
```

---

### GET `/api/health`

Проверка работоспособности.

**Ответ:**
```json
{
  "status": "ok",
  "timestamp": "2026-03-26T12:00:00.000Z",
  "service": "psixolog-payment-backend",
  "version": "1.0.0",
  "environment": "production",
  "payment_mode": "production"
}
```

---

## 🔍 Проверка Безопасности

### Автоматическая проверка:

```bash
npm run security:check
```

### Что проверяется:

1. ✅ .env файлы не скоммичены
2. ✅ node_modules в .gitignore
3. ✅ Security пакеты установлены
4. ✅ Helmet middleware используется
5. ✅ Rate limiting настроен
6. ✅ Валидация данных реализована
7. ✅ Проверка подписи webhook
8. ✅ Security headers на frontend
9. ✅ Нет опасных паттернов (eval, etc.)

---

## 🚀 Развёртывание

### Vercel (рекомендуется)

1. Создайте `vercel.json`:
```json
{
  "version": 2,
  "builds": [{ "src": "server.js", "use": "@vercel/node" }],
  "routes": [{ "src": "/(.*)", "dest": "server.js" }]
}
```

2. Добавьте переменные окружения в панели Vercel:
   - `YOOKASSA_SHOP_ID`
   - `YOOKASSA_SECRET_KEY`
   - `YOOKASSA_WEBHOOK_SECRET`
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
   - `SITE_URL`
   - `NODE_ENV=production`

3. Задеплойте:
```bash
vercel --prod
```

### Railway

1. Подключите GitHub репозиторий
2. Добавьте переменные окружения в панели
3. Автоматический деплой при push

### VPS (Ubuntu/Debian)

```bash
# Установка Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs npm

# Клонирование проекта
git clone <repo>
cd backend
npm install --production

# Создание .env.production
cp .env.example .env.production
# Отредактируйте с реальными ключами

# Запуск через PM2
npm install -g pm2
pm2 start server.js --name psixolog-payment
pm2 save
pm2 startup
```

---

## 🛡️ Чек-лист Безопасности

### Перед деплоем:

- [ ] Все `.env` файлы в `.gitignore`
- [ ] `node_modules` в `.gitignore`
- [ ] Сгенерирован уникальный `JWT_SECRET`
- [ ] Используется `YOOKASSA_WEBHOOK_SECRET`
- [ ] Rate limiting настроен
- [ ] CORS настроен на разрешённые домены
- [ ] Логирование не пишет чувствительные данные
- [ ] HTTPS включён (на VPS)
- [ ] Firewall настроен (на VPS)

### После деплоя:

- [ ] `npm run security:check` прошёл без ошибок
- [ ] Тестовая оплата работает
- [ ] Webhook уведомления приходят
- [ ] Rate limiting работает (проверить через curl)
- [ ] CORS блокирует запрещённые домены

---

## 📊 Мониторинг

### Логи:

```bash
# Просмотр логов (PM2)
pm2 logs psixolog-payment

# Только ошибки
pm2 logs psixolog-payment --err
```

### Метрики для отслеживания:

- Количество успешных платежей
- Количество отменённых платежей
- Количество ошибок API
- Превышения rate limit
- Подозрительные IP адреса

---

## 🚨 Реагирование на Инциденты

### При подозрении на утечку ключей:

1. **Немедленно** смените ключи в ЛК ЮKassa
2. Обновите `.env.production`
3. Перезапустите сервер
4. Проверьте логи на подозрительную активность

### При DDoS атаке:

1. Уменьшите `RATE_LIMIT_MAX_REQUESTS`
2. Включите Cloudflare/другой CDN
3. Проверьте логи на источник атаки

---

## 📚 Документация

- [ЮKassa API](https://yookassa.ru/develop/api/)
- [Helmet Documentation](https://helmetjs.github.io/)
- [Express Rate Limit](https://www.npmjs.com/package/express-rate-limit)
- [Express Validator](https://express-validator.github.io/docs/)

---

## 📞 Поддержка

При проблемах:

1. Проверьте логи: `npm run dev` (development)
2. Запустите проверку безопасности: `npm run security:check`
3. Проверьте переменные окружения
4. Обратитесь к документации ЮKassa

---

**Версия:** 1.0.0  
**Дата:** Март 2026  
**Статус:** ✅ Готово к продакшену
