/**
 * gallery.js — Дипломы и Лайтбокс
 */

function initGallery() {
  let DIPLOMAS = [];
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

  async function loadDiplomas() {
    try {
      const data = await apiRequest('/api/diplomas');
      if (!data.success || !data.diplomas) throw new Error(data.error || 'Не удалось получить список дипломов');
      DIPLOMAS = data.diplomas;
      renderDiplomaPreviews();
    } catch (error) {
      if (diplomaScrollEl) {
        diplomaScrollEl.innerHTML = `<p class="diploma-error">
          Не удалось загрузить дипломы. Проверьте соединение с сервером.<br>
          <small>${sanitizeText(error.message)}</small>
        </p>`;
      }
    }
  }

  function applyLbTransform() {
    if (!lbImg) return;
    lbImg.style.transform = `translate(${lbTranslate.x}px, ${lbTranslate.y}px) scale(${lbZoom})`;
    lbImg.style.cursor = lbZoom > 1 ? 'grab' : 'zoom-in';
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
    
    // Zoom on wheel
    lbImg.addEventListener('wheel', e => {
      e.preventDefault();
      lbZoom = Math.min(4, Math.max(1, lbZoom + (e.deltaY < 0 ? 0.25 : -0.25)));
      if (lbZoom === 1) lbTranslate = { x: 0, y: 0 };
      applyLbTransform();
    }, { passive: false });

    // Drag
    lbImg.addEventListener('mousedown', e => {
      if (lbZoom <= 1) return;
      lbIsDragging = true;
      lbDragStart = { x: e.clientX - lbTranslate.x, y: e.clientY - lbTranslate.y };
      lbImg.style.cursor = 'grabbing';
      e.preventDefault();
    });
  }

  function openLightbox(index) {
    if (!lbOverlay) return;
    lbCurrentIndex = index;
    lbZoom = 1; lbTranslate = { x: 0, y: 0 };
    lbOverlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    renderLightboxImg();
  }

  function closeLightbox() {
    if (lbOverlay) lbOverlay.classList.add('hidden');
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
    diplomaNextBtn.style.opacity = diplomaScrollEl.scrollLeft >= maxScroll - 2 ? '0' : '1';
  }

  function renderDiplomaPreviews() {
    if (!diplomaScrollEl) return;
    diplomaScrollEl.innerHTML = '';
    DIPLOMAS.forEach((diploma, index) => {
      const item = document.createElement('div');
      item.className = 'diploma-item';

      const wrap = document.createElement('div');
      wrap.className = 'diploma-canvas-wrap';

      const img = document.createElement('img');
      img.src = diploma.img;
      img.alt = diploma.title;
      img.className = 'diploma-canvas';
      img.loading = 'lazy';

      const caption = document.createElement('p');
      caption.className = 'diploma-caption';
      caption.textContent = diploma.title;

      wrap.appendChild(img);
      item.appendChild(wrap);
      item.appendChild(caption);
      item.addEventListener('click', () => openLightbox(index));
      diplomaScrollEl.appendChild(item);
    });
    updateDiplomaNavButtons();
  }

  if (diplomaPrevBtn) diplomaPrevBtn.addEventListener('click', () => diplomaScrollEl.scrollBy({ left: -320, behavior: 'smooth' }));
  if (diplomaNextBtn) diplomaNextBtn.addEventListener('click', () => diplomaScrollEl.scrollBy({ left: 320, behavior: 'smooth' }));
  if (lbClose) lbClose.addEventListener('click', closeLightbox);
  if (lbOverlay) lbOverlay.addEventListener('click', e => { if (e.target === lbOverlay) closeLightbox(); });
  
  if (lbPrev) lbPrev.addEventListener('click', () => {
    lbCurrentIndex = (lbCurrentIndex - 1 + DIPLOMAS.length) % DIPLOMAS.length;
    lbZoom = 1; lbTranslate = { x: 0, y: 0 }; renderLightboxImg();
  });
  if (lbNext) lbNext.addEventListener('click', () => {
    lbCurrentIndex = (lbCurrentIndex + 1) % DIPLOMAS.length;
    lbZoom = 1; lbTranslate = { x: 0, y: 0 }; renderLightboxImg();
  });

  window.addEventListener('mousemove', e => {
    if (!lbIsDragging) return;
    lbTranslate = { x: e.clientX - lbDragStart.x, y: e.clientY - lbDragStart.y };
    applyLbTransform();
  });
  window.addEventListener('mouseup', () => {
    lbIsDragging = false;
    if (lbImg) lbImg.style.cursor = lbZoom > 1 ? 'grab' : 'zoom-in';
  });

  loadDiplomas();
}
