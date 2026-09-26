/**
 * Finishing an activation that arrived from the checkout page.
 *
 * A key from the payment provider has to be checked over the network, and Chrome
 * only grants `permissions.request` from a real gesture inside our own UI. So the
 * buyer gets one button instead of a copy-and-paste: the key is already here,
 * they just confirm.
 *
 * Keys we issued ourselves never reach this screen — those verify locally and are
 * already active by the time the dashboard opens.
 */

import { el, modal, toast } from '../../shared/dom.js';
import { maskKey } from '../../../core/activation.js';
import { MSG, send } from '../../../platform/messages.js';
import { clearPendingActivation, getPendingActivation } from '../../../platform/store.js';

/**
 * Show the finish-activation dialog if one is waiting.
 * @returns {Promise<boolean>} whether a dialog was shown
 */
export async function maybeFinishActivation(ctx) {
  const pending = await getPendingActivation();
  if (!pending?.key) return false;

  const status = el('div.small.muted', {
    text: 'One confirmation and Pro is on. Your key is already here — nothing to type.',
  });
  const spinner = el('span.spinner.hidden');

  const activate = async (button) => {
    button.disabled = true;
    spinner.classList.remove('hidden');
    status.textContent = 'Checking your licence…';

    const response = await send(MSG.activateLicense, { key: pending.key });
    spinner.classList.add('hidden');

    if (response.ok) {
      await clearPendingActivation();
      close();
      await ctx.reload();
      toast('Pro unlocked. Thank you — genuinely.');
      return;
    }

    button.disabled = false;
    status.textContent = response.message
      || 'That did not go through. You can try again, or paste the key in Settings \u203a Plan.';
  };

  const confirmButton = el('button.btn.btn-primary', { text: 'Activate Pro' });
  confirmButton.addEventListener('click', () => activate(confirmButton));

  const { close } = modal({
    title: 'Finish activating Billed Pro',
    body: [
      el('div.banner.banner-accent', {}, [
        el('div.strong', { text: 'Payment received. Almost there.' }),
        el('div.small', { text: `Licence ${maskKey(pending.key)}${pending.email ? ` · ${pending.email}` : ''}` }),
      ]),
      status,
      el('p.tiny.subtle', {
        text: 'Chrome will ask once for permission to reach the licence server. That single request is the only network access Billed ever uses, and only your licence key is sent — never your activity.',
      }),
      el('div.row', {}, [spinner]),
    ],
    actions: [
      el('button.btn', {
        text: 'Later',
        on: {
          click: async () => {
            close();
            toast('Saved. Finish any time from Settings \u203a Plan.');
          },
        },
      }),
      confirmButton,
    ],
    onClose: () => {},
  });

  return true;
}

/** A persistent nudge on the Settings page while an activation is waiting. */
export function pendingBanner(ctx, pending) {
  if (!pending?.key) return null;
  return el('div.banner.banner-accent.section', {}, [
    el('div.row', {}, [
      el('div.grow', {}, [
        el('div.strong', { text: 'A licence is waiting to be activated' }),
        el('div.small', { text: `Licence ${maskKey(pending.key)} arrived from your purchase.` }),
      ]),
      el('button.btn.btn-sm.btn-primary', {
        text: 'Activate now',
        on: { click: () => maybeFinishActivation(ctx) },
      }),
      el('button.btn.btn-sm.btn-ghost', {
        text: 'Dismiss',
        on: {
          click: async () => {
            await clearPendingActivation();
            await ctx.reload();
          },
        },
      }),
    ]),
  ]);
}
