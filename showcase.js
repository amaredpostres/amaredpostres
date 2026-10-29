/* Editorial AMARED photographs. No inference about product flavors or availability. */
(() => {
  const showcase = document.querySelector('.heroShowcase');
  if (!showcase || shouldUseIndexAdminView()) return;
  const slides = [...showcase.querySelectorAll('[data-hero-scene]')];
  const selectors = [...showcase.querySelectorAll('[data-hero-select]')];
  const controls = showcase.querySelector('.heroControls');
  const pause = document.getElementById('heroPause');
  const label = document.getElementById('heroProductName');
  const announcement = document.getElementById('heroAnnouncement');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let available = slides;
  let current = slides[0];
  let paused = reduced.matches;
  let hovered = false;
  let focused = false;
  let visible = false;
  let timer;

  const show = (slide, announce = false) => {
    current = slide;
    slides.forEach(image => {
      const active = image === current;
      image.classList.toggle('is-active', active);
      image.setAttribute('aria-hidden', String(!active));
    });
    selectors.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.heroSelect === current.dataset.heroScene)));
    label.textContent = current.dataset.caption;
    if (announce) announcement.textContent = current.alt;
  };
  const schedule = () => {
    clearTimeout(timer);
    pause.textContent = paused ? 'Reanudar' : 'Pausar';
    pause.setAttribute('aria-label', `${paused ? 'Reanudar' : 'Pausar'} cambio automático de fotografías`);
    if (paused || hovered || focused || !visible || document.hidden || available.length < 2) return;
    timer = setTimeout(() => {
      show(available[(available.indexOf(current) + 1) % available.length]);
      schedule();
    }, 6000);
  };
  const refresh = () => {
    available = slides;
    showcase.hidden = !available.length;
    controls.hidden = available.length < 2;
    selectors.forEach(button => { button.hidden = !available.some(image => image.dataset.heroScene === button.dataset.heroSelect); });
    if (available.length && !available.includes(current)) show(available[0]);
    schedule();
  };
  selectors.forEach(button => button.addEventListener('click', () => {
    const slide = available.find(image => image.dataset.heroScene === button.dataset.heroSelect);
    if (!slide) return;
    paused = true;
    show(slide, true);
    schedule();
  }));
  pause.addEventListener('click', () => { paused = !paused; schedule(); });
  showcase.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') { hovered = true; schedule(); } });
  showcase.addEventListener('pointerleave', () => { hovered = false; schedule(); });
  showcase.addEventListener('focusin', () => { focused = true; schedule(); });
  showcase.addEventListener('focusout', () => queueMicrotask(() => { focused = showcase.contains(document.activeElement); schedule(); }));
  document.addEventListener('visibilitychange', schedule);
  window.addEventListener('pagehide', () => clearTimeout(timer));
  window.addEventListener('pageshow', schedule);
  reduced.addEventListener('change', () => { paused = reduced.matches; schedule(); });
  new IntersectionObserver(entries => { visible = entries[0].isIntersecting; schedule(); }).observe(showcase);
  refresh();
})();
