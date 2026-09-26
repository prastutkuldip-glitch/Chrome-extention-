# Payments setup

Two rails, in this order:

1. **Gumroad today.** No approval queue, instant signup, built-in licence keys with a verification
   API, global cards, payouts to an Indian bank. Highest fees of the three, and worth it to have a
   paid product live on day one.
2. **Dodo Payments this week.** Indian merchant of record built for exactly this case: UPI for Indian
   buyers, cards globally, and it handles cross-border sales tax and VAT so you are not registering in
   forty jurisdictions. Onboards individuals far faster than Paddle. Once KYC clears it becomes the
   primary rail and Gumroad stays as a fallback.

The extension only ever calls one licence endpoint, and it sits behind a single provider function, so
swapping rails later touches one file.

---

## Step 1 — Gumroad products

Create **two** products (not variants of one, because lifetime and subscription behave differently
in the licence API):

| Product | Type | Price | Permalink |
|---|---|---|---|
| Billed Pro | Membership / subscription | $15 monthly · $99 yearly | `billed-pro` |
| Billed Lifetime | Digital product | $149 | `billed-lifetime` |

For each product:

- **Enable licence keys.** Settings → *Generate a unique licence key per sale*. This is the whole
  mechanism; without it nothing unlocks.
- Set the receipt/redirect content to explain where the key goes: *"Open Billed → Settings → Plan →
  paste your licence key."* Most support email is caused by skipping this.
- Add India-specific pricing as a separate variant or product at ₹499 / ₹3,499 / ₹6,999 if you want
  purchasing-power pricing before Dodo is live.

---

## Step 2 — Paste four values into two files

`npm run check` prints every remaining `PLACEHOLDER` on each run, so it will tell you if you miss one.

### `extension/src/config.js`

```js
export const LINKS = {
  checkoutMonthly:  'https://YOURNAME.gumroad.com/l/billed-pro?variant=Monthly',
  checkoutYearly:   'https://YOURNAME.gumroad.com/l/billed-pro?variant=Yearly',
  checkoutLifetime: 'https://YOURNAME.gumroad.com/l/billed-lifetime',
  checkoutIndia:    'https://YOURNAME.gumroad.com/l/billed-pro?variant=India',
  privacy: 'https://your-domain/privacy.html',
  help:    'https://your-domain/#faq',
};

export const LICENSING = {
  productPermalink: 'billed-pro',   // ← the part after /l/ in the product URL
  // ...leave the rest alone
};
```

### `web/app.js`

```js
const SITE_CONFIG = {
  supportEmail: 'you@your-domain',
  storeUrl: '',                                  // ← fill in once Google approves the listing
  buildUrl: 'https://github.com/<owner>/<repo>/releases/latest',
  checkout: {
    monthly:  'https://YOURNAME.gumroad.com/l/billed-pro?variant=Monthly',
    yearly:   'https://YOURNAME.gumroad.com/l/billed-pro?variant=Yearly',
    lifetime: 'https://YOURNAME.gumroad.com/l/billed-lifetime',
  },
  // ...
};
```

While `storeUrl` is empty the landing page automatically shows the manual-install instructions and a
"Download the build" button instead of a dead "Add to Chrome" link. Fill it in and the page switches
over by itself.

---

## Step 3 — Two products, one permalink

`LICENSING.productPermalink` can only hold one value, so lifetime keys will fail against the `billed-pro`
permalink. Pick one:

- **Simplest:** sell lifetime as a third variant inside the `billed-pro` product. One permalink, one
  code path, done. Recommended for launch.
- **If you keep two products:** make `askProvider()` in `extension/src/platform/license.js` try the
  second permalink when the first returns `invalid`. Roughly ten lines, and the seam is already there.

---

## Step 4 — Test the whole loop before announcing

1. `npm run check` — confirm no `PLACEHOLDER` values remain in the notes.
2. Reload the unpacked extension so the new config is picked up.
3. Generate a real key: buy your own product with a 100%-off discount code. **Do not skip this.** A
   licence flow that was never exercised end-to-end is the classic launch-day failure.
4. Paste the key into Settings → Plan → Activate.
   - Chrome should prompt once for access to `api.gumroad.com`. Accept.
   - The pill in the header should switch to **Pro**, and exports should unlock.
5. Verify a wrong key is rejected with a readable message, not a silent failure.
6. Verify offline behaviour: switch off wifi, reload the dashboard — Pro must stay active. The cached
   verification is trusted for 45 days precisely so a flight cannot lock a paying user out.
7. Refund your own test purchase in Gumroad, then wait for the weekly re-check (or clear
   `license.verifiedAt` in storage) and confirm it drops back to Free.

---

## Step 5 — Migrating to Dodo Payments

Once KYC clears:

1. Recreate the same three price points in Dodo. Enable licence keys.
2. In `extension/src/platform/license.js`, `askProvider()` is the only function that knows about a
   provider. Add a Dodo branch that posts the key to Dodo's verification endpoint and maps the
   response onto the same `{ status, expiresAt, email, tier }` shape.
3. Add Dodo's API origin to `optional_host_permissions` in `manifest.json`, and to
   `LICENSING.originPermission`.
4. Keep the Gumroad branch. Existing customers' keys must keep working forever — nobody should have to
   re-buy because you changed processor.
5. Update the checkout links in both config files and ship a new version.

---

## Notes worth remembering

- **Client-side licence checks are bypassable.** Every extension's are. Do not spend effort on
  obfuscation; spend it on the product. Design for the honest majority.
- **Never downgrade on a failed network call.** Already handled: an unreachable server leaves the
  cached status untouched. Breaking this is the fastest way to earn one-star reviews.
- **Refund promptly and without argument.** At this price a refund costs less than a bad review.
- **Keep the free tier genuinely useful.** It is the top of the funnel and the reason anyone trusts
  the privacy claims enough to install in the first place.
