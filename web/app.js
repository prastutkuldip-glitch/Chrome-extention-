/**
 * Landing page behaviour: currency switching and checkout links.
 *
 * SITE_CONFIG mirrors extension/src/config.js. Fill in the same values in both
 * places at launch (docs/PAYMENTS_SETUP.md lists exactly what goes where), and
 * everything below wires itself up. While a link is still a PLACEHOLDER the page
 * degrades honestly rather than sending someone to a dead checkout.
 */

const SITE_CONFIG = {
  supportEmail: 'support@billed.app',

  // Chrome Web Store listing URL. Empty until Google approves the listing.
  storeUrl: '',

  // Direct download of the packaged build, used while review is pending.
  buildUrl: 'billed-v1.0.0.zip',

  checkout: {
    monthly: 'https://PLACEHOLDER.gumroad.com/l/billed-pro?variant=Monthly',
    yearly: 'https://PLACEHOLDER.gumroad.com/l/billed-pro?variant=Yearly',
    lifetime: 'https://PLACEHOLDER.gumroad.com/l/billed-lifetime',
  },

  pricing: {
    default: { currency: 'USD', symbol: '$', monthly: 15, yearly: 99, lifetime: 149, saving: 45 },
    india: { currency: 'INR', symbol: '₹', monthly: 499, yearly: 3499, lifetime: 6999, saving: 42 },
  },

  /**
   * Direct UPI, for selling in India before a card processor is set up.
   * Leave `id` empty and the whole panel stays hidden — so the page never shows
   * a half-finished payment instruction.
   */
  upi: {
    id: '',              // e.g. 'yourname@oksbi'
    name: '',            // the name UPI shows on confirmation, so buyers trust it
    amount: '₹3,499',    // what the buyer should send
    note: 'Keys are issued by hand, so allow a few hours. Refunds within 14 days, no questions.',
  },
};

const configured = (url) => Boolean(url) && !url.includes('PLACEHOLDER');
const money = (symbol, amount) => `${symbol}${amount.toLocaleString('en-US')}`;

// ------------------------------------------------------------------ pricing

let region = /-IN\b/i.test(navigator.language || '') ? 'india' : 'default';

function paintPricing() {
  const price = SITE_CONFIG.pricing[region];

  setPrice('yearly', money(price.symbol, price.yearly), '/year');
  setPrice('lifetime', money(price.symbol, price.lifetime), ' once');

  setNote('yearly', `works out to ${money(price.symbol, Math.round(price.yearly / 12))} a month — save ${price.saving}%`);
  setNote('monthly-alt', `Prefer monthly? ${money(price.symbol, price.monthly)}/month, cancel any time.`);

  for (const button of document.querySelectorAll('[data-region]')) {
    button.setAttribute('aria-pressed', String(button.dataset.region === region));
  }
}

function setPrice(key, amount, suffix) {
  const node = document.querySelector(`[data-price="${key}"]`);
  if (!node) return;
  node.textContent = amount;
  const small = document.createElement('small');
  small.textContent = suffix;
  node.append(small);
}

function setNote(key, text) {
  const node = document.querySelector(`[data-note="${key}"]`);
  if (node) node.textContent = text;
}

for (const button of document.querySelectorAll('[data-region]')) {
  button.addEventListener('click', () => {
    region = button.dataset.region;
    paintPricing();
    paintCheckout();
  });
}

// ------------------------------------------------------------------ checkout

function paintCheckout() {
  for (const link of document.querySelectorAll('[data-checkout]')) {
    const url = SITE_CONFIG.checkout[link.dataset.checkout];
    if (configured(url)) {
      link.href = url;
      link.removeAttribute('aria-disabled');
      link.onclick = null;
    } else {
      link.href = '#pricing';
      link.setAttribute('aria-disabled', 'true');
      link.title = 'Checkout opens at launch';
      link.onclick = (event) => {
        event.preventDefault();
        alert('Checkout is not live yet. Payments go live with the launch — see the repository README.');
      };
    }
  }
}

// ------------------------------------------------------------------ install

function paintInstall() {
  const onStore = configured(SITE_CONFIG.storeUrl);

  for (const link of document.querySelectorAll('[data-store-link]')) {
    link.href = onStore ? SITE_CONFIG.storeUrl : SITE_CONFIG.buildUrl;
    link.textContent = onStore ? 'Add to Chrome' : 'Download the build';
  }

  if (onStore) {
    for (const cta of document.querySelectorAll('[data-install-cta]')) {
      cta.href = SITE_CONFIG.storeUrl;
      cta.target = '_blank';
      cta.rel = 'noopener';
    }
    const heading = document.querySelector('[data-install-heading]');
    if (heading) heading.textContent = 'Install Billed';
    const intro = document.querySelector('[data-install-intro]');
    if (intro) {
      intro.innerHTML = '<strong>Billed is on the Chrome Web Store.</strong> '
        + 'One click and it starts recording. Prefer to inspect the source first? '
        + 'The manual steps below still work.';
    }
  }
}

// ------------------------------------------------------------------ support

for (const link of document.querySelectorAll('[data-support-link]')) {
  link.href = `mailto:${SITE_CONFIG.supportEmail}`;
  link.textContent = 'Support';
}

// ------------------------------------------------------------------ upi

function paintUpi() {
  const box = document.querySelector('[data-upi-box]');
  if (!box) return;

  const { id, name, amount, note } = SITE_CONFIG.upi;
  if (!id) {
    box.hidden = true; // nothing configured: show nothing rather than a blank
    return;
  }

  box.hidden = false;
  const set = (selector, text) => {
    const node = box.querySelector(selector);
    if (node) node.textContent = text;
  };
  set('[data-upi-id]', id);
  set('[data-upi-amount]', amount || '');
  set('[data-upi-name]', name ? ` (${name})` : '');
  set('[data-upi-email]', SITE_CONFIG.supportEmail);
  set('[data-upi-note]', note || '');
}

paintPricing();
paintCheckout();
paintInstall();
paintUpi();
