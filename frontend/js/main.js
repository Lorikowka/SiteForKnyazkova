/**
 * main.js — Точка входа
 */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Инициализация UI (меню, скролл)
  if (typeof initUI === 'function') initUI();

  // 2. Инициализация галереи
  if (typeof initGallery === 'function') initGallery();

  // 3. Инициализация бронирования
  if (typeof initBooking === 'function') initBooking();

  // 4. Инициализация отзывов
  if (typeof initReviews === 'function') initReviews();

  // 5. Инициализация масок для ввода
  const phoneInput = document.getElementById('phone');
  if (phoneInput && typeof initPhoneMask === 'function') {
    initPhoneMask(phoneInput);
  }

  // Успех показывается только на payment-check.html после подтверждения API.
});
