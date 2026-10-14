// Acme Pulse: the monthly/annual billing toggle on the pricing cards.
const toggle = document.querySelector('[data-billing]');
toggle?.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-period]');
  if (!btn) return;
  for (const b of toggle.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b === btn));
  document.body.dataset.period = btn.dataset.period;
});
