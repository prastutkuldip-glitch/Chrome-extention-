# Launch checklist

The code is done. What is left is the part that needs your accounts, your card and your judgement.

Honest framing first, because it affects the order: **a paid product can be live today; a Chrome Web
Store listing cannot be guaranteed today.** Review normally takes a few hours to a few days, and new
developer accounts get extra scrutiny. So the landing page sells from minute one and the store
listing arrives when Google is ready.

---

## Today — get it selling

### 1. Use it yourself for a full day (30 seconds to start, then just work)
- [ ] `chrome://extensions` → Developer mode → **Load unpacked** → `extension/`
- [ ] Pin it. Work normally for a few hours.
- [ ] Open the dashboard and assign your real clients from the review queue.
- [ ] **Sanity-check the number against your own memory.** If it looks wrong, that is a bug worth
      finding before anyone else sees it. You are the first user and the only one who can catch this.

### 2. Gumroad (about 20 minutes)
- [ ] Create the products and turn on licence keys — [PAYMENTS_SETUP.md](PAYMENTS_SETUP.md) step 1
- [ ] Paste the four values into `extension/src/config.js` and `web/app.js` — step 2
- [ ] `npm run check` and confirm no `PLACEHOLDER` notes remain
- [ ] Buy your own product with a 100%-off code and activate the key end to end — step 4

### 3. Landing page (about 10 minutes)
- [ ] Push this branch, then in the repo: Settings → Pages → deploy from branch, folder `/web`
- [ ] Open the live URL and check: pricing toggle, USD/INR switch, checkout links, privacy page
- [ ] Put the real URL in `APP.site` in `extension/src/config.js`

### 4. Chrome Web Store submission (about 30 minutes)
- [ ] Pay the one-time $5 developer registration fee (your Google account, your card)
- [ ] `npm run package` → upload `dist/billed-v1.0.0.zip`
- [ ] Paste the listing copy from [STORE_LISTING.md](STORE_LISTING.md)
- [ ] Paste each permission justification **verbatim** — this is what decides how fast review goes
- [ ] Fill the data-usage form: *not collected* for every category, all three certifications checked
- [ ] Privacy policy URL → your live `privacy.html`
- [ ] Upload the promo tiles from `store/` and the five screenshots from `store/screenshots/`
- [ ] Optional but better: retake the screenshots from *your* week once step 1 has given you real
      data. Real client names persuade more than seeded ones.
- [ ] Submit, then stop refreshing the page. Nothing you do speeds it up.

---

## This week — distribution

Where these buyers actually are. Note that none of this requires a store listing.

- [ ] **r/freelance, r/consulting, r/Entrepreneur, r/digitalnomad.** Do not post a launch ad. Find
      threads where someone is complaining about timesheets and answer the question properly, linking
      only if it genuinely helps. This is slow and it is the only thing that reliably works.
- [ ] **Indie Hackers + X.** Post the build story with the real number: what it cost, what it does,
      what it deliberately does not do. The privacy architecture is the interesting part.
- [ ] **Product Hunt.** Schedule rather than firing it off — a Tuesday or Wednesday launch, assets
      ready, and be present in the comments all day.
- [ ] **Hacker News (Show HN).** This crowd will interrogate the privacy claims. That is good: the
      answers are strong and specific. Have the source ready to point at.
- [ ] **Accountant, lawyer and agency communities.** Higher hourly rates mean the arithmetic lands
      harder. Slower to reach, better customers.

### The one message that does the work

> Consultants forget 15–20% of their billable time. At $100/hour that is $23,000 a year. This rebuilds
> it from your own browser activity, entirely on your device — no account, no server, no page access.

Lead with the arithmetic, not the adjectives. An unknown developer does not need to be trusted for a
number to be checked.

---

## First fortnight — listen, then fix

- [ ] Watch for one thing above all: **does the number match what people believe they worked?** Every
      complaint about accuracy is existential; every feature request is not.
- [ ] Expect the top two asks to be *"track time outside the browser"* and *"sync across my devices"*.
      Both are real, both break the privacy story, and both deserve a considered answer rather than a
      reflex yes.
- [ ] Reply to every single email in the first month, however small. This is the cheapest research
      you will ever get.
- [ ] Only after 20+ real users: decide whether to build "Repeat" (the enterprise task recorder from
      [IDEA.md](../IDEA.md)) or to go deeper into invoicing integrations.

---

## Things that will go wrong, and what to do

| Problem | What it means | Response |
|---|---|---|
| Store review takes days | Normal for a new developer account, especially with `tabs` | Sell from the landing page meanwhile; do not resubmit, that restarts the queue |
| Reviewer asks about `tabs` | Also normal | Reply with the justification from STORE_LISTING.md verbatim; do not add new permissions |
| "Is this spyware?" | The single most predictable objection | Point at the architecture: no content scripts, no host permissions, no network on install. Never argue; show |
| Hours look too low | Almost always idle threshold or non-browser work | Explain that under-reporting is deliberate, then ask what they were doing — this is a product insight, not a support ticket |
| Hours look too high | Would be a real bug | Ask for the client and day, check the rules. The merge logic is tested never to bill a gap |
| Nobody converts | The likeliest outcome, and the most useful | Ask the free users what their unassigned number was. If it is small, the value is not there for them and the pricing is not the problem |

---

## Verify before you ship

```bash
npm test       # 110 tests must pass
npm run check  # no errors, no PLACEHOLDER notes
npm run package
```

Then, in a browser, with your own real week of data: does the total look right? That is the only test
that actually matters.
