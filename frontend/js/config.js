/**
 * config.js — базовая конфигурация фронтенда.
 *
 * Адрес API определяется автоматически:
 *   • сайт и API на одном домене/порту  → относительные пути (/api/...);
 *   • локальная разработка (Live Server) → http://localhost:1488;
 *   • отдельный хостинг                  → задайте window.API_BASE_URL до
 *     подключения этого файла, например:
 *     <script>window.API_BASE_URL = 'https://api.example.ru';</script>
 */
const API_BASE_URL = (() => {
  if (typeof window !== 'undefined' && typeof window.API_BASE_URL === 'string') {
    return window.API_BASE_URL.replace(/\/+$/, '');
  }

  const { protocol, hostname, port } = window.location;
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';

  // Сайт открыт отдельно от API (file:// или другой порт) — используем dev-порт backend.
  if (protocol === 'file:' || (isLocal && port !== '1488')) {
    return 'http://localhost:1488';
  }

  return '';
})();

/** Собирает абсолютный URL API из относительного пути. */
function apiUrl(path) {
  const normalized = String(path || '').startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalized}`;
}

/** Ключ sessionStorage, под которым хранятся черновики записей для оплаты. */
const PAYMENT_DRAFT_STORAGE_KEY = 'payment_booking_drafts';

if (typeof window !== 'undefined') {
  window.apiUrl = apiUrl;
  window.PAYMENT_DRAFT_STORAGE_KEY = PAYMENT_DRAFT_STORAGE_KEY;
}
