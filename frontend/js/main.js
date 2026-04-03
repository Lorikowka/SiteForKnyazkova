/**
 * main.js — Екатерина Князькова | Психолог
 * Объединённая версия с полной поддержкой ЮKassa
 */

// ═══════════════════════════════════════════
// АВТОСКРОЛЛ К ОПЛАТЕ ПРИ ЗАГРУЗКЕ
// ═══════════════════════════════════════════
window.addEventListener('load', () => {
  const payment = document.querySelector('#payment');
  if (payment) {
    setTimeout(() => {
      payment.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 400);
  }
});

// Ждём загрузки DOM
document.addEventListener('DOMContentLoaded', () => {

// ═══════════════════════════════════════════
// БУРГЕР-МЕНЮ
// ═══════════════════════════════════════════
const burgerBtn  = document.getElementById('burger-btn');
const mainNav    = document.getElementById('main-nav');
const navOverlay = document.getElementById('nav-overlay');

function openMenu() {
  if (!burgerBtn || !mainNav) return;
  burgerBtn.classList.add('open');
  mainNav.classList.add('open');
  if (navOverlay) navOverlay.classList.add('open');
  burgerBtn.setAttribute('aria-expanded', 'true');
  document.body.style.overflow = 'hidden';
}

function closeMenu() {
  if (!burgerBtn || !mainNav) return;
  burgerBtn.classList.remove('open');
  mainNav.classList.remove('open');
  if (navOverlay) navOverlay.classList.remove('open');
  burgerBtn.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
}

if (burgerBtn) {
  burgerBtn.addEventListener('click', () => {
    burgerBtn.classList.contains('open') ? closeMenu() : openMenu();
  });
}
if (navOverlay) navOverlay.addEventListener('click', closeMenu);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
mainNav.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));

// ═══════════════════════════════════════════
// ПЛАВНЫЙ СКРОЛЛ
// ═══════════════════════════════════════════
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

// ═══════════════════════════════════════════
// АКТИВНЫЙ ПУНКТ МЕНЮ ПРИ СКРОЛЛЕ
// ═══════════════════════════════════════════
const sections = document.querySelectorAll('section[id]');
const navLinks  = document.querySelectorAll('nav a[href^="#"]');

const sectionObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      navLinks.forEach(link => {
        link.classList.toggle('active', link.getAttribute('href') === '#' + entry.target.id);
      });
    }
  });
}, { rootMargin: '-40% 0px -55% 0px' });

sections.forEach(s => sectionObserver.observe(s));

// ═══════════════════════════════════════════
// ФОРМА ЗАПИСИ — 3 ШАГА
// ═══════════════════════════════════════════

// ---- ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ----
function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ---- РАСПИСАНИЕ (заглушка) ----
const FREE_SLOTS = {};
const BUSY_SLOTS = {};

(function generateSchedule() {
  const allTimes = ['10:00','11:30','13:00','14:30','16:00','17:30','19:00'];
  const now = new Date();
  for (let i = 1; i <= 45; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue;
    const key   = dateKey(d);
    const times = allTimes.filter(() => Math.random() > 0.25);
    if (times.length > 0) FREE_SLOTS[key] = times;
  }
})();

// ---- STATE ----
const state = {
  currentStep: 1,
  fio: '', phone: '', email: '', service: '', serviceLabel: '',
  price: 0, comment: '',
  selectedDate: null, selectedTime: null,
  calYear: new Date().getFullYear(), calMonth: new Date().getMonth(),
};

// ---- DOM refs ----
const stepPanels     = [null,
  document.getElementById('step-1'),
  document.getElementById('step-2'),
  document.getElementById('step-3'),
];
const stepIndicators = [null,
  document.getElementById('step-indicator-1'),
  document.getElementById('step-indicator-2'),
  document.getElementById('step-indicator-3'),
];

