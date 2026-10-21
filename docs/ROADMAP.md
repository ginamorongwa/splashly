# Roadmap

What exists today is in the README. These are the next steps, roughly in order.

## Before launch
- **Paystack payouts to outlets.** Online payments currently land in Splashly's Paystack account. Use [Paystack subaccounts](https://paystack.com/docs/payments/split-payments/) so each outlet's share is paid to it automatically and Splashly keeps its fee.
- **Push notifications.** The `push_tokens` table and notification preferences exist; add an edge function that sends Expo push notifications for booking confirmed, wash started, car ready, reminders, and support replies.
- **Map view** on the Explore screen (e.g. `react-native-maps` with a development build).
- **Outlet verification.** A simple admin screen to review new outlets and set `verified`.
- **Legal:** terms of use, privacy policy (POPIA), and a data-deletion process (the app currently asks users to request deletion through Help).
- **Email confirmation and password reset pages** styled for Splashly in Supabase Auth settings.

## Soon after
- Customer ↔ outlet chat on a booking (the `booking_messages` table and access rules are ready; only the screens are missing).
- Leave a review from a completed booking (the table and rules exist).
- Outlet photo gallery (storage bucket exists; only the cover photo is wired up).
- Week view and drag-to-move in the outlet calendar.
- Earnings report and CSV export for outlets.
- Staff logins for outlets (washers see their own jobs).
- Loyalty rewards that actually redeem (the stamp card counts completed washes today).

## Business model (see the conversation notes)
Free plan for outlets, a monthly Pro plan (unlimited bookings, auto-scheduling, staff, reports, payouts), and a small booking fee on online payments (set in the admin Support inbox page).
