/**
 * Клиент платёжного провайдера ЮKassa.
 */
import config from '../config/index.js';
import logger from '../utils/logger.js';

async function readResponse(response) {
  if (!response.ok) {
    const error = new Error(`YooKassa HTTP ${response.status}`);
    // A timeout or 5xx does not prove that no payment was created.
    error.definitive = [400, 401, 403, 404, 422].includes(response.status);
    throw error;
  }
  const data = await response.json();
  if (!data.id || !data.status || !data.amount) throw new Error('Invalid YooKassa response');
  return data;
}

/** Создаёт платёж и возвращает объект от ЮKassa. */
export async function createYooKassaPayment({ amount, description, metadata, returnUrl, idempotenceKey }) {
  const { baseUrl, authHeader } = config.yookassa;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${baseUrl}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotence-Key': idempotenceKey,
        Authorization: `Basic ${authHeader}`
      },
      body: JSON.stringify({
        amount: { value: Number(amount).toFixed(2), currency: 'RUB' },
        description,
        metadata,
        confirmation: { type: 'redirect', return_url: returnUrl },
        capture: true
      }),
      signal: controller.signal
    });

    return await readResponse(response);
  } catch (error) {
    logger.error(`YooKassa create payment error: ${error.message}`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/** Запрашивает актуальный статус платежа. */
export async function checkYooKassaPayment(externalPaymentId) {
  const { baseUrl, authHeader } = config.yookassa;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`${baseUrl}/payments/${encodeURIComponent(externalPaymentId)}`, {
      headers: { Authorization: `Basic ${authHeader}` },
      signal: controller.signal
    });

    return await readResponse(response);
  } catch (error) {
    logger.error(`YooKassa check payment error: ${error.message}`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
