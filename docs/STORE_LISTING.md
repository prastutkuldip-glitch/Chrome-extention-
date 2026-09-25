# Chrome Web Store listing

Copy-paste ready. The permission justifications matter most: vague answers there are the single
biggest cause of review delays for an extension that reads tab URLs.

---

## Store fields

**Name** (45 char limit — currently 36)
```
Billed — Timesheet & Billable Hours
```

**Short description** (132 char limit — currently 122)
```
Rebuild your week's billable hours from your own browser activity. Private by design: your data never leaves your device.
```

**Category:** Workflow & Planning
**Language:** English

---

## Detailed description

```
Friday, 5pm. You open your timesheet and try to remember Tuesday.

Billed already knows. It quietly rebuilds your week from the work tools you were actually in, groups
the time by client, and attaches the ticket numbers it found along the way. One click and it is out
of the browser as a CSV, invoice lines, or a summary you can paste into an email.

WHY THIS EXISTS

Nobody over-bills from memory. You remember the two-hour strategy call and forget the four short
ones, the three emails and the two document reviews scattered around it — so the number you write
down is always the smaller one. Across professional services, 15-20% of billable time goes unlogged
for exactly this reason. For one person billing $100/hour, that is over $20,000 a year.

HOW IT WORKS

1. Billed records which work sites are in front of you and for how long. The clock stops when you do.
2. It groups what it saw by the thing that actually identifies a client — acme.atlassian.net,
   github.com/acme-corp — and asks you once. Your answer becomes a rule and applies forever.
3. On Friday you get hours per client per day, with ticket keys attached as evidence, and export it.

PRIVATE BY DESIGN — THE ARCHITECTURE, NOT A PROMISE

• No account, no login, no server. Nothing is transmitted, so there is nothing for anyone to see.
• No content scripts. Billed cannot read page contents, form fields or keystrokes, because it has no
  access to the inside of any page.
• Query strings are stripped before storage, since that is where search terms and tokens live.
• A fresh install holds no network permission at all. One is requested only if you activate a licence.
• Banking, health, adult and personal-social patterns are blocked out of the box, and you can block
  any domain or path yourself.
• Delete one site, one line, or everything, at any time. Export a full JSON backup whenever you like.

IT NEVER INVENTS TIME

Merging two blocks of work sums the parts — the gap between them is never billed. Idle time is never
billed. If Chrome shuts the extension down mid-session, the session closes at the last confirmed
moment rather than at whenever it wakes up. Billed would rather lose a minute than bill you for a
lunch break you did not work.

FOR WHOM

Consultants, freelancers, agencies, lawyers, accountants — anyone whose income depends on hours that
actually got logged. Salaried too: status-update mode turns the same data into a weekly update for a
manager, or the bullet list you wish you had before a performance review.

FREE

Full tracking, the last 7 days of history, up to 3 clients, hourly rates and money totals, and
today's hours on your toolbar. No card, no account.

PRO

Unlimited history and clients, CSV and invoice exports, billing increments (6/10/15/30/60 minutes,
nearest or always up), a Friday review reminder, and status-update mode.

Nothing is ever deleted when a plan changes. The free plan simply shows less; your history stays on
your device, waiting.
```

---

## Single purpose statement

Required field. Keep it to one sentence — reviewers reject compound purposes.

```
Billed records how long the user spends on their own work-related websites and turns that into a
per-client timesheet of billable hours, stored locally on the user's device.
```

---

## Permission justifications

Answer each one in terms of the single purpose. These are the exact strings to paste.

**`tabs`**
```
Billed needs the domain, path and title of the tab the user is actively using in order to measure how
long they worked on each client's tools and to label the resulting timesheet line. This is the core
function of the extension and no narrower API provides it. Only the active tab's domain, path and
title are read; page contents are never accessed, and no content scripts are injected.
```

**`idle`**
```
Used to stop the timer when the user steps away from the keyboard or locks the screen, so that idle
time is never counted as billable. Without it the extension would over-report hours, which for a
billing tool is a correctness failure.
```

**`alarms`**
```
A once-a-minute alarm writes the in-progress session to local storage and reconciles the extension's
state with the browser's. Manifest V3 service workers are terminated without warning, so without this
heartbeat an active work session would be lost when the worker shuts down.
```

**`storage` and `unlimitedStorage`**
```
All timesheet data — recorded sessions, clients, attribution rules and settings — is stored locally
on the user's device. unlimitedStorage is required because a full year of activity can exceed the
default quota, and the extension has no server to offload it to.
```

**`notifications` (optional)**
```
Requested at runtime, and only if the user switches on the weekly review reminder, which prompts them
to review and export their timesheet before the week closes. The extension is fully functional
without it.
```

**`https://api.gumroad.com/*` (optional host permission)**
```
Requested at runtime, and only when a user chooses to activate a paid licence. The extension sends
only the licence key the user pasted, so the purchase can be verified. No activity or timesheet data
is included, and a fresh installation makes no network requests at all.
```

---

## Data usage disclosures

The store's privacy form asks what data is collected. The honest answer for every category:

| Category | Answer |
|---|---|
| Personally identifiable information | Not collected |
| Health information | Not collected |
| Financial and payment information | Not collected |
| Authentication information | Not collected |
| Personal communications | Not collected |
| Location | Not collected |
| Web history | **Not collected.** Domains and paths are stored locally on the user's device and never transmitted. |
| User activity | **Not collected.** Timing data is stored locally and never transmitted. |
| Website content | Not collected |

Then check all three certifications — data is not sold, not used for unrelated purposes, and not used
to determine creditworthiness — because none of that is possible: nothing leaves the device.

**Privacy policy URL:** `https://<your-domain>/privacy.html` (the page in `web/privacy.html`)

> The form distinguishes *collected* (leaves the device) from *stored locally*. Billed only ever does
> the latter. If a reviewer queries this, the answer is: no host permissions at install time, no
> content scripts, no remote code, and exactly one optional endpoint used solely for licence checks.

---

## Assets

| Asset | Size | Status |
|---|---|---|
| Icon | 128×128 | ✅ `extension/assets/icons/icon-128.png` |
| Small promo tile | 440×280 | ✅ `store/promo-tile-440x280.png` |
| Marquee promo tile | 1400×560 | ✅ `store/promo-marquee-1400x560.png` |
| Screenshots | 1280×800, at least 1, up to 5 | ✅ `store/screenshots/` — five, ready to upload |

The screenshots are genuine renders of the shipped UI, produced by loading the real dashboard in a
browser through the preview harness (`npm run preview`) with a seeded sample week. Nothing is mocked
up: the same attribution, merging and rounding code produced those numbers.

1. `1-week-view.png` — the week view with four clients and a populated timesheet. The money shot.
2. `2-needs-review.png` — the review queue, showing one-click assignment.
3. `3-clients-and-rules.png` — clients with their attribution rules visible.
4. `4-privacy-controls.png` — the blocklist and retention settings. This is what converts sceptics.
5. `5-export.png` — CSV, invoice lines and summary export.

**Worth replacing them with your own week once you have one.** These are honest but generic; real
client names and real hours are more persuasive, and you will spot UI problems in your own data that
a seeded week hides. Regenerate at any time with:

```bash
npm run preview          # writes the preview pages
python3 -m http.server 8137
# then capture at exactly 1280×800
```
