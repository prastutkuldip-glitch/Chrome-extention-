/**
 * Clients and rules.
 *
 * Rules are shown as plain chips next to the client they feed, because the
 * question users actually ask is "why is this time on Acme?" and the answer has
 * to be one glance away.
 */

import { el, modal, render, toast } from '../../shared/dom.js';
import { CLIENT_COLORS, createClient, createProject, createRule } from '../../../core/defaults.js';
import { RULE_KINDS, RULE_KIND_LABELS } from '../../../core/attribution.js';
import { canAddClient, maxClients } from '../../../core/plan.js';
import { formatDecimalHours, formatMoney, pluralize } from '../../../core/format.js';

export function renderClients(ctx) {
  const { app } = ctx;
  const active = app.state.clients.filter((client) => !client.archived);
  const archived = app.state.clients.filter((client) => client.archived);
  const limit = maxClients(app.plan);

  return [
    el('div.section-head', {}, [
      el('h2', { text: 'Clients' }),
      el('span.pill', { text: Number.isFinite(limit) ? `${active.length} of ${limit}` : `${active.length}` }),
      el('span.grow'),
      el('button.btn.btn-primary.btn-sm', {
        text: '+ Add client',
        on: {
          click: () => {
            if (!canAddClient(app.plan, active.length)) {
              ctx.openUpgrade();
              return;
            }
            editClient(ctx, null);
          },
        },
      }),
    ]),

    active.length
      ? el('div.card.client-card.section', {}, active.map((client) => clientRow(ctx, client)))
      : el('div.empty.section', {}, [
        el('div.strong', { text: 'No clients yet.' }),
        el('div.small', { text: 'Add one here, or let the week view suggest them from the sites you already use.' }),
      ]),

    archived.length
      ? el('section.section', {}, [
        el('div.section-head', {}, [el('h3.muted', { text: 'Archived' })]),
        el('div.card.client-card', {}, archived.map((client) => clientRow(ctx, client))),
      ])
      : null,

    el('div.card.card-pad', {}, [
      el('h3', { text: 'How attribution works' }),
      el('p.small.muted', {
        text: 'Each rule maps something about a page to a client. When more than one rule could match, the most specific wins — so github.com/acme beats a blanket github.com. Nothing is guessed: every hour on your timesheet can be traced to exactly one rule.',
      }),
    ]),
  ];
}

function clientRow(ctx, client) {
  const { app } = ctx;
  const rules = app.state.rules.filter((rule) => rule.clientId === client.id);
  const summary = app.sheet.byClient.find((entry) => entry.clientId === client.id);

  return el('div.client-row', {}, [
    el('span.dot', { style: { background: client.color, width: '11px', height: '11px' } }),
    el('div.client-meta', {}, [
      el('div.row', { style: { gap: '7px' } }, [
        el('span.strong', { text: client.name }),
        client.rate
          ? el('span.pill', { text: `${formatMoney(client.rate, app.state.settings.billing.currency)}/h` })
          : el('span.pill.pill-warn', { text: 'no rate' }),
        // Billed hours for a billable client; tracked hours for a non-billable
        // one, which would otherwise always read 0.00 and look broken.
        summary
          ? el('span.tiny.subtle', { text: `${formatDecimalHours(summary.roundedSeconds || summary.seconds)} h this week` })
          : null,
      ]),
      el('div.client-rules', {}, [
        ...rules.map((rule) => ruleChip(ctx, client, rule)),
        el('button.btn.btn-sm.btn-ghost', {
          text: '+ rule',
          on: { click: () => editRule(ctx, client, null) },
        }),
        el('button.btn.btn-sm.btn-ghost', {
          text: (client.projects || []).length ? `Projects (${client.projects.length})` : '+ project',
          on: { click: () => editProjects(ctx, client) },
        }),
      ]),
      rules.length ? null : el('div.tiny.subtle', { text: 'No rules yet — this client will never collect time.' }),
    ]),
    el('div.row', { style: { flex: 'none' } }, [
      el('button.btn.btn-sm', { text: 'Edit', on: { click: () => editClient(ctx, client) } }),
      el('button.btn.btn-sm.btn-ghost', {
        text: client.archived ? 'Restore' : 'Archive',
        on: { click: () => toggleArchive(ctx, client) },
      }),
    ]),
  ]);
}

