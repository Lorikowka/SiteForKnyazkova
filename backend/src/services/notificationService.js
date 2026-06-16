const config = require('../utils/config');
const logger = require('../utils/logger');
const { sanitizeInput } = require('../../database');

async function sendTelegramNotification(message) {
  const { token, chatId } = config.telegram;
  if (!token || !chatId) return;
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          chat_id: chatId, 
          text: sanitizeInput(message), 
          parse_mode: 'HTML' 
        }),
        signal: controller.signal
      }
    );
    clearTimeout(timeout);
  } catch (error) {
    logger.error(`Telegram error: ${error.message}`);
  }
}

module.exports = { sendTelegramNotification };
