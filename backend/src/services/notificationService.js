const config = require('../utils/config');
const logger = require('../utils/logger');
const { escapeHtml } = require('../../database');

/**
 * Отправляет сообщение администратору в Telegram.
 *
 * Текст сообщения формируется на сервере и может содержать HTML-разметку
 * (parse_mode = HTML). Пользовательские значения перед вставкой нужно
 * экранировать с помощью `escapeTelegramHtml`.
 */
async function sendTelegramNotification(message) {
  const { token, chatId } = config.telegram;
  if (!token || !chatId) return { skipped: true };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: String(message || ''),
        parse_mode: 'HTML',
        disable_web_page_preview: true
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.description || `HTTP ${response.status}`);
    }
    return { sent: true };
  } catch (error) {
    logger.error(`Telegram error: ${error.message}`);
    return { sent: false, error: error.message };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  sendTelegramNotification,
  escapeTelegramHtml: escapeHtml
};
