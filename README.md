# Billed

**Rebuild your week's billable hours from what you actually did.**

Billed is a Chrome extension for people who bill by the hour. It watches which work tools you are
actually in, groups the time by client, attaches the ticket keys it finds, and turns Friday
afternoon from an exercise in memory into a ten-second export.

Everything runs on the device. There is no account, no server, and no content scripts.

> Consultants leave 15–20% of billable time unlogged, because reconstructing a week from memory
> always rounds down. For one person at $100/hour that is over $20,000 a year.
> See [IDEA.md](IDEA.md) for the full research, the competitive scan and the honest risks.

---

## Quick start

```bash
# Run the test suite (110 tests, zero dependencies)
npm test

# Static verification: syntax, imports, manifest, MV3 CSP rules
npm run check

# Regenerate the icon set
npm run icons

# Build the Chrome Web Store zip into dist/
npm run package

# Open the real UI in an ordinary browser tab, with a seeded sample week
npm run preview
python3 -m http.server 8137
#   http://localhost:8137/extension/src/ui/dashboard/preview.html
#   http://localhost:8137/extension/src/ui/popup/preview.html?now=1
#   http://localhost:8137/web/index.html
```

### Previewing without installing

`npm run preview` generates `preview.html` next to each real page: the same HTML, but the entry module
is loaded by a harness (`preview/`) that stubs `chrome.*` and seeds a realistic week first. IndexedDB
is genuine in a browser tab, so the storage layer runs untouched — which means what you see is the
shipping UI running the shipping logic, not a mockup.

Useful variants: `?plan=free` renders the free plan, `?now=1` leaves a session in progress, and the
hashes `#clients`, `#settings` and `#welcome` jump straight to those screens.

The generated pages are gitignored and excluded from the store package. This harness earned its keep
immediately: it surfaced a temporal-dead-zone bug that stopped the upgrade dialog from opening at all,
which no unit test would have caught.

There is no build step and no `node_modules`. The extension is plain ES modules, which keeps the
source readable for Chrome Web Store reviewers and removes a whole class of supply-chain risk.

> In some sandboxes a stale `NODE_OPTIONS` breaks `npm`. If so, run the scripts directly:
> `NODE_OPTIONS= node --test "tests/*.test.mjs"` and `NODE_OPTIONS= node tools/check.mjs`.

### Load it in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select the `extension/` folder
4. Pin Billed, then just work. The toolbar badge shows today's billable hours.

---

## How it works

```
tab/window/idle events ─┐
   heartbeat alarm ─────┼──► reconcile() ──► decide()  ← pure, fully tested
                        │         │
                        │         └──► IndexedDB (visits)  +  chrome.storage.local (open segment)
                        │
        dashboard/popup ┴──► buildTimesheet() ──► lines, clients, totals, exports
```

1. **Capture.** Every relevant browser event, plus a once-a-minute alarm, funnels into one
   `reconcile()` pass. Before anything is written, a visit is reduced to `hostname` + `path` +
   `title` + two timestamps; query strings are stripped and blocklisted sites are dropped entirely.

2. **Attribute.** Rules map something about a page to a client — a domain, a path prefix, a title
   fragment, or a regex. The most specific rule wins, so `github.com/acme` beats `github.com`.
   Unmatched time is grouped by *tenant* (`acme.atlassian.net`, `github.com/acme-corp`) and shown as
   a review queue, so the user answers a question once instead of tagging time forever.

3. **Assemble.** Visits become day-bounded segments, merge into timesheet lines, get a billing
   increment applied per line, and come out as CSV, invoice lines, a weekly summary, or a status
   update.

### Three invariants worth knowing

These are the rules the tests exist to protect:

- **Billed never invents time.** Merging adjacent blocks sums the parts; it never bills the
  wall-clock span, because bridging a gap silently inflates an invoice.
- **A segment orphaned by a dead service worker closes at its last confirmed heartbeat**, never at
  "now". MV3 workers are killed without warning, and closing at wake-up time would bill a lunch
  break. Worst case is losing one minute, which is the correct direction to fail.
- **Idle time is never billable.** The clock stops on idle, lock and window blur, and idle closes
  the segment at the last heartbeat rather than when Chrome got round to telling us.

---

## Layout

```
extension/
  manifest.json              MV3. No host permissions, no content scripts.
  background/
    service-worker.js        Listeners, badge, alarms, messages.
  src/
    config.js                All business config: pricing, links, product IDs.
    core/                    Pure logic. No Chrome APIs — this is what the tests import.
      tracking-policy.js       decide(): the record / stop / extend / repair state machine
      privacy.js               URL sanitising, blocklist matching, the storage gate
      attribution.js           rule matching and specificity
      workspaces.js            tenant detection (the part that feels like magic)
      segments.js              midnight splitting, merging (never over-bills)
      timesheet.js             aggregation, rounding, money
      exporters.js             CSV / markdown / invoice / status update
      plan.js, defaults.js, format.js, refs.js, time.js
    platform/                Chrome-facing adapters.
      db.js                    IndexedDB (visits)
      store.js                 chrome.storage.local (settings, clients, rules, licence)
      tracker.js               executes decide()
      license.js               licence verification behind an optional permission
      queries.js               read models; applies the free-plan history window
    ui/
      popup/                 Today's hours, one-click assign of the current site
      dashboard/             Week view, clients and rules, settings, upgrade, onboarding
tests/                       110 tests, node:test, no dependencies
tools/                       Icon generator, static checker, zip packager
web/                         Landing page (static, GitHub Pages ready)
store/                       Chrome Web Store promo images
docs/                        Store listing copy, payments setup, launch checklist
```

Core logic is deliberately separated from anything Chrome-shaped. That is what makes the risky parts
— the ones that decide whether an hour is recorded, discarded or invented — testable in plain Node.

---

## Plans

| | Free | Pro |
|---|---|---|
| Tracking | Everything, always | Everything, always |
| History shown | Last 7 days | Unlimited |
| Clients | 3 | Unlimited |
| Rates and money totals | ✅ | ✅ |
| Exports (CSV, invoice, summary) | — | ✅ |
| Billing increments | — | ✅ |
| Weekly review reminder | — | ✅ |

The free plan keeps recording past its own window: nothing is deleted, so upgrading reveals history
that was accumulating all along. Free users can see the money, because the money is the argument.

---

## Before launch

Three `PLACEHOLDER` values need real ones — `npm run check` lists them every time it runs:

| Where | What |
|---|---|
| `extension/src/config.js` | Gumroad product permalink and the three checkout URLs |
| `web/app.js` | The same checkout URLs, plus the store listing URL once approved |
| `docs/STORE_LISTING.md` | Ready-to-paste listing copy and permission justifications |

Then follow [docs/LAUNCH_CHECKLIST.md](docs/LAUNCH_CHECKLIST.md).

## Licence

Proprietary. All rights reserved.
