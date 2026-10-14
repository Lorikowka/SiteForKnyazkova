/**
 * Каталог услуг и общие помощники для платежей/записей.
 *
 * Здесь сосредоточена «чистая» логика, не зависящая от HTTP: разбор
 * метаданных платежа, поиск конфигурации услуги и работа с датой/временем.
 */
import config from '../config/index.js';

export const services = config.services;
export const schedule = config.schedule;

/** Разбирает JSON-метаданные платежа (в БД они хранятся строкой). */
export function getStoredPaymentMetadata(payment) {
  if (!payment?.metadata) return {};
  if (typeof payment.metadata === 'object') return payment.metadata;
  try {
    return JSON.parse(payment.metadata);
  } catch {
    return {};
  }
}

/** Возвращает конфигурацию услуги по id, а при его отсутствии — по названию. */
export function getServiceConfig(serviceId, serviceName = '') {
  const normalizedName = String(serviceName || '').toLowerCase();
  const service = services.find((item) => item.id === serviceId)
    || services.find((item) => normalizedName.includes(String(item.name || '').toLowerCase()))
    || services[0];

  return {
    ...service,
    type: service?.type || 'individual',
    capacity: Math.max(1, Number(service?.capacity) || 1)
  };
}

/** Конфигурация услуги для строки из БД (учитывает метаданные платежа). */
export function getRowServiceConfig(row) {
  const metadata = getStoredPaymentMetadata(row);
  return getServiceConfig(
    row?.service_id || metadata.serviceId || '',
    row?.service_name || metadata.serviceName || ''
  );
}

export const getDateFromSessionDatetime = (datetime) => (
  typeof datetime === 'string' && datetime.includes('T') ? datetime.split('T')[0] : ''
);

export const getTimeFromSessionDatetime = (datetime) => (
  typeof datetime === 'string' && datetime.includes('T') ? datetime.split('T')[1]?.slice(0, 5) : ''
);

/** Слот, «зарезервированный» платежом, который ещё не превратился в запись. */
export function getReservedSlotMetadata(payment) {
  const metadata = getStoredPaymentMetadata(payment);
  if (!metadata.sessionDate || !metadata.sessionTime || !metadata.sessionDatetime) return null;

  return {
    paymentId: payment.id,
    status: payment.status,
    serviceId: metadata.serviceId || payment.service_id || '',
    serviceName: metadata.serviceName || payment.service_name || '',
    sessionDate: getDateFromSessionDatetime(metadata.sessionDatetime) || metadata.sessionDate,
    sessionTime: getTimeFromSessionDatetime(metadata.sessionDatetime) || metadata.sessionTime,
    sessionDatetime: metadata.sessionDatetime
  };
}

/** Проверяет одноразовый токен доступа к деталям платежа. */
export function hasValidPaymentToken(payment, providedToken) {
  if (!providedToken) return false;
  const metadata = getStoredPaymentMetadata(payment);
  return Boolean(metadata.statusToken && providedToken === metadata.statusToken);
}
