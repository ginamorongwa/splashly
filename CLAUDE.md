# Splashly

Car wash booking app for South Africa. npm workspaces monorepo, all TypeScript.

- `apps/mobile` – customer app, Expo 58 + Expo Router (`src/app` = screens). Read `apps/mobile/AGENTS.md` before touching Expo APIs; install packages with `npx expo install`.
- `apps/web` – outlet dashboard + admin support inbox + landing page, Next.js 16 App Router, Tailwind 4. Read `apps/web/AGENTS.md`; this Next.js version differs from older ones (docs in `node_modules/next/dist/docs/`).
- `packages/core` – shared row types and formatting (`formatRand`, `formatTime`, labels).
- `supabase/migrations` – the database, including all booking/scheduling logic as SQL functions and row level security. Never edit a migration that has been deployed; add a new one.
- `supabase/functions` – Deno edge functions: `support-chat` (Claude assistant with hand-off to a human), `paystack-*` (payments, saved cards, webhook).

## Conventions
- Money is integer cents (ZAR). Display with `formatRand`.
- Times are `timestamptz`; outlets have a `timezone` (default Africa/Johannesburg, UTC+2, no DST).
- Bookings are created and changed only through SQL functions (`create_booking`, `cancel_booking`, `update_booking_status`, `reassign_booking`, `submit_payment_proof`, `mark_booking_paid`); there is no insert/update policy on `bookings`.
- Data access in both apps is client-side with the Supabase anon key; RLS is the security boundary. Server-only work (AI, payments, card secrets) lives in edge functions using the service role.

## Checks
```bash
npm run typecheck
npm test
./supabase/tests/run.sh                         # needs local Postgres; PGHOST/PGPORT/PGUSER
cd supabase/functions && npx deno check */index.ts && npx deno test _shared
cd apps/web && npx eslint src && npx next build
```
