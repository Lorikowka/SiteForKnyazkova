
// Для локальной разработки: http://localhost:1488
// Для продакшна: https://backendtest-is-hard.vercel.app (замените на ваш актуальный URL Vercel)
const BACKEND_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
  ? 'http://localhost:1488' 
  : 'https://backendtest-is-hard.vercel.app'; 

const PAYMENT_DRAFT_STORAGE_KEY = 'payment_booking_drafts';
