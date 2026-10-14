/**
 * reviews.js — Форма отзывов.
 */

function initReviews() {
  const reviewForm = document.getElementById('review-form');
  const reviewSubmit = document.getElementById('review-submit');
  const reviewStatus = document.getElementById('review-status');

  if (!reviewForm) return;

  const setStatus = (text, kind) => {
    if (!reviewStatus) return;
    reviewStatus.textContent = text || '';
    reviewStatus.className = `feedback-status${kind ? ' ' + kind : ''}`;
  };

  reviewForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setStatus('');

    const rating = reviewForm.querySelector('input[name="rating"]:checked')?.value;
    const name = document.getElementById('review-name')?.value.trim();
    const contact = document.getElementById('review-contact')?.value.trim();
    const message = document.getElementById('review-text')?.value.trim();

    if (!rating || !name || !contact || !message) {
      setStatus('Заполните все поля', 'error');
      return;
    }

    try {
      if (reviewSubmit) reviewSubmit.disabled = true;
      await apiRequest('/api/reviews', {
        method: 'POST',
        body: JSON.stringify({ rating: Number(rating), name, contact, message })
      });
      reviewForm.reset();
      setStatus('Спасибо за отзыв!', 'success');
    } catch (error) {
      setStatus(error.message || 'Ошибка при отправке', 'error');
    } finally {
      if (reviewSubmit) reviewSubmit.disabled = false;
    }
  });
}