const fioInput      = document.getElementById('fio');
const phoneInput    = document.getElementById('phone');
const emailInput    = document.getElementById('email');
const serviceSelect = document.getElementById('service');
const requestTA     = document.getElementById('request');

const calMonthLabel    = document.getElementById('cal-month-label');
const calGrid          = document.getElementById('calendar-grid');
const timeSlotsWrap    = document.getElementById('time-slots-wrap');
const timeSlotsCont    = document.getElementById('time-slots');
const slotsHint        = timeSlotsWrap.querySelector('.slots-hint');
const selectedSlotInfo = document.getElementById('selected-slot-info');
const selectedSlotText = document.getElementById('selected-slot-text');

const btnStep1   = document.getElementById('btn-step1');
const btnStep2   = document.getElementById('btn-step2');
const btnBack1   = document.getElementById('btn-back1');
const btnBack2   = document.getElementById('btn-back2');
const yooPayBtn  = document.getElementById('yoo-pay-btn');

const sumFio     = document.getElementById('sum-fio');
const sumPhone   = document.getElementById('sum-phone');
const sumService = document.getElementById('sum-service');
const sumSlot    = document.getElementById('sum-slot');
const sumPrice   = document.getElementById('sum-price');

const successModal = document.getElementById('success-modal');
const modalClose   = document.getElementById('modal-close');
const successText  = document.getElementById('success-text');

// ---- Навигация по шагам ----
function goToStep(n) {
  stepPanels.forEach((p, i) => {
    if (p) p.classList.toggle('hidden', i !== n);
  });
  stepIndicators.forEach((ind, i) => {
    if (!ind) return;
    ind.classList.remove('active', 'done');
    if (i === n) ind.classList.add('active');
    else if (i < n) ind.classList.add('done');
  });
  state.currentStep = n;
}

// ---- Валидация шага 1 ----
function validateStep1() {
  let ok = true;

  const fioVal   = fioInput.value.trim();
  const phoneVal = phoneInput.value.trim();
  const emailVal = emailInput.value.trim();
  const svcVal   = serviceSelect.value;

  const fioErr = document.getElementById('fio-error');
  if (!fioVal || fioVal.split(' ').filter(Boolean).length < 2) {
    fioInput.classList.add('error'); fioErr.classList.add('visible'); ok = false;
  } else {
    fioInput.classList.remove('error'); fioErr.classList.remove('visible');
  }

  const phoneErr  = document.getElementById('phone-error');
  const phoneClean = phoneVal.replace(/\D/g,'');
  if (!phoneClean || phoneClean.length < 10) {
    phoneInput.classList.add('error'); phoneErr.classList.add('visible'); ok = false;
  } else {
    phoneInput.classList.remove('error'); phoneErr.classList.remove('visible');
  }

  const emailErr = document.getElementById('email-error');
  if (emailVal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
    emailInput.classList.add('error'); emailErr.classList.add('visible'); ok = false;
  } else {
    emailInput.classList.remove('error'); emailErr.classList.remove('visible');
  }

  const svcErr = document.getElementById('service-error');
  if (!svcVal) {
    serviceSelect.classList.add('error'); svcErr.classList.add('visible'); ok = false;
  } else {
    serviceSelect.classList.remove('error'); svcErr.classList.remove('visible');
  }

  return ok;
}

// ---- Обработчики кнопок ----
if (btnStep1) {
  btnStep1.addEventListener('click', () => {
    if (!validateStep1()) return;
    const opt = serviceSelect.options[serviceSelect.selectedIndex];
    state.fio          = fioInput.value.trim();
    state.phone        = phoneInput.value.trim();
    state.email        = emailInput.value.trim();
    state.service      = serviceSelect.value;
    state.serviceLabel = opt.text;
    state.price        = parseInt(opt.dataset.price || 0, 10);
    state.comment      = requestTA.value.trim();
    goToStep(2);
    renderCalendar();
  });
}

if (btnBack1) btnBack1.addEventListener('click', () => goToStep(1));

