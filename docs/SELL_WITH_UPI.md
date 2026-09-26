# Selling with UPI, today, for ₹0

No payment processor, no KYC, no waiting. You accept UPI into your own account and
send a licence key by hand.

This is the right way to start, and the wrong way to finish. Read the last section.

---

## What you need

1. A UPI ID you can receive money on — `yourname@oksbi`, or whatever your app shows.
2. An email address customers can write to.
3. The key list: `keys/billed-keys-batch-1.txt` — 300 keys, already generated.

**The key list is private.** It is gitignored on purpose. Never commit it, never
paste it into a chat, never put it in a screenshot. Anyone holding a key unlocks Pro.

---

## Set it up (5 minutes, once)

Open `web/app.js` and fill in four lines near the top:

```js
supportEmail: 'you@gmail.com',

upi: {
  id: 'yourname@oksbi',
  name: 'Your Name',          // what UPI shows on confirmation — buyers check this
  amount: '₹3,499',
  note: 'Keys are issued by hand, so allow a few hours.',
},
```

Until `id` has a value the UPI panel stays hidden, so the site never shows a
half-finished payment instruction. Fill it in, push, and the panel appears on the
pricing section by itself.

---

## When someone wants to buy

1. They send you money on UPI and email you the screenshot.
2. **Check your bank app** that the money actually arrived. Screenshots can be faked;
   your passbook cannot.
3. Open `keys/billed-keys-batch-1.txt` and take the **next unused key**.
4. Reply with this (copy-paste, change the key):

```
Thanks — payment received.

Your Billed Pro licence key:

    BILLED-XXXXX-XXXXX-XXXXX

To activate:
1. Click the Billed icon in Chrome, then "Open dashboard"
2. Go to Settings, scroll to "Plan"
3. Paste the key and click Activate

It works offline and never expires. If anything goes wrong, just reply to this
email and I will sort it out personally.
```

5. In the key file, write their email and the date next to the key you used.
   That file is now your sales record — do not lose it.

---

## What to expect

- **The key works instantly and offline.** It is checked against a hash that ships
  inside the extension, so there is no server and no network call. It never expires.
- **It cannot be revoked.** If you refund someone, the key keeps working. At 300
  keys and these prices, that is not worth engineering around — it is worth being
  choosy about who you hand keys to.
- **A shared key works for whoever has it.** True of every client-side licence
  there is. Not a problem until you have far more customers than you do today.

---

## Running low or want fresh keys

```bash
node tools/make-keys.mjs 300 2      # 300 more keys, batch 2
```

⚠️ This **replaces** `extension/src/core/offline-keys.js`, so keys from batch 1 stop
working. Only run it when batch 1 is genuinely finished, and ship the new version
before selling from batch 2.

---

## Read this part

UPI solves exactly one case: **a customer in India**.

Billed is built for US and European consultants, because that is where the hourly
rates make the arithmetic obvious. Those customers **cannot pay by UPI at all** —
they will need a card. So:

| | UPI (manual) | Card processor |
|---|---|---|
| Cost to start | ₹0 | ₹0 (Gumroad) |
| Live in | 5 minutes | ~30 minutes |
| Indian buyers | ✅ | ✅ (Gumroad shows UPI too) |
| US / European buyers | ❌ **never** | ✅ |
| Recurring subscription | ❌ manual every year | ✅ automatic |
| Work per sale | ~5 minutes of yours | zero |
| Fee | ₹0 | ~13% |

Start with UPI today because it is instant and free. But the first time someone
outside India wants to buy, set up the card checkout — see
[PAYMENTS_SETUP.md](PAYMENTS_SETUP.md). It is also free, and the extension already
supports both: an offline key and a provider key are both accepted in the same box.

Do not let "UPI is enough" become the reason you never sell outside India. That
market is the whole reason this product exists.
