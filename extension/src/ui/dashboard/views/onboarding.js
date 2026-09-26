/**
 * First run.
 *
 * The one objection that kills a product like this is "so it watches
 * everything?". So the first screen answers it plainly, before asking for
 * anything, and shows the user exactly how to switch parts of it off.
 */

import { el, modal, toast } from '../../shared/dom.js';
import { createClient, createRule } from '../../../core/defaults.js';
import { SUGGESTED_BLOCKLIST } from '../../../core/privacy.js';

export function maybeShowOnboarding(ctx) {
  const { app } = ctx;
  const suggestions = (app.sheet?.unassigned || []).slice(0, 4);

  const inputs = suggestions.map((group) => {
    const checkbox = el('input', { type: 'checkbox', checked: true });
    return {
      group,
      checkbox,
      node: el('label.switch', { style: { display: 'flex', gap: '9px', padding: '5px 0' } }, [
        checkbox,
        el('div.grow', {}, [
          el('div.small.strong', { text: group.label }),
          el('div.tiny.subtle', { text: group.ruleValue }),
        ]),
      ]),
    };
  });

  const { close } = modal({
    title: 'Welcome to Billed',
    body: [
      el('p', {
        text: 'Billed watches which work sites you are actually on and rebuilds your billable hours from that, so Friday afternoon stops being an exercise in memory.',
      }),

      el('div.card.card-pad', {}, [
        el('h3', { text: 'Before anything else: where your data lives' }),
        el('ul.feature-list', { style: { marginTop: '8px' } }, [
          el('li', { text: 'Everything stays in this browser profile. There is no account and no server to send it to.' }),
          el('li', { text: 'Billed stores a domain, a path, a page title and two timestamps. Never the query string, never page contents.' }),
          el('li', { text: `${SUGGESTED_BLOCKLIST.length} patterns — banking, health, adult, personal social — are already on the never-track list.` }),
          el('li', { text: 'A fresh install has no network permission at all. One is requested only if you activate a licence.' }),
        ]),
      ]),

      inputs.length
        ? el('div.field', {}, [
          el('span.label', { text: 'Sites you have already been on — shall I make these clients?' }),
          el('div.card.card-pad', {}, inputs.map((entry) => entry.node)),
          el('span.hint', { text: 'You can rename them, set rates, and add more at any time.' }),
        ])
        : el('div.banner.banner-accent', {
          text: 'Keep working as normal. Come back at the end of the day and Billed will have something to show you.',
        }),
    ],
    actions: [
      el('button.btn', {
        text: 'Skip for now',
        on: {
          click: async () => {
            close();
            await complete(ctx);
          },
        },
      }),
      el('button.btn.btn-primary', {
        text: inputs.length ? 'Create these clients' : 'Get started',
        on: {
          click: async () => {
            close();
            const chosen = inputs.filter((entry) => entry.checkbox.checked);
            if (chosen.length) {
              const clients = [...ctx.app.state.clients];
              const rules = [...ctx.app.state.rules];
              for (const entry of chosen) {
                const client = createClient({
                  name: entry.group.label,
                  rate: ctx.app.state.settings.billing.defaultRate,
                });
                clients.push(client);
                rules.push(createRule({
                  clientId: client.id,
                  kind: entry.group.ruleKind,
                  value: entry.group.ruleValue,
                }));
              }
              await ctx.saveClients(clients);
              await ctx.saveRules(rules);
              toast(`${chosen.length} client${chosen.length === 1 ? '' : 's'} created.`);
            }
            await complete(ctx);
          },
        },
      }),
    ],
  });
}

async function complete(ctx) {
  const settings = structuredClone(ctx.app.state.settings);
  settings.onboarding.completed = true;
  await ctx.saveSettings(settings);
  if (location.hash === '#welcome') history.replaceState(null, '', '#week');
}