if (btnStep2) {
  btnStep2.addEventListener('click', () => {
    if (!state.selectedDate || !state.selectedTime) return;
    fillSummary();
    goToStep(3);
  });
}

if (btnBack2) btnBack2.addEventListener('click', () => goToStep(2));

// ---- Календарь ----
const RU_MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь',
                   'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const RU_DOW    = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

const calPrev = document.getElementById('cal-prev');
const calNext = document.getElementById('cal-next');

if (calPrev) calPrev.addEventListener('click', () => {
  state.calMonth--;
  if (state.calMonth < 0) { state.calMonth = 11; state.calYear--; }
  renderCalendar();
});

if (calNext) calNext.addEventListener('click', () => {
  state.calMonth++;
  if (state.calMonth > 11) { state.calMonth = 0; state.calYear++; }
  renderCalendar();
});

function renderCalendar() {
  const year = state.calYear, month = state.calMonth;
  calMonthLabel.textContent = `${RU_MONTHS[month]} ${year}`;
  calGrid.innerHTML = '';

  RU_DOW.forEach(d => {
    const el = document.createElement('div');
    el.className = 'cal-day-name';
    el.textContent = d;
    calGrid.appendChild(el);
  });

  const firstDay = new Date(year, month, 1);
  let startDow = firstDay.getDay() - 1;
  if (startDow < 0) startDow = 6;

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date(); today.setHours(0,0,0,0);

  for (let i = 0; i < startDow; i++) {
    const el = document.createElement('div');
    el.className = 'cal-day empty';
    calGrid.appendChild(el);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const d   = new Date(year, month, day);
    const key = dateKey(d);
    const el  = document.createElement('div');
    el.textContent = day;

    const isPast      = d < today;
    const isToday     = d.getTime() === today.getTime();
    const isAvailable = !isPast && FREE_SLOTS[key] && FREE_SLOTS[key].length > 0;
    const isSelected  = state.selectedDate && dateKey(state.selectedDate) === key;

    el.className = 'cal-day';
    if (isPast)           el.classList.add('past');
    else if (isAvailable) el.classList.add('available');
    if (isToday)          el.classList.add('today');
    if (isSelected)       el.classList.add('selected');

    if (isAvailable) el.addEventListener('click', () => selectDate(d));
    calGrid.appendChild(el);
  }

  if (state.selectedDate) renderTimeSlots(state.selectedDate);
}

function selectDate(d) {
  state.selectedDate = d;
  state.selectedTime = null;
  btnStep2.disabled  = true;
  selectedSlotInfo.classList.add('hidden');
  renderCalendar();
  renderTimeSlots(d);
}

function renderTimeSlots(d) {
  const key   = dateKey(d);
  const slots = FREE_SLOTS[key] || [];
  const busy  = BUSY_SLOTS[key] || [];

  if (slots.length === 0) {
    slotsHint.style.display = 'block';
    slotsHint.textContent   = 'На выбранную дату нет свободных слотов';
  } else {
    slotsHint.style.display = 'none';
  }

  timeSlotsCont.innerHTML = '';
  slots.forEach(time => {
    const isBusy = busy.includes(time);
    const btn    = document.createElement('button');
    btn.className   = 'time-slot' + (isBusy ? ' busy' : '');
    btn.textContent = time;
    btn.disabled    = isBusy;
    if (state.selectedTime === time) btn.classList.add('selected');

    if (!isBusy) {
      btn.addEventListener('click', () => {
        state.selectedTime = time;
        document.querySelectorAll('.time-slot').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        btnStep2.disabled = false;
        const dateStr = d.toLocaleDateString('ru-RU', { weekday:'long', day:'numeric', month:'long' });
        selectedSlotText.textContent = `${dateStr} в ${time}`;
        selectedSlotInfo.classList.remove('hidden');
      });
    }
    timeSlotsCont.appendChild(btn);
  });
}

