# Splashly

By Morongwa Software Solutions (MSS).

Car wash booking for South Africa. Customers find nearby car wash outlets, book a
wash at the outlet or have mobile washers come to them, and pay by card, instant
EFT, scan-to-pay, cash, or a bank transfer straight to the outlet. Outlets manage
their services, calendar and payments from a web dashboard.

| Part | Folder | Built with |
| --- | --- | --- |
| Customer app (iOS, Android, web) | `apps/mobile` | Expo 58 (React Native), Expo Router |
| Outlet dashboard, admin support inbox, landing page | `apps/web` | Next.js 16 (React), Tailwind CSS |
| Database, logins, file storage, live updates | `supabase/migrations` | Supabase (Postgres 17) |
| Support chatbot and payments | `supabase/functions` | Supabase Edge Functions (Deno), Claude API, Paystack |
| Shared types and formatting | `packages/core` | TypeScript |

Everything is TypeScript.

## What's in it

**Customers (mobile app)**
- Explore: outlets near you (distance, starting price, rating), filter by walk-in or "comes to you", search.
- Outlet page: services and prices, opening hours, reviews, call / WhatsApp / directions.
- Booking: choose services, at the outlet or at your address, pick a day and a free time (or auto-pick the soonest), vehicle, note for the washer.
- Payment: card (Paystack checkout, or a saved card), instant EFT, scan-to-pay, pay at the outlet, or bank transfer with the outlet's bank details, a payment reference and proof-of-payment upload.
- Bookings: live status, cancel within the outlet's window, pay again if a payment didn't go through.
- Help: an AI assistant (Claude) that can look up outlets and your bookings, and hands the chat to the Splashly team when it can't help.
- Profile: personal details and addresses, saved cards, vehicles, a rewards stamp card. Settings: notifications, booking preferences, privacy, password, log out.

**Outlets (web dashboard at `/dashboard`)**
- Today: pause/resume bookings, today's numbers, accept or decline requests, start/finish washes, mark no-shows, confirm bank transfers (view proof) and cash payments. Updates live.
- Calendar: day view per bay and mobile team, block time (lunch, maintenance), move a booking to another bay.
- My outlet: details and map pin, cover photo, walk-in and mobile options (radius, call-out fee), services with durations and prices, opening hours, bays and mobile teams, accepted payment methods, bank details.
- Settings: auto-accept, buffer between washes, slot interval, cancellation window, mobile travel time.

**You (admin, `/dashboard/support`)**
- Support inbox for chats the assistant handed over; reply, close, or hand back to the assistant.
- Platform booking fee on online payments.

### How scheduling works
Each outlet has bays and mobile teams. When a customer books, the database puts the
booking in the first free one, blocking it for the wash time plus the outlet's buffer
(and travel time for mobile washes). A database constraint makes double-booking
impossible, even when two people book the same slot at the same moment. Unpaid
online and bank-transfer bookings are held for 20 minutes and 2 hours respectively,
then released.

## Getting started

You need Node.js 22+, a free [Supabase](https://supabase.com) account, a
[Paystack](https://paystack.com) account (South Africa), and an
[Anthropic API key](https://console.anthropic.com) for the support assistant.

```bash
npm install
```

### 1. Database and backend (Supabase)

1. Create a Supabase project (choose a region close to South Africa).
2. Link it and apply the migrations:
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```
3. Set the secrets the edge functions use:
   ```bash
   npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-... PAYSTACK_SECRET_KEY=sk_test_... \
     PAYSTACK_CALLBACK_URL=https://<your-site>/payment-complete
   # Optional: a cheaper model for the assistant (default is claude-opus-5-5)
   npx supabase secrets set SUPPORT_CHAT_MODEL=claude-haiku-5-5
   ```
4. Deploy the functions:
   ```bash
   npx supabase functions deploy support-chat paystack-initialize paystack-charge-card
   npx supabase functions deploy paystack-webhook --no-verify-jwt
   ```
5. In the Paystack dashboard (Settings → API Keys & Webhooks) set the webhook URL to
   `https://<project-ref>.supabase.co/functions/v1/paystack-webhook`.
6. Sign up once in the app or dashboard, then make yourself an admin in the Supabase SQL editor:
   ```sql
   update profiles set role = 'admin'
   where id = (select id from auth.users where email = 'you@example.com');
   ```

### 2. Web dashboard

```bash
cp apps/web/.env.example apps/web/.env.local   # fill in URL and anon key
npm run web                                    # http://localhost:3000
```

Sign up at `/login` as an outlet, then set up your outlet under **My outlet**.

### 3. Mobile app

```bash
cp apps/mobile/.env.example apps/mobile/.env   # same URL and anon key
npm run mobile
```

Scan the QR code with the Expo Go app on your phone, or press `w` to open it in a browser.

## Tests

```bash
npm test                                   # shared formatting helpers
./supabase/tests/run.sh                    # database: scheduling, double-booking, access rules, payments
                                           #   (needs a local Postgres 15+; set PGHOST/PGPORT/PGUSER)
cd supabase/functions && npx deno test _shared   # support assistant hand-off rules
npm run typecheck                          # all TypeScript
```

## Deploying

- **Web:** [Vercel](https://vercel.com). Import the repo, set the root directory to `apps/web`, and add the two `NEXT_PUBLIC_…` variables.
- **Mobile:** [EAS](https://docs.expo.dev/eas/). `cd apps/mobile && npx eas-cli build` builds for the App Store and Play Store; `npx eas-cli update` ships fixes without a store review.
- **Database changes:** add a new file in `supabase/migrations/` (never edit one that's already deployed), then `npx supabase db push`.

See [docs/ROADMAP.md](docs/ROADMAP.md) for what's next.
