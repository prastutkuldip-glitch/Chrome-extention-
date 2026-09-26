# Why Billed exists

Research and decision record. Written before the code, corrected twice while researching, and left
honest on purpose — including the parts that argue against the product.

Research dates: 25 September 2026.

---

## The constraints that eliminated most ideas

These are why the obvious ideas are not buildable in a day, and they shaped everything:

1. **Gmail, Calendar and Drive APIs need restricted scopes** — OAuth brand verification plus a CASA
   third-party security assessment. Weeks to months, and it costs money. → **v1 must need zero
   Google/Microsoft OAuth.**
2. **The Chrome Web Store has no payment system.** Monetisation means your own licence key and your
   own checkout. Which turns out to be an advantage: UPI for India, cards for everyone else.
3. **Store review is hours to days**, longer for a new developer account. Broad permissions and
   remote code make it worse. → **minimum permissions, no remote code, a clean privacy story.**
4. **No server means no cost, no compliance surface and a faster review.** → **everything local.**

Any idea that breaks 1–3 is a month-long project, not a weekend one.

---

## Market scan

| Space | Demand | What already exists | Verdict |
|---|---|---|---|
| Tab managers, new-tab notepads | High | Dozens | ❌ Commodity, no pricing power |
| PII redaction before AI chat | High and rising | ~10 near-identical clones shipped in 12 months | ⚠️ Right idea a year ago; a red ocean of free clones now |
| Email tracking and follow-up nudges | High | Mailtrack, MailSuite, Streak, plus many AI entrants | ❌ Saturated, Gmail-only, restricted scopes |
| AI meeting notetakers | Very high | Otter, Fireflies, Granola | ❌ Funded incumbents, needs audio and servers |
| CRM auto-logging | High, pays well | Weflow, AdvizorPro | ⚠️ Good money, but admin-approval sales cycle |
| Screen-record → SOP doc | High | Scribe at $29/user | ⚠️ Real price gap, heavy build |
| Brag docs / work diaries | High, emotional | Bragbooq, Bragbook, withbrag, bragdoc.ai | ⚠️ Demand proven, every entrant fails the same way |
| **Billable-hours reconstruction** | **High, weekly, money-linked** | Rize, Timely, Toggl, RescueTime — heavy desktop apps, cloud accounts, sold to firms | ✅ **Crowded but the wedge is open** |

**The most useful thing learned:** an empty market is usually empty for a reason. Brag-doc tools keep
being built and keep dying — not mainly because they demand manual logging, but because of a
**pain-timing inversion**. Their value needs months of accumulated data, while the pain is felt twice
a year. On the day someone feels it, the product they just installed is empty, which is the worst
possible dynamic. Manual logging is a symptom of that, not the cause.

Meanwhile the billable-hours space is *crowded* — because that is where the money is.

---

## The strongest pain found, and why it was still rejected

US independent insurance agents re-keying client data across carrier portals. In Ivans' 2026
Agency–Carrier Connection Report, **74% of surveyed agents called re-keying their number one workflow
pain point**, and 90% had moved business away from carriers over submission friction. That is a 10/10
pain with commission money directly attached.

Rejected anyway, for reasons that have nothing to do with the pain:

- **Gated data.** Carrier portals sit behind agent logins. Unbuildable and untestable without a licence.
- **Competition arriving.** Magical (950k users, free tier) owns generic autofill, and insurance-specific
  extensions shipped during the research window.
- **Distribution 2/10.** Those buyers are reached through trade associations and agency networks. No
  access, no launch.

A 10/10 pain with 2/10 distribution loses to an 8/10 pain with 8/10 distribution, because these
factors multiply rather than add. One zero zeroes everything.

---

## Scorecard

| Factor | Insurance re-key | **Billable-hours reconstruction** | ChatGPT org tools | Passive brag doc |
|---|---|---|---|---|
| Problem is real | 10 | 9 | 8 | 9 |
| Pain frequency vs value timing | 9 | **9** (every Friday) | 9 | **3** |
| Willingness to pay | 9 | **9** | 5 | 4 |
| Solvable with available signal | 7 | **9** | 8 | 5 |
| Build and launch feasibility | **4** (gated) | **9** | 8 | 9 |
| Competition | 5 | 7 | **3** | 7 |
| Distribution you can actually reach | **2** | **8** | 6 | 6 |
| **Average** | 6.6 | **8.6** | 6.7 | 6.1 |

