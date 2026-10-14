/**
 * Утилиты для работы с текстом: экранирование разметки и очистка ввода.
 */

/** Экранирует HTML-спецсимволы — для безопасной вставки данных в разметку. */
export function escapeHtml(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/** Убирает потенциально опасные конструкции из пользовательских строк. */
export function sanitizeInput(input) {
  if (typeof input !== 'string') return input;
  return input
    .replace(/<\/?[^>]*>/g, '')
    .replace(/&[a-zA-Z0-9#]+;/g, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/\bon\w+\s*=/gi, '')
    .replace(/data\s*:/gi, '')
    .replace(/`/g, '')
    .trim();
}
