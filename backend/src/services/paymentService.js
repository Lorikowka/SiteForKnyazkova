const config = require('../utils/config');
const logger = require('../utils/logger');

async function createYooKassaPayment({ amount, description, metadata, returnUrl, idempotenceKey }) {
  const { baseUrl, authHeader } = config.yookassa;
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  
  try {
    const response = await fetch(`${baseUrl}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotence-Key': idempotenceKey,
        'Authorization': `Basic ${authHeader}`
      },
      body: JSON.stringify({
        amount: { value: amount.toString(), currency: 'RUB' },
        description,
        metadata,
        confirmation: {
          type: 'redirect',
          return_url: returnUrl
        },
        capture: true,
        paid: false
      }),
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    return await response.json();
  } catch (error) {
    logger.error(`YooKassa create payment error: ${error.message}`);
    throw error;
  }
}

async function checkYooKassaPayment(externalPaymentId) {
  const { baseUrl, authHeader } = config.yookassa;
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  
  try {
    const response = await fetch(`${baseUrl}/payments/${externalPaymentId}`, {
      headers: { 'Authorization': `Basic ${authHeader}` },
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    return await response.json();
  } catch (error) {
    logger.error(`YooKassa check payment error: ${error.message}`);
    throw error;
  }
}

module.exports = { createYooKassaPayment, checkYooKassaPayment };
