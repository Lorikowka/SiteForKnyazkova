/**
 * booking.js — пошаговая запись: данные → время → оплата.
 *
 * После успешного создания платежа черновик записи сохраняется в sessionStorage
 * (ключ PAYMENT_DRAFT_STORAGE_KEY). Страница payment-check.html после оплаты
 * использует этот черновик (или метаданные платежа) для создания записи.
 */

function initBooking() {
  const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

  const dateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // —— Черновики записей (для страницы подтверждения оплаты) ——
  const readDrafts = () => {
    try { return JSON.parse(sessionStorage.getItem(PAYMENT_DRAFT_STORAGE_KEY) || '{}'); } catch { return {}; }
  };
  const writeDrafts = (drafts) => {
    try { sessionStorage.setItem(PAYMENT_DRAFT_STORAGE_KEY, JSON.stringify(drafts)); } catch { /* приватный режим */ }
  };
  const saveDraft = (paymentId, draft) => {
    const drafts = readDrafts();
    drafts[paymentId] = draft;
    writeDrafts(drafts);
  };

  let ALL_SLOTS = {}, FREE_SLOTS = {}, BUSY_SLOTS = {}, SLOT_DETAILS = {};
  let scheduleLoaded = false;
  let scheduleErrorMessage = '';

  const state = {
    currentStep: 1,
    fio: '', lastName: '', firstName: '', middleName: '',
    phone: '', email: '', service: '', serviceLabel: '',
    serviceType: 'individual', price: 0, comment: '',
    selectedDate: null, selectedTime: null,
    calYear: new Date().getFullYear(), calMonth: new Date().getMonth()
  };

  const $ = (id) => document.getElementById(id);
  const stepPanels = [null, $('step-1'), $('step-2'), $('step-3')];
  const stepIndicators = [null, $('step-indicator-1'), $('step-indicator-2'), $('step-indicator-3')];
  const serviceSelect = $('service');
  const calGrid = $('calendar-grid');
  const timeSlotsCont = $('time-slots');
  const btnStep2 = $('btn-step2');
  const slotsHint = document.querySelector('.slots-hint');

  if (!stepPanels[1] || !serviceSelect) return; // блок записи отсутствует на странице

  function setFieldError(fieldId, errorId, show) {
    const field = $(fieldId);
    const error = $(errorId);
    if (field) field.classList.toggle('error', Boolean(show));
    if (error) error.classList.toggle('visible', Boolean(show));
  }

  function validateStep1() {
    const lastName = ($('last-name')?.value || '').trim();
    const firstName = ($('first-name')?.value || '').trim();
    const middleName = ($('middle-name')?.value || '').trim();
    const phone = ($('phone')?.value || '').trim();
    const email = ($('email')?.value || '').trim();
    const service = serviceSelect.value;

    const namePattern = /^[\p{L}\p{M}'’ -]{1,80}$/u;
    const lastNameValid = namePattern.test(lastName);
    const firstNameValid = namePattern.test(firstName);
    const middleNameValid = !middleName || namePattern.test(middleName);
    const phoneValid = phone.replace(/\D/g, '').length === 11;
    const emailValid = !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const serviceValid = Boolean(service);

    setFieldError('last-name', 'last-name-error', !lastNameValid);
    setFieldError('first-name', 'first-name-error', !firstNameValid);
    setFieldError('middle-name', 'middle-name-error', !middleNameValid);
    setFieldError('phone', 'phone-error', !phoneValid);
    setFieldError('email', 'email-error', !emailValid);
    setFieldError('service', 'service-error', !serviceValid);

    return lastNameValid && firstNameValid && middleNameValid && phoneValid && emailValid && serviceValid;
  }

  async function loadSchedule() {
    scheduleLoaded = false;
    scheduleErrorMessage = '';
    if (state.currentStep === 2) renderCalendar();
    try {
      const data = await apiRequest(`/api/schedule?service=${encodeURIComponent(state.service)}`);
      ALL_SLOTS = data.allSlots || {};
      FREE_SLOTS = data.freeSlots || {};
      BUSY_SLOTS = data.busySlots || {};
      SLOT_DETAILS = data.slotDetails || {};
    } catch (error) {
      scheduleErrorMessage = error.message || 'Не удалось загрузить расписание';
    } finally {
      scheduleLoaded = true;
      if (state.currentStep === 2) renderCalendar();
    }
  }

  function goToStep(n) {
    stepPanels.forEach((panel, i) => panel && panel.classList.toggle('hidden', i !== n));
    stepIndicators.forEach((indicator, i) => {
      if (!indicator) return;
      indicator.classList.remove('active', 'done');
      if (i === n) indicator.classList.add('active');
      else if (i < n) indicator.classList.add('done');
    });
    state.currentStep = n;
  }

  function renderCalendar() {
    if (!calGrid) return;
    calGrid.innerHTML = '';
    $('cal-month-label').textContent = `${MONTHS[state.calMonth]} ${state.calYear}`;

    if (scheduleErrorMessage) {
      calGrid.innerHTML = `<div class="cal-loading">${sanitizeText(scheduleErrorMessage)}</div>`;
      return;
    }
    if (!scheduleLoaded) {
      calGrid.innerHTML = '<div class="cal-loading">Загрузка расписания...</div>';
      return;
    }

    ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].forEach(day => {
      const el = document.createElement('div');
      el.className = 'cal-day-name';
      el.textContent = day;
      calGrid.appendChild(el);
    });

    const firstDay = new Date(state.calYear, state.calMonth, 1);
    let startDow = firstDay.getDay() - 1;
    if (startDow < 0) startDow = 6;
    const daysInMonth = new Date(state.calYear, state.calMonth + 1, 0).getDate();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < startDow; i += 1) calGrid.appendChild(document.createElement('div'));

    for (let day = 1; day <= daysInMonth; day += 1) {
      const d = new Date(state.calYear, state.calMonth, day);
      const key = dateKey(d);
      const el = document.createElement('div');
      el.textContent = String(day);
      el.className = 'cal-day';
      if (d < today) el.classList.add('past');
      else if ((FREE_SLOTS[key] || []).length > 0) el.classList.add('available');
      if (state.selectedDate && dateKey(state.selectedDate) === key) el.classList.add('selected');

      if ((ALL_SLOTS[key] || []).length > 0 && d >= today) {
        el.addEventListener('click', () => {
          state.selectedDate = d;
          state.selectedTime = null;
          btnStep2.disabled = true;
          $('selected-slot-info')?.classList.add('hidden');
          renderCalendar();
          renderTimeSlots(d);
        });
      }
      calGrid.appendChild(el);
    }
  }

  function renderTimeSlots(d) {
    const key = dateKey(d);
    const slots = ALL_SLOTS[key] || [];
    timeSlotsCont.innerHTML = '';
    if (slotsHint) slotsHint.style.display = slots.length ? 'none' : 'block';

    slots.forEach(time => {
      const isBusy = (BUSY_SLOTS[key] || []).includes(time) || !(FREE_SLOTS[key] || []).includes(time);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `time-slot${isBusy ? ' busy' : ''}`;
      btn.textContent = time;
      btn.disabled = isBusy;
      if (state.selectedTime === time) btn.classList.add('selected');

      if (!isBusy) {
        btn.addEventListener('click', () => {
          state.selectedTime = time;
          timeSlotsCont.querySelectorAll('.time-slot').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          btnStep2.disabled = false;
          $('selected-slot-text').textContent = `${d.toLocaleDateString('ru-RU')} в ${time}`;
          $('selected-slot-info')?.classList.remove('hidden');
        });
      }
      timeSlotsCont.appendChild(btn);
    });
  }

  // Шаг 1 → Шаг 2
  $('btn-step1')?.addEventListener('click', () => {
    if (!validateStep1()) return;
    const opt = serviceSelect.options[serviceSelect.selectedIndex];
    state.lastName = $('last-name').value.trim();
    state.firstName = $('first-name').value.trim();
    state.middleName = $('middle-name').value.trim();
    state.fio = [state.lastName, state.firstName, state.middleName].filter(Boolean).join(' ');
    state.phone = $('phone').value.trim();
    state.email = $('email').value.trim();
    state.service = opt.value;
    state.serviceLabel = opt.text.split('—')[0].trim(); // без цены
    state.price = parseInt(opt.dataset.price, 10) || 0;
    state.comment = $('request').value.trim();
    goToStep(2);
    loadSchedule();
  });

  // Шаг 2 → Шаг 3
  $('btn-step2')?.addEventListener('click', () => {
    if (!state.selectedDate || !state.selectedTime) return;
    $('sum-fio').textContent = state.fio;
    $('sum-phone').textContent = state.phone;
    $('sum-service').textContent = state.serviceLabel;
    $('sum-slot').textContent = `${state.selectedDate.toLocaleDateString('ru-RU')} в ${state.selectedTime}`;
    $('sum-price').textContent = `${state.price.toLocaleString('ru-RU')} ₽`;
    goToStep(3);
  });

  $('btn-back1')?.addEventListener('click', () => goToStep(1));
  $('btn-back2')?.addEventListener('click', () => goToStep(2));

  // Оплата
  $('yoo-pay-btn')?.addEventListener('click', async () => {
    const payBtn = $('yoo-pay-btn');
    const status = $('pay-status');
    const setStatus = (text, kind = '') => {
      if (!status) return;
      status.textContent = text || '';
      status.className = `payment-status${kind ? ' ' + kind : ''}`;
    };

    if (!state.selectedDate || !state.selectedTime || !state.price) {
      setStatus('Выберите услугу и время записи.', 'error');
      return;
    }

    payBtn.disabled = true;
    setStatus('Создаём платёж…');

    const sessionDate = dateKey(state.selectedDate);
    const sessionDatetime = `${sessionDate}T${state.selectedTime}:00`;

    try {
      const data = await apiRequest('/api/payments/create-payment', {
        method: 'POST',
        body: JSON.stringify({
          amount: state.price,
          description: state.serviceLabel,
          customerName: state.fio,
          customerLastName: state.lastName,
          customerFirstName: state.firstName,
          customerMiddleName: state.middleName,
          customerPhone: state.phone,
          customerEmail: state.email,
          serviceId: state.service,
          serviceName: state.serviceLabel,
          sessionDate,
          sessionTime: state.selectedTime,
          sessionDatetime,
          comment: state.comment
        })
      });

      if (!data.confirmationUrl) throw new Error('Сервис оплаты не вернул ссылку');

      // Сохраняем черновик — он нужен после возврата с оплаты.
      saveDraft(data.paymentId, {
        amount: state.price,
        description: state.serviceLabel,
        customerName: state.fio,
        customerLastName: state.lastName,
        customerFirstName: state.firstName,
        customerMiddleName: state.middleName,
        customerPhone: state.phone,
        customerEmail: state.email,
        serviceId: state.service,
        serviceName: state.serviceLabel,
        sessionDate,
        sessionTime: state.selectedTime,
        sessionDatetime,
        comment: state.comment,
        token: data.statusToken || '',
        createdAt: Date.now()
      });

      window.location.href = data.confirmationUrl;
    } catch (error) {
      if (error.status === 409) {
        setStatus('Это время уже занято. Выберите другой слот.', 'error');
        loadSchedule();
        goToStep(2);
      } else {
        setStatus(error.message || 'Не удалось создать платёж. Попробуйте позже.', 'error');
      }
      payBtn.disabled = false;
    }
  });

  // Переключение месяцев
  $('cal-prev')?.addEventListener('click', () => {
    state.calMonth -= 1;
    if (state.calMonth < 0) { state.calMonth = 11; state.calYear -= 1; }
    renderCalendar();
  });
  $('cal-next')?.addEventListener('click', () => {
    state.calMonth += 1;
    if (state.calMonth > 11) { state.calMonth = 0; state.calYear += 1; }
    renderCalendar();
  });

  // Живое снятие ошибок при вводе.
  ['fio', 'phone', 'email', 'service'].forEach(id => {
    $(id)?.addEventListener('input', () => setFieldError(id, `${id}-error`, false));
  });

  renderCalendar();
}