function ruleChip(ctx, client, rule) {
  const { app } = ctx;
  const project = client.projects?.find((entry) => entry.id === rule.projectId);
  const label = `${RULE_KIND_LABELS[rule.kind]}: ${rule.value}${project ? ` → ${project.name}` : ''} — click to edit`;

  return el(`span.rule-chip${rule.enabled === false ? '.rule-chip-off' : ''}`, { title: label }, [
    el('span.rule-chip-label', {
      text: rule.value,
      on: { click: () => editRule(ctx, client, rule) },
    }),
    project ? el('span.tiny.subtle', { text: project.name }) : null,
    rule.billable === false ? el('span.tiny', { text: 'n/b' }) : null,
    el('button', {
      text: '\u00d7',
      title: 'Delete this rule',
      on: {
        click: async () => {
          await ctx.saveRules(app.state.rules.filter((entry) => entry.id !== rule.id));
          toast('Rule deleted.');
        },
      },
    }),
  ]);
}

function editClient(ctx, client) {
  const { app } = ctx;
  const isNew = !client;
  const draft = client ? { ...client } : createClient({ rate: app.state.settings.billing.defaultRate });

  const nameInput = el('input.input', { value: draft.name === 'New client' && isNew ? '' : draft.name, placeholder: 'Acme Corp' });
  const rateInput = el('input.input', { type: 'number', min: '0', step: '1', value: draft.rate || '' });
  let color = draft.color;

  const swatches = el('div.color-swatches', {}, CLIENT_COLORS.map((option) => {
    const swatch = el(`span.swatch${option === color ? '.selected' : ''}`, {
      style: { background: option },
      title: option,
      on: {
        click: (event) => {
          color = option;
          for (const node of event.target.parentElement.children) node.classList.remove('selected');
          event.target.classList.add('selected');
        },
      },
    });
    return swatch;
  }));

  const { close } = modal({
    title: isNew ? 'Add client' : 'Edit client',
    body: [
      el('div.field', {}, [el('span.label', { text: 'Name' }), nameInput]),
      el('div.field', {}, [
        el('span.label', { text: `Hourly rate (${app.state.settings.billing.currency})` }),
        rateInput,
        el('span.hint', { text: 'Leave empty for clients you only want to track, not bill.' }),
      ]),
      el('div.field', {}, [el('span.label', { text: 'Colour' }), swatches]),
      isNew ? null : el('div.field', {}, [
        el('span.label', { text: 'Danger zone' }),
        el('button.btn.btn-danger', {
          text: 'Delete client and its rules',
          on: {
            click: async () => {
              close();
              await ctx.saveClients(app.state.clients.filter((entry) => entry.id !== client.id));
              await ctx.saveRules(app.state.rules.filter((rule) => rule.clientId !== client.id));
              toast('Client deleted. Recorded time is kept and shown as unassigned.');
            },
          },
        }),
        el('span.hint', { text: 'Deleting a client never deletes your recorded hours — they return to the review queue.' }),
      ]),
    ],
    actions: [
      el('button.btn', { text: 'Cancel', on: { click: () => close() } }),
      el('button.btn.btn-primary', {
        text: isNew ? 'Add client' : 'Save',
        on: {
          click: async () => {
            const name = nameInput.value.trim();
            if (!name) {
              toast('Give the client a name.', 'warn');
              return;
            }
            const updated = { ...draft, name, rate: Number(rateInput.value) || 0, color };
            const clients = isNew
              ? [...app.state.clients, updated]
              : app.state.clients.map((entry) => (entry.id === updated.id ? updated : entry));
            close();
            await ctx.saveClients(clients);
            toast(isNew ? `${name} added.` : 'Saved.');
            if (isNew) editRule(ctx, updated, null);
          },
        },
      }),
    ],
  });

  nameInput.focus();
}

function editRule(ctx, client, rule) {
  const { app } = ctx;
  const isNew = !rule;
  const draft = rule ? { ...rule } : createRule({ clientId: client.id, kind: 'hostname', value: '' });

  const kindSelect = el('select.select', {}, RULE_KINDS.map((kind) => el('option', {
    value: kind,
    text: RULE_KIND_LABELS[kind],
    selected: kind === draft.kind,
  })));
  const valueInput = el('input.input', { value: draft.value, placeholder: 'acme.atlassian.net' });
  const billableInput = el('input', { type: 'checkbox', checked: draft.billable !== false });

  const projects = client.projects || [];
  const projectSelect = el('select.select', {}, [
    el('option', { value: '', text: 'No project' }),
    ...projects.map((project) => el('option', {
      value: project.id,
      text: project.name,
      selected: project.id === draft.projectId,
    })),
  ]);

  const hint = el('span.hint', {});
  const updateHint = () => {
    hint.textContent = {
      hostname: 'Matches this domain and all of its subdomains.',
      path: 'Matches a domain plus the start of a path, e.g. github.com/acme-corp.',
      title: 'Matches when the page title contains this text — useful for shared tools like Google Docs.',
      regex: 'Advanced: a regular expression tested against "hostname/path title".',
    }[kindSelect.value];
  };
  kindSelect.addEventListener('change', updateHint);
  updateHint();

  const { close } = modal({
    title: isNew ? `New rule for ${client.name}` : `Edit rule for ${client.name}`,
    body: [
      el('div.field', {}, [el('span.label', { text: 'Match on' }), kindSelect, hint]),
      el('div.field', {}, [el('span.label', { text: 'Value' }), valueInput]),
      projects.length
        ? el('div.field', {}, [
          el('span.label', { text: 'Project' }),
          projectSelect,
          el('span.hint', { text: 'Time matched by this rule is filed under this project.' }),
        ])
        : null,
      el('label.switch', {}, [billableInput, el('span', { text: 'Time matched by this rule is billable' })]),
    ],
    actions: [
      el('button.btn', { text: 'Cancel', on: { click: () => close() } }),
      el('button.btn.btn-primary', {
        text: 'Save rule',
        on: {
          click: async () => {
            const value = valueInput.value.trim().toLowerCase();
            if (!value) {
              toast('Enter something to match on.', 'warn');
              return;
            }
            const updated = {
              ...draft,
              kind: kindSelect.value,
              value,
              projectId: projectSelect.value || null,
              billable: billableInput.checked,
            };
            const rules = isNew
              ? [...app.state.rules, updated]
              : app.state.rules.map((entry) => (entry.id === updated.id ? updated : entry));
            close();
            await ctx.saveRules(rules);
            toast('Rule saved.');
          },
        },
      }),
    ],
  });

  valueInput.focus();
}