**8.6 with nothing below 7 is the realistic ceiling.** There is no idea that scores 9–10 everywhere:
high willingness to pay, daily pain and an easy build are in structural tension, because anything with
all three has already been built. When a market looks empty, the emptiness *is* the defect — rare
pain, broke buyers, a hard build, gated data, or unreachable customers.

---

## The evidence behind the winner

> Consultants leave **15–20% of billable time** unlogged. For someone billing $100/hour across 30
> billable hours a week, that is **$23,400 a year**. And the reconstruction happens on Friday
> afternoon, from memory — which always rounds down, because nobody risks over-billing a client.
> Manual timesheet processes also consume 2–4 hours a week on their own.

Sources: [Enterprise DNA](https://enterprisedna.co/resources/guides/consulting-automatic-billable-hours-tracking/),
[Rize](https://www.rize.io/blog/freelance-time-tracking),
[SystemX](https://www.systemx.net/where-your-billable-hours-disappear/),
[Timetackle](https://www.timetackle.com/consulting-hours-tracking/).
Content was rephrased for compliance with licensing restrictions.

This is the same mechanism the brag-doc idea was reaching for, pointed at an audience where all four
of its flaws disappear:

| Flaw of the brag-doc version | Fixed by this audience |
|---|---|
| Value needs months; pain felt twice a year | Pain lands **weekly**, at invoice time |
| Browsing signals cannot produce impact narratives | "Acme, 3.5 h, PAY-2214" is **exactly** what a URL and a title can prove |
| Employees resist paying for work tools | The freelancer is buyer, payer and beneficiary — no IT approval |
| Value is vague | "$29/month against a $23,000 leak" is arithmetic, not a pitch |

And the argument works for a completely unknown developer, because the buyer does not have to trust
anyone — only check the maths.

---

## How the wedge holds against funded incumbents

Toggl, Harvest, Timely, Rize and RescueTime all exist. The gap is specific:

- They ask you to **start and stop a timer** (which is the thing people forget), or they produce a
  **productivity report** that is not shaped like an invoice.
- They are **desktop apps with mandatory cloud accounts** at $9–25/month, mostly sold **to firms**.
- Billed is **browser-only, local-first, no account**, derives the **client from the URL tenant**, and
  does one job: Friday reconstruction.

Privacy is the marketing, not the risk. "Your employer cannot see this. It never leaves your laptop.
There is no server to leak." That inverts the one objection — *so it watches everything?* — into the
reason to install.

---

## What was actually built

A Chrome MV3 extension, entirely local: no account, no server, no content scripts, and **no network
permission at all on a fresh install**. See [README.md](README.md) for the architecture and
[docs/LAUNCH_CHECKLIST.md](docs/LAUNCH_CHECKLIST.md) for what remains.

Three invariants the test suite exists to defend:

1. **Never invent time.** Merging sums the parts; the gap between them is never billed.
2. **A session orphaned by a dead service worker closes at its last confirmed heartbeat**, not at
   wake-up. Worst case is losing a minute — the correct direction to fail.
3. **Idle time is never billable.**

Pricing: free forever (7 days, 3 clients, rates and money visible — the money *is* the argument), Pro
at $15/month or $99/year, lifetime $149, with Indian pricing at ₹499 / ₹3,499 / ₹6,999 payable by UPI.

---

## Risks that remain

Recorded so they can be checked against reality rather than rediscovered:

- **Browser-only capture is still a ceiling, though a lower one now.** Calls, IDE work and desk time
  cannot be detected, so manual entry exists to add them — a promise the product originally made in
  its own FAQ and did not keep until it was audited. Automatic capture remains browser-only, and that
  will still be the most common complaint.
- **The category is crowded.** Winning needs the wedge to stay sharp: local-first, no account, invoice
  output. Drifting towards a general time tracker means competing with funded companies on their turf.
- **Retention of a passive tool is unproven.** The toolbar badge and the Friday reminder exist
  specifically to fight it, and neither is validated yet.
- **Distribution is still the hardest part.** The product is done; being found is not. Nothing about
  shipping code changes that.
- **Conversion is the real unknown.** If free users find little unassigned time, the value genuinely
  is not there for them — and the answer is to learn that quickly, not to discount harder.
