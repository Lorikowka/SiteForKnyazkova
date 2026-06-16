const config = require('../utils/config');
const logger = require('../utils/logger');
const { createVkNotifier } = require('../../lib/vkNotifier');
const { sanitizeInput } = require('../../database');

const vkNotifier = createVkNotifier({
  token: config.vk.token,
  peerIds: config.vk.peerIds,
  apiVersion: config.vk.apiVersion,
  logger,
  sanitize: sanitizeInput
});

function buildBookingNotificationEvent(type, { payment = {}, session = {}, status, reason, comment } = {}) {
  // Helper to get metadata
  const getStoredPaymentMetadata = (p) => {
    if (!p?.metadata) return {};
    if (typeof p.metadata === 'object') return p.metadata;
    try { return JSON.parse(p.metadata); } catch (e) { return {}; }
  };

  const metadata = getStoredPaymentMetadata(payment);
  
  const getDateFromSessionDatetime = (sd) => (typeof sd === 'string' && sd.includes('T') ? sd.split('T')[0] : '');
  const getTimeFromSessionDatetime = (sd) => (typeof sd === 'string' && sd.includes('T') ? sd.split('T')[1]?.slice(0, 5) : '');

  const sessionDate = session.session_date || metadata.sessionDate || getDateFromSessionDatetime(metadata.sessionDatetime);
  const sessionTime = session.session_time || metadata.sessionTime || getTimeFromSessionDatetime(metadata.sessionDatetime);

  return {
    type,
    clientName: session.client_name || payment.customer_name || metadata.customerName,
    serviceName: session.service_name || payment.service_name || metadata.serviceName,
    sessionDate,
    sessionTime,
    status: status || session.status || 'scheduled',
    paymentStatus: payment.status,
    paymentId: payment.id,
    sessionId: session.id,
    amount: payment.amount || session.amount,
    reason,
    comment: comment || session.comment || payment.comment || metadata.comment
  };
}

async function sendVkBookingNotification(type, data = {}) {
  try {
    await vkNotifier.sendEvent(buildBookingNotificationEvent(type, data));
  } catch (error) {
    logger.error(`VK notification error: ${error.message}`);
  }
}

module.exports = { sendVkBookingNotification };