async function toggleArchive(ctx, client) {
  const { app } = ctx;
  const clients = app.state.clients.map((entry) => (
    entry.id === client.id ? { ...entry, archived: !entry.archived } : entry
  ));
  await ctx.saveClients(clients);
  toast(client.archived ? `${client.name} restored.` : `${client.name} archived. ${pluralize(app.state.rules.filter((rule) => rule.clientId === client.id).length, 'rule')} kept.`);
}


/**
 * Projects.
 *
 * A client with several workstreams needs them separated on the invoice, and the
 * timesheet already understands projects — this is the missing way to create one.
 */
function editProjects(ctx, client) {
  const { app } = ctx;
  let projects = [...(client.projects || [])];

  const list = el('div.col', { style: { gap: '6px' } });
  const nameInput = el('input.input', { placeholder: 'Website redesign' });

  const usedBy = (projectId) => app.state.rules.filter((rule) => rule.projectId === projectId).length;

  const paint = () => {
    render(list, projects.length
      ? projects.map((project) => {
        const rename = el('input.input.input-sm', { value: project.name });
        rename.addEventListener('change', () => {
          const value = rename.value.trim();
          if (value) project.name = value;
        });
        const rules = usedBy(project.id);
        return el('div.row', {}, [
          rename,
          rules ? el('span.pill.tiny', { text: `${rules} rule${rules === 1 ? '' : 's'}` }) : null,
          el('button.btn.btn-sm.btn-ghost', {
            text: '\u00d7',
            title: rules ? 'Remove; rules using it fall back to no project' : 'Remove',
            on: {
              click: () => {
                projects = projects.filter((entry) => entry.id !== project.id);
                paint();
              },
            },
          }),
        ]);
      })
      : el('div.tiny.subtle', { text: 'No projects yet. Everything is billed to the client directly.' }));
  };
  paint();

  const add = () => {
    const name = nameInput.value.trim();
    if (!name) return;
    projects = [...projects, createProject({ name })];
    nameInput.value = '';
    paint();
    nameInput.focus();
  };
  nameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') add();
  });

  const { close } = modal({
    title: `Projects for ${client.name}`,
    body: [
      el('p.small.muted', {
        text: 'Optional. Use projects when one client has separate workstreams you want shown separately on the invoice.',
      }),
      list,
      el('div.row', { style: { marginTop: '4px' } }, [
        nameInput,
        el('button.btn.btn-sm', { text: 'Add', on: { click: add } }),
      ]),
    ],
    actions: [
      el('button.btn', { text: 'Cancel', on: { click: () => close() } }),
      el('button.btn.btn-primary', {
        text: 'Save projects',
        on: {
          click: async () => {
            close();
            const keptIds = new Set(projects.map((project) => project.id));
            await ctx.saveClients(app.state.clients.map((entry) => (
              entry.id === client.id ? { ...entry, projects } : entry
            )));
            // A rule pointing at a deleted project would file time under a name
            // that no longer exists, so clear those references.
            const orphaned = app.state.rules.filter(
              (rule) => rule.clientId === client.id && rule.projectId && !keptIds.has(rule.projectId),
            );
            if (orphaned.length) {
              await ctx.saveRules(app.state.rules.map((rule) => (
                orphaned.includes(rule) ? { ...rule, projectId: null } : rule
              )));
            }
            toast('Projects saved.');
          },
        },
      }),
    ],
  });

  nameInput.focus();
}
