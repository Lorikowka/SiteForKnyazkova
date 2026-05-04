/**
 * main.js — Екатерина Князькова | Психолог
 * Объединённая версия с полной поддержкой ЮKassa
 */
function sanitizeText(value) {
  return String(value || '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

// External links should use rel="noopener noreferrer" when added dynamically.


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
document.addEventListener('DOMContentLoaded', async () => {

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
if (mainNav) {
  mainNav.querySelectorAll('a').forEach(link => link.addEventListener('click', closeMenu));
}

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

const DIPLOMAS = [
  { img: 'images/diplomas/diploma_1.png', title: 'Диплом магистра с отличием — ПсковГУ, психолого-педагогическое образование, 2025' },
  { img: 'images/diplomas/diploma_3.png', title: 'Диплом о профессиональной переподготовке — Институт прикладной психологии, психолог-тренер, 340 часов, 2025' },
  { img: 'images/diplomas/diploma_4.png', title: 'Сертификаты — Психотерапия взросления: введение и воссоединение с чувствами, 2024' },
  { img: 'images/diplomas/diploma_5.png', title: 'Сертификаты — Эмоциональный интеллект в психотерапии взросления и терапия, центрированная на чувствах, 2024' },
  { img: 'images/diploma_1/file-001.png', title: 'Диплом 1' },
  { img: 'images/diploma_2/file-001.png', title: 'Диплом 2 — файл 1' },
  { img: 'images/diploma_2/file-002.png', title: 'Диплом 2 — файл 2' },
  { img: 'images/diploma_3/file-001.png', title: 'Диплом 3' },
  { img: 'images/diploma_4/file-001.png', title: 'Диплом 4' },
  { img: 'images/diploma_5/file-001.png', title: 'Диплом 5' },
  { img: 'images/diploma_7/file-001.png', title: 'Диплом 7' },
  { img: 'images/diploma_8/file-001.png', title: 'Диплом 8' },
];

const diplomaScrollEl = document.getElementById('diplomas-scroll');
const diplomaPrevBtn  = document.getElementById('diploma-prev');
const diplomaNextBtn  = document.getElementById('diploma-next');
const lbOverlay       = document.getElementById('diploma-lightbox');
const lbCanvasWrap    = document.getElementById('lb-canvas-wrap');
const lbTitle         = document.getElementById('lb-title');
const lbClose         = document.getElementById('lb-close');
const lbPrev          = document.getElementById('lb-prev');
const lbNext          = document.getElementById('lb-next');

let lbCurrentIndex = 0;
let lbZoom = 1;
let lbIsDragging = false;
let lbDragStart = { x: 0, y: 0 };
let lbTranslate = { x: 0, y: 0 };
let lbImg = null;

function applyLbTransform() {
  if (!lbImg) return;
  lbImg.style.transform = `translate(${lbTranslate.x}px, ${lbTranslate.y}px) scale(${lbZoom})`;
  lbImg.style.cursor = lbZoom > 1 ? 'grab' : 'zoom-in';
}

function attachLbImgEvents() {
  if (!lbImg) return;

  lbImg.addEventListener('wheel', e => {
    e.preventDefault();
    lbZoom = Math.min(4, Math.max(1, lbZoom + (e.deltaY < 0 ? 0.25 : -0.25)));
    if (lbZoom === 1) lbTranslate = { x: 0, y: 0 };
    applyLbTransform();
  }, { passive: false });

  lbImg.addEventListener('mousedown', e => {
    if (lbZoom <= 1) return;
    lbIsDragging = true;
    lbDragStart = { x: e.clientX - lbTranslate.x, y: e.clientY - lbTranslate.y };
    lbImg.style.cursor = 'grabbing';
    e.preventDefault();
  });
}

function renderLightboxImg() {
  if (!lbCanvasWrap || !lbTitle) return;

  const diploma = DIPLOMAS[lbCurrentIndex];
  lbTitle.textContent = diploma.title;
  lbCanvasWrap.innerHTML = '';

  lbImg = document.createElement('img');
  lbImg.src = diploma.img;
  lbImg.alt = diploma.title;
  lbImg.style.cssText = 'max-width:90vw;max-height:85vh;object-fit:contain;display:block;user-select:none;transition:transform 0.1s;';
  applyLbTransform();
  lbCanvasWrap.appendChild(lbImg);
  attachLbImgEvents();
}

function openLightbox(index) {
  if (!lbOverlay) return;
  lbCurrentIndex = index;
  lbZoom = 1;
  lbTranslate = { x: 0, y: 0 };
  lbOverlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  renderLightboxImg();
}

function closeLightbox() {
  if (!lbOverlay) return;
  lbOverlay.classList.add('hidden');
  document.body.style.overflow = '';
}

function updateDiplomaNavButtons() {
  if (!diplomaScrollEl || !diplomaPrevBtn || !diplomaNextBtn) return;

  if (DIPLOMAS.length <= 1) {
    diplomaPrevBtn.style.display = 'none';
    diplomaNextBtn.style.display = 'none';
    return;
  }

  const maxScroll = diplomaScrollEl.scrollWidth - diplomaScrollEl.clientWidth;
  diplomaPrevBtn.style.opacity = diplomaScrollEl.scrollLeft <= 2 ? '0' : '1';
  diplomaPrevBtn.style.pointerEvents = diplomaScrollEl.scrollLeft <= 2 ? 'none' : 'auto';
  diplomaNextBtn.style.opacity = diplomaScrollEl.scrollLeft >= maxScroll - 2 ? '0' : '1';
  diplomaNextBtn.style.pointerEvents = diplomaScrollEl.scrollLeft >= maxScroll - 2 ? 'none' : 'auto';
}

function renderDiplomaPreviews() {
  if (!diplomaScrollEl) return;

  DIPLOMAS.forEach((diploma, index) => {
    const item = document.createElement('div');
    item.className = 'diploma-item';

    const imgWrap = document.createElement('div');
    imgWrap.className = 'diploma-canvas-wrap';

    const img = document.createElement('img');
    img.src = diploma.img;
    img.alt = diploma.title;
    img.className = 'diploma-canvas';
    imgWrap.appendChild(img);

    const caption = document.createElement('p');
    caption.className = 'diploma-caption';
    caption.textContent = diploma.title;

    item.appendChild(imgWrap);
    item.appendChild(caption);
    item.addEventListener('click', () => openLightbox(index));
    diplomaScrollEl.appendChild(item);
  });

  diplomaScrollEl.querySelectorAll('img').forEach(img => {
    img.addEventListener('load', updateDiplomaNavButtons);
  });

  updateDiplomaNavButtons();
}

if (diplomaScrollEl) {
  renderDiplomaPreviews();
  diplomaScrollEl.addEventListener('scroll', updateDiplomaNavButtons);
}

if (diplomaPrevBtn) {
  diplomaPrevBtn.addEventListener('click', () => {
    diplomaScrollEl.scrollBy({ left: -320, behavior: 'smooth' });
  });
}

if (diplomaNextBtn) {
  diplomaNextBtn.addEventListener('click', () => {
    diplomaScrollEl.scrollBy({ left: 320, behavior: 'smooth' });
  });
}

if (lbClose) lbClose.addEventListener('click', closeLightbox);
if (lbOverlay) {
  lbOverlay.addEventListener('click', e => {
    if (e.target === lbOverlay) closeLightbox();
  });
}
if (lbPrev) {
  lbPrev.addEventListener('click', () => {
    lbCurrentIndex = (lbCurrentIndex - 1 + DIPLOMAS.length) % DIPLOMAS.length;
    lbZoom = 1;
    lbTranslate = { x: 0, y: 0 };
    renderLightboxImg();
  });
}
if (lbNext) {
  lbNext.addEventListener('click', () => {
    lbCurrentIndex = (lbCurrentIndex + 1) % DIPLOMAS.length;
    lbZoom = 1;
    lbTranslate = { x: 0, y: 0 };
    renderLightboxImg();
  });
}

document.addEventListener('keydown', e => {
  if (!lbOverlay || lbOverlay.classList.contains('hidden')) return;
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowLeft' && lbPrev) lbPrev.click();
  if (e.key === 'ArrowRight' && lbNext) lbNext.click();
});

window.addEventListener('mousemove', e => {
  if (!lbIsDragging || !lbImg) return;
  lbTranslate = { x: e.clientX - lbDragStart.x, y: e.clientY - lbDragStart.y };
  applyLbTransform();
});

window.addEventListener('mouseup', () => {
  lbIsDragging = false;
  if (lbImg) lbImg.style.cursor = lbZoom > 1 ? 'grab' : 'zoom-in';
});

// ═══════════════════════════════════════════
// ФОРМА ЗАПИСИ — 3 ШАГА
// ═══════════════════════════════════════════

// ---- ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ----
function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ---- РАСПИСАНИЕ (загружается с бэкенда) ----
let ALL_SLOTS = {};
let FREE_SLOTS = {};
let BUSY_SLOTS = {};
let SLOT_DETAILS = {};
let scheduleLoaded = false;
let scheduleErrorMessage = '';

async function loadSchedule(serviceId = '') {
  try {
    scheduleLoaded = false;
    const params = new URLSearchParams();
    if (serviceId) params.set('service', serviceId);
    const response = await fetch(`/api/schedule?${params.toString()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.success) {
      ALL_SLOTS = data.allSlots || data.freeSlots || {};
      FREE_SLOTS = data.freeSlots || {};
      BUSY_SLOTS = data.busySlots || {};
      SLOT_DETAILS = data.slotDetails || {};
      scheduleLoaded = true;
      scheduleErrorMessage = '';
      console.log(`📅 Расписание загружено: ${Object.keys(FREE_SLOTS).length} дней`);
      // Перерисовать календарь если шаг 2 активен
      if (state.currentStep === 2) renderCalendar();
    }
  } catch (error) {
    console.error('❌ Ошибка загрузки расписания:', error);
    FREE_SLOTS = {};
    ALL_SLOTS = {};
    BUSY_SLOTS = {};
    SLOT_DETAILS = {};
    scheduleLoaded = true;
    scheduleErrorMessage = 'Не удалось загрузить актуальное расписание. Попробуйте обновить страницу чуть позже.';
    if (state.currentStep === 2) renderCalendar();
  }
}

// ---- STATE ----
const state = {
  currentStep: 1,
  fio: '', phone: '', email: '', service: '', serviceLabel: '',
  serviceType: 'individual', serviceCapacity: 1,
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

const reviewForm = document.getElementById('review-form');
const reviewNameInput = document.getElementById('review-name');
const reviewContactInput = document.getElementById('review-contact');
const reviewTextInput = document.getElementById('review-text');
const reviewSubmit = document.getElementById('review-submit');
const reviewStatus = document.getElementById('review-status');

function setReviewFieldState(input, errorEl, isValid) {
  if (!input || !errorEl) return;
  input.classList.toggle('error', !isValid);
  errorEl.classList.toggle('visible', !isValid);
}

function setReviewStatus(text, type = '') {
  if (!reviewStatus) return;
  reviewStatus.textContent = text;
  reviewStatus.classList.remove('success', 'error');
  if (type) reviewStatus.classList.add(type);
}

function getSelectedReviewRating() {
  return reviewForm?.querySelector('input[name="rating"]:checked')?.value || '';
}

function validateReviewForm() {
  const name = reviewNameInput?.value.trim() || '';
  const contact = reviewContactInput?.value.trim() || '';
  const message = reviewTextInput?.value.trim() || '';
  const rating = Number(getSelectedReviewRating());

  const isNameValid = name.length >= 2;
  const isContactValid = contact.length >= 3;
  const isMessageValid = message.length >= 10;
  const isRatingValid = Number.isInteger(rating) && rating >= 1 && rating <= 5;

  setReviewFieldState(reviewNameInput, document.getElementById('review-name-error'), isNameValid);
  setReviewFieldState(reviewContactInput, document.getElementById('review-contact-error'), isContactValid);
  setReviewFieldState(reviewTextInput, document.getElementById('review-text-error'), isMessageValid);
  document.getElementById('review-rating-error')?.classList.toggle('visible', !isRatingValid);

  return isNameValid && isContactValid && isMessageValid && isRatingValid;
}

if (reviewForm) {
  reviewForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setReviewStatus('');

    if (!validateReviewForm()) {
      setReviewStatus('Проверьте заполнение полей.', 'error');
      return;
    }

    const payload = {
      rating: Number(getSelectedReviewRating()),
      name: reviewNameInput.value.trim(),
      contact: reviewContactInput.value.trim(),
      message: reviewTextInput.value.trim()
    };

    try {
      if (reviewSubmit) {
        reviewSubmit.disabled = true;
        reviewSubmit.textContent = 'Отправляем...';
      }

      const response = await fetch(`${BACKEND_URL}/api/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Не удалось отправить отзыв');
      }

      reviewForm.reset();
      setReviewStatus('Спасибо! Отзыв отправлен.', 'success');
    } catch (error) {
      console.error('Ошибка отправки отзыва:', error);
      setReviewStatus(error.message || 'Не удалось отправить отзыв. Попробуйте позже.', 'error');
    } finally {
      if (reviewSubmit) {
        reviewSubmit.disabled = false;
        reviewSubmit.textContent = 'Отправить отзыв';
      }
    }
  });
}

if (phoneInput) {
  phoneInput.addEventListener('input', function () {
    let val = this.value.replace(/\D/g, '');
    if (val.startsWith('8')) val = '7' + val.slice(1);
    if (!val.startsWith('7')) val = '7' + val;
    val = val.slice(0, 11);

    let formatted = '+7';
    if (val.length > 1) formatted += ' (' + val.slice(1, 4);
    if (val.length >= 4) formatted += ') ' + val.slice(4, 7);
    if (val.length >= 7) formatted += '-' + val.slice(7, 9);
    if (val.length >= 9) formatted += '-' + val.slice(9, 11);
    this.value = formatted;
  });

  phoneInput.addEventListener('keydown', function (e) {
    if (e.key === 'Backspace' && this.value === '+7') {
      e.preventDefault();
      this.value = '';
    }
  });

  phoneInput.addEventListener('focus', function () {
    if (!this.value) this.value = '+7 ';
  });

  phoneInput.addEventListener('blur', function () {
    if (this.value === '+7 ' || this.value === '+7') this.value = '';
  });
}

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
  if (!emailVal || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
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
    state.serviceType  = opt.dataset.type || (state.service === 'group' ? 'group' : 'individual');
    state.serviceCapacity = parseInt(opt.dataset.capacity || (state.service === 'group' ? 10 : 1), 10);
    state.price        = parseInt(opt.dataset.price || 0, 10);
    state.comment      = requestTA.value.trim();
    state.selectedDate = null;
    state.selectedTime = null;
    btnStep2.disabled  = true;
    selectedSlotInfo.classList.add('hidden');
    goToStep(2);
    loadSchedule(state.service).then(renderCalendar);
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

// ---- Загрузка расписания с бэкенда ----
loadSchedule();

// ---- Загрузка услуг с бэкенда ----
async function loadServices() {
  try {
    const response = await fetch('/api/services');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.success && data.services) {
      const select = document.getElementById('service');
      if (!select) return;

      // Сохраняем первый option (placeholder)
      const firstOption = select.options[0];
      select.innerHTML = '';
      if (firstOption) select.appendChild(firstOption);

      data.services.forEach(svc => {
        const option = document.createElement('option');
        option.value = svc.id;
        option.textContent = `${svc.name} — ${svc.price.toLocaleString('ru-RU')} ₽`;
        option.dataset.price = svc.price;
        option.dataset.type = svc.type || 'individual';
        option.dataset.capacity = svc.capacity || 1;
        select.appendChild(option);
      });

      console.log(`🛎 Услуги загружены: ${data.services.length}`);
    }
  } catch (error) {
    console.error('❌ Ошибка загрузки услуг:', error);
    // Fallback: услуги остаются из HTML
  }
}
loadServices();

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

  // Показываем индикатор загрузки если расписание ещё не загружено
  if (!scheduleLoaded) {
    const loadingEl = document.createElement('div');
    loadingEl.style.cssText = 'grid-column: 1/-1; text-align:center; padding:20px; color:#888;';
    loadingEl.textContent = 'Загрузка расписания...';
    calGrid.appendChild(loadingEl);
    return;
  }

  if (scheduleErrorMessage) {
    const errorEl = document.createElement('div');
    errorEl.style.cssText = 'grid-column: 1/-1; text-align:center; padding:20px; color:#b33;';
    errorEl.textContent = scheduleErrorMessage;
    calGrid.appendChild(errorEl);
    timeSlotsCont.innerHTML = '';
    slotsHint.style.display = 'block';
    slotsHint.textContent = scheduleErrorMessage;
    return;
  }

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
    const hasSlots     = !isPast && ALL_SLOTS[key] && ALL_SLOTS[key].length > 0;
    const isAvailable = !isPast && FREE_SLOTS[key] && FREE_SLOTS[key].length > 0;
    const isSelected  = state.selectedDate && dateKey(state.selectedDate) === key;

    el.className = 'cal-day';
    if (isPast)           el.classList.add('past');
    else if (isAvailable) el.classList.add('available');
    if (isToday)          el.classList.add('today');
    if (isSelected)       el.classList.add('selected');

    if (hasSlots) el.addEventListener('click', () => selectDate(d));
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
  if (scheduleErrorMessage) {
    timeSlotsCont.innerHTML = '';
    slotsHint.style.display = 'block';
    slotsHint.textContent = scheduleErrorMessage;
    return;
  }

  const key   = dateKey(d);
  const allSlots = ALL_SLOTS[key] || [];
  const slots = FREE_SLOTS[key] || [];
  const busy  = BUSY_SLOTS[key] || [];
  const details = SLOT_DETAILS[key] || {};

  if (allSlots.length === 0) {
    slotsHint.style.display = 'block';
    slotsHint.textContent   = 'На выбранную дату нет свободных слотов';
  } else if (slots.length === 0) {
    slotsHint.style.display = 'block';
    slotsHint.textContent   = 'Все слоты на выбранную дату заняты';
  } else {
    slotsHint.style.display = 'none';
  }

  timeSlotsCont.innerHTML = '';
  allSlots.forEach(time => {
    const isBusy = busy.includes(time) || !slots.includes(time);
    const slotInfo = details[time];
    const btn    = document.createElement('button');
    btn.className   = 'time-slot' + (isBusy ? ' busy' : '');
    btn.textContent = state.serviceType === 'group' && slotInfo
      ? `${time} · ${slotInfo.remaining} мест`
      : time;
    btn.disabled    = isBusy;
    if (state.selectedTime === time) btn.classList.add('selected');

    if (!isBusy) {
      btn.addEventListener('click', () => {
        state.selectedTime = time;
        document.querySelectorAll('.time-slot').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        btnStep2.disabled = false;
        const dateStr = d.toLocaleDateString('ru-RU', { weekday:'long', day:'numeric', month:'long' });
        const placesText = state.serviceType === 'group' && slotInfo
          ? `, свободно мест: ${slotInfo.remaining}`
          : '';
        selectedSlotText.textContent = `${dateStr} в ${time}${placesText}`;
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
const PAYMENT_DRAFT_STORAGE_KEY = 'payment_booking_drafts';

function formatLocalSessionDate(date) {
  const localDate = new Date(date);
  const year = localDate.getFullYear();
  const month = String(localDate.getMonth() + 1).padStart(2, '0');
  const day = String(localDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatLocalSessionDatetime(date, time) {
  const [hours, minutes] = time.split(':').map(Number);
  const localDate = new Date(date);
  localDate.setHours(hours, minutes, 0, 0);

  const year = localDate.getFullYear();
  const month = String(localDate.getMonth() + 1).padStart(2, '0');
  const day = String(localDate.getDate()).padStart(2, '0');
  const normalizedHours = String(localDate.getHours()).padStart(2, '0');
  const normalizedMinutes = String(localDate.getMinutes()).padStart(2, '0');

  return `${year}-${month}-${day}T${normalizedHours}:${normalizedMinutes}:00`;
}

function getPaymentDrafts() {
  try {
    return JSON.parse(sessionStorage.getItem(PAYMENT_DRAFT_STORAGE_KEY) || '{}');
  } catch (error) {
    console.warn('Не удалось прочитать черновики оплат:', error);
    return {};
  }
}

function savePaymentDraft(paymentId, draft) {
  const drafts = getPaymentDrafts();
  drafts[paymentId] = draft;
  sessionStorage.setItem(PAYMENT_DRAFT_STORAGE_KEY, JSON.stringify(drafts));
}

function clearPaymentDraft(paymentId) {
  const drafts = getPaymentDrafts();
  if (!drafts[paymentId]) return;
  delete drafts[paymentId];
  sessionStorage.setItem(PAYMENT_DRAFT_STORAGE_KEY, JSON.stringify(drafts));
}

window.bookingDraftStorage = {
  get(paymentId) {
    const drafts = getPaymentDrafts();
    return drafts[paymentId] || null;
  },
  save: savePaymentDraft,
  clear: clearPaymentDraft
};

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
    const sessionDate = formatLocalSessionDate(state.selectedDate);
    const sessionTime = state.selectedTime;
    const sessionDatetime = formatLocalSessionDatetime(state.selectedDate, state.selectedTime);

    console.log('📝 Создаём платёж...', {
      amount: state.price,
      description: state.serviceLabel,
      orderId: `order_${Date.now()}`
    });

    const response = await fetch(`${BACKEND_URL}/api/create-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: state.price,
        description: state.serviceLabel,
        serviceId: state.service,
        customerEmail: state.email || '',
        customerName: state.fio,
        customerPhone: state.phone,
        serviceName: state.serviceLabel,
        sessionDate,
        sessionTime,
        sessionDatetime,
        comment: state.comment || '',
        orderId: `order_${Date.now()}`
      })
    });

    console.log('📡 Ответ от сервера:', response.status, response.statusText);

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      console.error('❌ Ошибка сервера:', errorData || response.statusText);

      if (response.status === 409) {
        await loadSchedule(state.service);
        goToStep(2);
        btnStep2.disabled = true;
        selectedSlotInfo.classList.add('hidden');
        state.selectedTime = null;
        alert(errorData?.error || 'Это время уже занято. Пожалуйста, выберите другой слот.');
        return;
      }

      throw new Error(errorData?.error || `Server error: ${response.status}`);
    }

    const data = await response.json();
    console.log('✅ Данные от сервера:', JSON.stringify(data, null, 2));

    if (data.success && data.confirmationUrl) {
      savePaymentDraft(data.paymentId, {
        token: data.statusToken || '',
        amount: state.price,
        description: state.serviceLabel,
        serviceId: state.service,
        customerEmail: state.email || '',
        customerName: state.fio,
        customerPhone: state.phone,
        serviceName: state.serviceLabel,
        sessionDate,
        sessionTime,
        sessionDatetime,
        comment: state.comment || ''
      });

      console.log(' Ссылка для оплаты:', data.confirmationUrl);
      console.log('💰 Сумма:', data.amount, '₽');
      console.log('🆔 ID платежа:', data.paymentId);
      console.log(' Режим:', data.mock ? 'MOCK' : 'РЕАЛЬНАЯ ОПЛАТА');
      console.log('🔄 Перенаправление на страницу оплаты...');
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
      serviceType: 'individual', serviceCapacity: 1,
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
