/**
 * booking.js — Календарь, запись и оплата
 */

function initBooking() {
  function dateKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  let ALL_SLOTS = {}, FREE_SLOTS = {}, BUSY_SLOTS = {}, SLOT_DETAILS = {};
  let scheduleLoaded = false;
  let scheduleErrorMessage = '';

  const state = {
    currentStep: 1,
    fio: '', phone: '', email: '', service: '', serviceLabel: '',
    serviceType: 'individual', price: 0, comment: '',
    selectedDate: null, selectedTime: null,
    calYear: new Date().getFullYear(), calMonth: new Date().getMonth(),
  };

  // DOM Refs
  const stepPanels = [null, document.getElementById('step-1'), document.getElementById('step-2'), document.getElementById('step-3')];
  const stepIndicators = [null, document.getElementById('step-indicator-1'), document.getElementById('step-indicator-2'), document.getElementById('step-indicator-3')];
  const serviceSelect = document.getElementById('service');
  const calGrid = document.getElementById('calendar-grid');
  const timeSlotsCont = document.getElementById('time-slots');
  const btnStep2 = document.getElementById('btn-step2');

  async function loadSchedule(serviceId = '') {
    try {
      scheduleLoaded = false;
      scheduleErrorMessage = '';
      const response = await fetch(`${BACKEND_URL}/api/schedule?service=${serviceId}`);
      const data = await response.json();
      console.log('📅 Schedule data received:', data);
      if (data.success) {
        ALL_SLOTS = data.allSlots || {}; FREE_SLOTS = data.freeSlots || {}; BUSY_SLOTS = data.busySlots || {}; SLOT_DETAILS = data.slotDetails || {};
      } else {
        scheduleErrorMessage = data.error || 'Не удалось загрузить расписание';
      }
      scheduleLoaded = true;
      if (state.currentStep === 2) renderCalendar();
    } catch (e) {
      scheduleErrorMessage = 'Ошибка соединения с сервером';
      scheduleLoaded = true;
      renderCalendar();
    }
  }

  function goToStep(n) {
    stepPanels.forEach((p, i) => { if(p) p.classList.toggle('hidden', i !== n); });
    stepIndicators.forEach((ind, i) => {
      if (!ind) return;
      ind.classList.remove('active', 'done');
      if (i === n) ind.classList.add('active');
      else if (i < n) ind.classList.add('done');
    });
    state.currentStep = n;
  }

  function renderCalendar() {
    if (!calGrid) return;
    calGrid.innerHTML = '';
    const year = state.calYear, month = state.calMonth;
    document.getElementById('cal-month-label').textContent = `${['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'][month]} ${year}`;

    if (scheduleErrorMessage) { calGrid.innerHTML = `<div class="error">${scheduleErrorMessage}</div>`; return; }
    
    if (!scheduleLoaded) {
      calGrid.innerHTML = '<div class="cal-loading">Загрузка расписания...</div>';
      return;
    }

    ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].forEach(d => {
      const el = document.createElement('div'); el.className = 'cal-day-name'; el.textContent = d; calGrid.appendChild(el);
    });

    const firstDay = new Date(year, month, 1);
    let startDow = firstDay.getDay() - 1; if (startDow < 0) startDow = 6;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date(); today.setHours(0,0,0,0);

    for (let i = 0; i < startDow; i++) calGrid.appendChild(document.createElement('div'));

    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(year, month, day);
      const key = dateKey(d);
      const el = document.createElement('div');
      el.textContent = day;
      el.className = 'cal-day';
      if (d < today) el.classList.add('past');
      else if (FREE_SLOTS[key]?.length > 0) el.classList.add('available');
      if (state.selectedDate && dateKey(state.selectedDate) === key) el.classList.add('selected');
      
      if (ALL_SLOTS[key]?.length > 0 && d >= today) {
        el.addEventListener('click', () => {
          state.selectedDate = d; state.selectedTime = null; btnStep2.disabled = true;
          renderCalendar(); renderTimeSlots(d);
        });
      }
      calGrid.appendChild(el);
    }
  }

  function renderTimeSlots(d) {
    const key = dateKey(d);
    const slots = ALL_SLOTS[key] || [];
    timeSlotsCont.innerHTML = '';
    document.querySelector('.slots-hint').style.display = slots.length ? 'none' : 'block';

    slots.forEach(time => {
      const isBusy = BUSY_SLOTS[key]?.includes(time) || !FREE_SLOTS[key]?.includes(time);
      const btn = document.createElement('button');
      btn.className = 'time-slot' + (isBusy ? ' busy' : '');
      btn.textContent = time; btn.disabled = isBusy;
      if (state.selectedTime === time) btn.classList.add('selected');
      
      if (!isBusy) {
        btn.addEventListener('click', () => {
          state.selectedTime = time;
          document.querySelectorAll('.time-slot').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected'); btnStep2.disabled = false;
          document.getElementById('selected-slot-text').textContent = `${d.toLocaleDateString('ru-RU')} в ${time}`;
          document.getElementById('selected-slot-info').classList.remove('hidden');
        });
      }
      timeSlotsCont.appendChild(btn);
    });
  }

  // Навигация
  document.getElementById('btn-step1')?.addEventListener('click', () => {
    const opt = serviceSelect.options[serviceSelect.selectedIndex];
    if (!opt.value) return alert('Выберите услугу');
    state.fio = document.getElementById('fio').value;
    state.phone = document.getElementById('phone').value;
    state.email = document.getElementById('email').value;
    state.service = opt.value;
    state.serviceLabel = opt.text;
    state.price = parseInt(opt.dataset.price);
    state.comment = document.getElementById('request').value;
    goToStep(2); loadSchedule(state.service);
  });

  document.getElementById('btn-step2')?.addEventListener('click', () => {
    document.getElementById('sum-fio').textContent = state.fio;
    document.getElementById('sum-phone').textContent = state.phone;
    document.getElementById('sum-service').textContent = state.serviceLabel;
    document.getElementById('sum-slot').textContent = `${state.selectedDate.toLocaleDateString('ru-RU')} в ${state.selectedTime}`;
    document.getElementById('sum-price').textContent = `${state.price.toLocaleString()} ₽`;
    goToStep(3);
  });

  document.getElementById('btn-back1')?.addEventListener('click', () => goToStep(1));
  document.getElementById('btn-back2')?.addEventListener('click', () => goToStep(2));

  // Оплата
  document.getElementById('yoo-pay-btn')?.addEventListener('click', async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/payments/create-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: state.price, customerName: state.fio, customerPhone: state.phone,
          customerEmail: state.email, serviceId: state.service, serviceName: state.serviceLabel,
          sessionDate: dateKey(state.selectedDate), sessionTime: state.selectedTime,
          sessionDatetime: `${dateKey(state.selectedDate)}T${state.selectedTime}:00`,
          comment: state.comment
        })
      });
      const data = await response.json();
      if (data.success && data.confirmationUrl) window.location.href = data.confirmationUrl;
      else alert('Ошибка: ' + (data.error || 'Не удалось создать платеж'));
    } catch (e) { alert('Ошибка сети'); }
  });

  // Календарь - переключение месяцев
  document.getElementById('cal-prev')?.addEventListener('click', () => {
    state.calMonth--; if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; }
    renderCalendar();
  });
  document.getElementById('cal-next')?.addEventListener('click', () => {
    state.calMonth++; if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; }
    renderCalendar();
  });

  renderCalendar();
}
