/**
 * ui.js — Интерфейс: меню, скролл, навигация
 */

function initUI() {
  // 1. Бургер-меню
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
  
  document.addEventListener('keydown', e => { 
    if (e.key === 'Escape') closeMenu(); 
  });

  if (mainNav) {
    mainNav.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', closeMenu);
    });
  }

  // 2. Плавный скролл для якорей
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const targetId = this.getAttribute('href');
      if (!targetId || targetId === '#') return;
      const target = document.querySelector(targetId);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // 3. Подсветка активного пункта меню при скролле
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

  // 4. Автоскролл к оплате при загрузке, если в URL есть #payment
  if (window.location.hash === '#payment') {
    const payment = document.querySelector('#payment');
    if (payment) {
      setTimeout(() => {
        payment.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 400);
    }
  }
}
