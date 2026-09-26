/**
 * The page the checkout redirects to after a successful payment.
 *
 * Best case: it hands the licence key straight to the extension and Pro is on
 * before the buyer has finished reading the heading. Every other case has to
 * degrade into something a person can still act on, because this page is only
 * ever seen by someone who has already paid. So if the extension is missing, or
 * the browser is not Chrome, or the key is absent, the page says so plainly and
 * shows the key with a copy button.
 */

const CONFIG = {
  supportEmail: 'support@billed.app',

  /**
   * The published extension ID. Chrome assigns this when the listing goes live,
   * so it is empty until then — and while it is empty this page shows the manual
   * instructions instead of pretending to do something.
   *
   * For testing an unpacked build, append `?ext=<id>` to this page's URL; the id
   * is shown on chrome://extensions.
   */
  extensionId: '',

  storeUrl: '',
};

const KEY_PARAMS = ['license_key', 'licence_key', 'license', 'licence', 'key'];
const EMAIL_PARAMS = ['email', 'buyer_email', 'purchaser_email'];

const params = new URLSearchParams(location.search);
const first = (names) => {
  for (const name of names) {
    const value = params.get(name);
    if (value && value.trim()) return value.trim();
  }
  return '';
};

const key = first(KEY_PARAMS);
const email = first(EMAIL_PARAMS);
const extensionId = params.get('ext') || CONFIG.extensionId;

const $ = (id) => document.getElementById(id);

for (const link of document.querySelectorAll('[data-support-link]')) {
  link.href = `mailto:${CONFIG.supportEmail}`;
}

function show({ eyebrow, heading, message, spinner = false }) {
  $('eyebrow').textContent = eyebrow;
  $('heading').textContent = heading;
  $('message').textContent = message;
  $('spinner-row').hidden = !spinner;
}

function fallback(reason) {
  $('manual').hidden = false;
  $('spinner-row').hidden = true;
  $('key-text').textContent = key || 'Check your emailed receipt';
  $('manual-why').textContent = reason;

  const install = $('install');
  if (CONFIG.storeUrl) {
    install.href = CONFIG.storeUrl;
    install.target = '_blank';
    install.rel = 'noopener';
  }
}

$('copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(key);
    $('copy').textContent = 'Copied';
    setTimeout(() => { $('copy').textContent = 'Copy key'; }, 2000);
  } catch {
    $('copy').textContent = 'Select the key above and copy it';
  }
});

/** Messaging an extension from a page is Chrome-only and needs its id. */
function canMessageExtension() {
  return Boolean(extensionId) && typeof chrome !== 'undefined' && Boolean(chrome.runtime?.sendMessage);
}

function sendToExtension(message, timeoutMs = 4000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    setTimeout(() => done({ ok: false, error: 'timeout' }), timeoutMs);
    try {
      chrome.runtime.sendMessage(extensionId, message, (response) => {
        // A missing extension surfaces as lastError, not an exception.
        if (chrome.runtime.lastError) return done({ ok: false, error: 'not-installed' });
        done(response || { ok: false, error: 'no-response' });
      });
    } catch {
      done({ ok: false, error: 'blocked' });
    }
  });
}

async function run() {
  if (!key) {
    show({
      eyebrow: 'Hmm',
      heading: 'No licence key in this link',
      message: 'Your purchase is fine — the key just is not in this URL. It is in your emailed receipt.',
    });
    fallback('This page was opened without a key, so there is nothing to activate automatically.');
    return;
  }

  if (!canMessageExtension()) {
    show({
      eyebrow: 'Almost there',
      heading: 'Thank you — payment received',
      message: 'Your licence key is below. Activating takes about thirty seconds.',
    });
    fallback(extensionId
      ? 'Automatic activation needs Chrome. On another browser, paste the key by hand.'
      : 'Automatic activation switches on once Billed is published on the Chrome Web Store. Until then, paste the key — it works exactly the same.');
    return;
  }

  const response = await sendToExtension({ type: 'billed:activate', key, email });

  if (response.ok && response.state === 'active') {
    show({
      eyebrow: 'Done',
      heading: 'Pro is unlocked',
      message: 'Billed is open in another tab with your full history. Nothing else to do — thank you for buying.',
    });
    $('card').classList.add('panel-yes');
    return;
  }

  if (response.ok && response.state === 'pending') {
    show({
      eyebrow: 'One more tap',
      heading: 'Billed is open — confirm to finish',
      message: 'Switch to the Billed tab and press "Activate Pro". Chrome asks once for permission to check your licence; only the key is sent.',
    });
    return;
  }

  show({
    eyebrow: 'Almost there',
    heading: 'Thank you — payment received',
    message: 'Your licence key is below, and activating takes about thirty seconds.',
  });
  fallback(response.error === 'not-installed'
    ? 'Billed is not installed in this browser yet, so install it first and then paste the key.'
    : 'The extension did not answer, which usually means it is not installed in this browser.');
}

run().catch((error) => {
  console.error(error);
  show({
    eyebrow: 'Almost there',
    heading: 'Thank you — payment received',
    message: 'Something went wrong on this page, but your purchase is safe. Use the key below.',
  });
  fallback('Automatic activation hit an error. The manual route works exactly the same.');
});
