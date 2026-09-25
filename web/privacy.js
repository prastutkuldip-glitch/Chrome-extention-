/** Privacy page: only the support link needs wiring. Keep in sync with app.js. */

const SUPPORT_EMAIL = 'support@billed.app';

for (const link of document.querySelectorAll('[data-support-link]')) {
  link.href = `mailto:${SUPPORT_EMAIL}`;
  if (!link.textContent.trim()) link.textContent = SUPPORT_EMAIL;
}
