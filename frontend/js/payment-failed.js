/**
 * payment-failed.js — страница неуспешной/незавершённой оплаты.
 *
 * Показывает причину, при возможности предлагает повторить оплату,
 * используя сохранённый черновик записи.
 */

(function () {
  const params = new URLSearchParams(window.location.search);
  const paymentId = params.get('payment_id') || '';
  const paymentToken = params.get('token') || '';
  const reason = params.get('reason') || '';

  const retryBtn = document.getElementById('retry-btn');
  const detailsBox = document.getElementById('details');

  let paymentDetails = null;

  const paymentStatusLabels = {
    pending: 'Ожидает оплаты',
    succeeded: 'Оплачена',
    waiting_for_capture: 'Ожидает подтверждения',
    canceled: 'Отменена',
    expired: 'Истекла'
  };

  const reasonMap = {
    cancelled: { title: 'Оплата отменена', text: 'Вы не завершили оплату. Попробуйте выбрать время и оплатить запись ещё раз.' },
    canceled: { title: 'Оплата отменена', text: 'Платёж был отменён. Вы можете попробовать снова.' },
    expired: { title: 'Время оплаты истекло', text: 'Сессия оплаты истекла до завершения платежа. Попробуйте начать запись заново.' },
    pending: { title: 'Оплата не подтверждена', text: 'Мы не получили подтверждение оплаты вовремя. Если деньги списались, свяжитесь с нами.' },
    check_failed: { title: 'Не удалось проверить оплату', text: 'Сервер не смог подтвердить статус платежа. Попробуйте позже или свяжитесь с нами.' },
    connection_error: { title: 'Ошибка соединения', text: 'Не удалось связаться с сервером для проверки оплаты. Попробуйте позже.' },
    booking_lost: { title: 'Данные записи не найдены', text: 'Оплата могла пройти, но данные выбранного времени не сохранились. Уточните у специалиста, списались ли деньги.' },
    booking_confirm_failed: { title: 'Оплата прошла, но запись не подтверждена', text: 'Мы не смогли завершить запись после оплаты. Если деньги списались, напишите нам в Telegram.' },
    slot_taken_after_payment: { title: 'Это время уже занято', text: 'Пока проходила оплата, кто-то успел занять это время. Выберите другой слот или свяжитесь с нами по вопросу возврата.' },
    duplicate_group_booking: { title: 'Место уже забронировано', text: 'На этот групповой тренинг уже есть запись с этими контактами. Если нужно изменить запись, напишите нам в Telegram.' }
  };

  if (reason && reasonMap[reason]) {
    document.getElementById('fail-title').textContent = reasonMap[reason].title;
    document.getElementById('fail-text').textContent = reasonMap[reason].text;
  }

  const readDrafts = () => {
    try { return JSON.parse(sessionStorage.getItem(PAYMENT_DRAFT_STORAGE_KEY) || '{}'); } catch { return {}; }
  };
  const writeDrafts = (drafts) => {
    try { sessionStorage.setItem(PAYMENT_DRAFT_STORAGE_KEY, JSON.stringify(drafts)); } catch { /* игнорируем */ }
  };
  const getDraft = (id) => (id ? readDrafts()[id] || null : null);
  const saveDraft = (id, draft) => { const d = readDrafts(); d[id] = draft; writeDrafts(d); };
  const clearDraft = (id) => { const d = readDrafts(); if (d[id]) { delete d[id]; writeDrafts(d); } };

  const bookingDraft = getDraft(paymentId);

  async function discardPaymentIfPossible() {
    if (!paymentId || !paymentToken) return;
    try {
      await fetch(apiUrl(`/api/payments/${encodeURIComponent(paymentId)}/discard`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: paymentToken })
      });
    } catch { /* игнорируем */ }
  }

  async function retryPayment() {
    const draft = bookingDraft;
    const amount = (draft && draft.amount) || (paymentDetails && paymentDetails.amount) || null;
    const description = (draft && (draft.description || draft.serviceName)) || (paymentDetails && paymentDetails.description) || 'Консультация психолога';

    if (!amount) {
      window.location.href = 'index.html#payment';
      return;
    }

    retryBtn.disabled = true;
    retryBtn.textContent = 'Перенаправляем…';

    try {
      const data = await apiRequest('/api/payments/create-payment', {
        method: 'POST',
        body: JSON.stringify({
          amount,
          description,
          customerEmail: (draft && draft.customerEmail) || '',
          customerName: (draft && draft.customerName) || '',
          customerLastName: (draft && draft.customerLastName) || '',
          customerFirstName: (draft && draft.customerFirstName) || '',
          customerMiddleName: (draft && draft.customerMiddleName) || '',
          customerPhone: (draft && draft.customerPhone) || '',
          serviceId: (draft && draft.serviceId) || '',
          serviceName: (draft && draft.serviceName) || description,
          sessionDate: (draft && draft.sessionDate) || '',
          sessionTime: (draft && draft.sessionTime) || '',
          sessionDatetime: (draft && draft.sessionDatetime) || '',
          comment: (draft && draft.comment) || '',
          orderId: `retry_${Date.now()}`
        })
      });

      if (!data.confirmationUrl) throw new Error('Сервис оплаты не вернул ссылку');

      if (draft) {
        saveDraft(data.paymentId, { ...draft, token: data.statusToken || '', amount, description });
        if (paymentId) clearDraft(paymentId);
      }
      window.location.href = data.confirmationUrl;
    } catch (error) {
      retryBtn.disabled = false;
      retryBtn.textContent = 'Попробовать снова';
      alert('Не удалось снова открыть оплату. Попробуйте ещё раз или начните запись заново.');
    }
  }

  retryBtn.addEventListener('click', retryPayment);

  if (paymentId) {
    const query = paymentToken ? `?token=${encodeURIComponent(paymentToken)}` : '';
    apiRequest(`/api/payments/${encodeURIComponent(paymentId)}${query}`)
      .then(data => {
        const payment = data.payment;
        paymentDetails = payment;
        document.getElementById('detail-status').textContent = paymentStatusLabels[payment.status] || payment.status || '—';
        document.getElementById('detail-amount').textContent = payment.amount ? `${payment.amount} ₽` : '—';
        document.getElementById('detail-id').textContent = payment.id || '—';
        detailsBox.classList.remove('hidden');

        if (payment.status === 'canceled' || payment.status === 'expired') {
          discardPaymentIfPossible();
        }
      })
      .catch(() => { /* детали необязательны */ });
  }

  if (['cancelled', 'canceled', 'expired'].includes(reason)) {
    discardPaymentIfPossible();
  }
})();
