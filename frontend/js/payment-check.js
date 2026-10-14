/**
 * payment-check.js — страница проверки оплаты.
 *
 * Опрашивает статус платежа, а после успешной оплаты создаёт запись
 * (POST /api/payments/:id/confirm-booking). Данные записи берутся из черновика
 * sessionStorage, сохранённого на этапе оформления; если черновика нет, backend
 * использует метаданные платежа.
 */

(function () {
  const params = new URLSearchParams(window.location.search);
  const paymentId = params.get('payment_id') || '';
  const token = params.get('token') || '';

  const MAX_ATTEMPTS = 20;
  const POLL_INTERVAL = 3000;

  let attempts = 0;
  let bookingInProgress = false;

  const el = (id) => document.getElementById(id);

  function show(state) {
    ['loading', 'success', 'error'].forEach(s => {
      el(`state-${s}`).classList.toggle('hidden', s !== state);
    });
  }

  function showError(title, description) {
    el('error-title').textContent = title;
    el('error-desc').textContent = description;
    show('error');
  }

  function fail(reason) {
    const query = new URLSearchParams({ reason });
    if (paymentId) query.set('payment_id', paymentId);
    if (token) query.set('token', token);
    window.location.replace(`payment-failed.html?${query.toString()}`);
  }

  function readDraft(id) {
    try {
      const drafts = JSON.parse(sessionStorage.getItem(PAYMENT_DRAFT_STORAGE_KEY) || '{}');
      return drafts[id] || null;
    } catch {
      return null;
    }
  }

  function clearDraft(id) {
    try {
      const drafts = JSON.parse(sessionStorage.getItem(PAYMENT_DRAFT_STORAGE_KEY) || '{}');
      if (!drafts[id]) return;
      delete drafts[id];
      sessionStorage.setItem(PAYMENT_DRAFT_STORAGE_KEY, JSON.stringify(drafts));
    } catch { /* игнорируем */ }
  }

  async function confirmBooking() {
    if (bookingInProgress) return;
    bookingInProgress = true;

    const draft = readDraft(paymentId);
    const body = { token };
    if (draft) {
      Object.assign(body, {
        customerName: draft.customerName,
        customerPhone: draft.customerPhone,
        customerEmail: draft.customerEmail,
        serviceId: draft.serviceId,
        serviceName: draft.serviceName,
        sessionDate: draft.sessionDate,
        sessionTime: draft.sessionTime,
        sessionDatetime: draft.sessionDatetime,
        comment: draft.comment
      });
    }

    try {
      await apiRequest(`/api/payments/${encodeURIComponent(paymentId)}/confirm-booking`, {
        method: 'POST',
        body: JSON.stringify(body)
      });
      clearDraft(paymentId);
      show('success');
      setTimeout(() => { window.location.href = 'index.html?payment_success=true'; }, 4000);
    } catch (error) {
      const code = error.data && error.data.code;
      if (code === 'slot_taken' || code === 'group_full') fail('slot_taken_after_payment');
      else if (code === 'duplicate_group_booking') fail('duplicate_group_booking');
      else if (code === 'missing_booking_data') fail('booking_lost');
      else fail('booking_confirm_failed');
    }
  }

  function retryOrTimeout() {
    attempts += 1;
    if (attempts < MAX_ATTEMPTS) {
      setTimeout(checkStatus, POLL_INTERVAL);
    } else {
      fail('pending');
    }
  }

  async function checkStatus() {
    try {
      const data = await apiRequest(`/api/payments/${encodeURIComponent(paymentId)}?token=${encodeURIComponent(token)}`);
      const status = data.payment.status;

      if (status === 'succeeded' || status === 'waiting_for_capture') {
        await confirmBooking();
        return;
      }
      if (status === 'canceled' || status === 'expired') {
        fail(status);
        return;
      }
      retryOrTimeout();
    } catch (error) {
      if (error.status === 403 || error.status === 404) {
        showError('Платёж не найден', 'Ссылка проверки оплаты недействительна. Если деньги списались, напишите мне в Telegram.');
        return;
      }
      retryOrTimeout();
    }
  }

  if (!paymentId) {
    showError('Платёж не найден', 'В ссылке нет идентификатора платежа. Начните оформление заново.');
  } else {
    checkStatus();
  }
})();
