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

  // Проверка успешной оплаты (показ модального окна)
  const params = new URLSearchParams(window.location.search);
  if (params.get('payment_success') === 'true') {
    window.history.replaceState({}, '', window.location.pathname);
    setTimeout(() => {
      const modal = document.getElementById('success-modal');
      if (modal) modal.classList.remove('hidden');
    }, 500);
  }

  // Закрытие модального окна
  document.getElementById('modal-close')?.addEventListener('click', () => {
    document.getElementById('success-modal')?.classList.add('hidden');
  });
});