// ---- Итог (шаг 3) ----
function fillSummary() {
  sumFio.textContent   = state.fio;
  sumPhone.textContent = state.phone;
  sumService.textContent = state.serviceLabel;
  const dateStr = state.selectedDate.toLocaleDateString('ru-RU', {
    weekday:'long', day:'numeric', month:'long'
  });
  sumSlot.textContent  = `${dateStr} в ${state.selectedTime}`;
  sumPrice.textContent = state.price ? `${state.price.toLocaleString('ru-RU')} ₽` : '—';
}

// ═══════════════════════════════════════════
// ОПЛАТА ЮKASSA
// ═══════════════════════════════════════════
// Backend на том же порту, используем относительный путь
const BACKEND_URL = ''; // Пустая строка = тот же origin
// Если фронт на другом порту, укажите: 'http://localhost:1488'

async function createPayment() {
  // Валидация
  if (!state.fio || !state.phone) {
    alert('Пожалуйста, заполните ФИО и телефон');
    return;
  }
  if (!state.selectedDate || !state.selectedTime) {
    alert('Пожалуйста, выберите дату и время сеанса');
    return;
  }
  if (!state.price || state.price <= 0) {
    alert('Пожалуйста, выберите услугу');
    return;
  }

  try {
    // Форматируем дату и время для БД
    const sessionDate = state.selectedDate.toLocaleDateString('ru-RU');
    const sessionTime = state.selectedTime;
    const sessionDatetime = state.selectedDate.toISOString() + 'T' + state.selectedTime + ':00';

    console.log('📝 Создаём платёж...', {
      amount: state.price,
      description: state.serviceLabel,
      customerEmail: state.email,
      customerName: state.fio,
      customerPhone: state.phone,
      serviceName: state.serviceLabel,
      sessionDate,
      sessionTime,
      sessionDatetime,
      comment: state.comment,
      orderId: `order_${Date.now()}`
    });

    const response = await fetch(`${BACKEND_URL}/api/create-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: state.price,
        description: state.serviceLabel,
        customerEmail: state.email,
        customerName: state.fio,
        customerPhone: state.phone,
        serviceName: state.serviceLabel,
        sessionDate,
        sessionTime,
        sessionDatetime,
        comment: state.comment,
        orderId: `order_${Date.now()}`
      })
    });

    console.log('📡 Ответ от сервера:', response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Ошибка сервера:', errorText);
      throw new Error(`Server error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('✅ Данные от сервера:', data);

    if (data.success && data.confirmationUrl) {
      console.log('🔄 Перенаправление на:', data.confirmationUrl);
      window.location.href = data.confirmationUrl;
    } else {
      console.error('❌ Нет success или confirmationUrl:', data);
      alert('Ошибка создания платежа: ' + (data.error || 'Неизвестная ошибка'));
    }
  } catch (error) {
    console.error('💥 Ошибка создания платежа:', error);
    alert('Не удалось создать платёж.\n\nДетали: ' + error.message);
  }
}

if (yooPayBtn) {
  yooPayBtn.addEventListener('click', () => {
    createPayment();
  });
}

// ---- Модальное окно — закрытие ----
if (modalClose) {
  modalClose.addEventListener('click', () => {
    successModal.classList.add('hidden');
    fioInput.value = ''; phoneInput.value = ''; emailInput.value = '';
    serviceSelect.value = ''; requestTA.value = '';
    Object.assign(state, {
      fio:'', phone:'', email:'', service:'', serviceLabel:'',
      price:0, comment:'', selectedDate:null, selectedTime:null,
      calYear: new Date().getFullYear(), calMonth: new Date().getMonth(),
    });
    selectedSlotInfo.classList.add('hidden');
    btnStep2.disabled = true;
    goToStep(1);
  });
}

if (successModal) {
  successModal.addEventListener('click', e => {
    if (e.target === successModal && modalClose) modalClose.click();
  });
}

}); // DOMContentLoaded
