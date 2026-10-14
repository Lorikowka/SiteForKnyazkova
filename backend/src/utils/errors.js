/**
 * Хелперы для создания HTTP-ошибок.
 *
 * Контроллеры бросают такие ошибки, а глобальный обработчик (`app.js`)
 * превращает их в аккуратный JSON-ответ с нужным статусом и кодом.
 */

/** @param {number} statusCode @param {string} message @param {string} [code] */
export function httpError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

export const badRequest = (message, code) => httpError(400, message, code);
export const forbidden = (message, code) => httpError(403, message, code);
export const notFound = (message, code) => httpError(404, message, code);
export const conflict = (message, code) => httpError(409, message, code);
export const serviceUnavailable = (message, code) => httpError(503, message, code);

/** Ошибка валидации входных данных (400 + список деталей). */
export function validationError(details) {
  const error = httpError(400, 'Некорректные данные', 'VALIDATION_ERROR');
  error.details = details;
  return error;
}
