// POST /functions/v1/paystack-webhook  (set this URL in the Paystack dashboard)
// Marks a booking paid when Paystack reports a successful charge. Deploy with
// --no-verify-jwt: Paystack signs requests itself instead of sending a JWT.

import { json } from "../_shared/http.ts";
import { isValidSignature, verifyTransaction } from "../_shared/paystack.ts";
import { serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const raw = await req.text();
  if (!(await isValidSignature(raw, req.headers.get("x-paystack-signature")))) {
    return json({ error: "Invalid signature" }, 401);
  }

  const event = JSON.parse(raw);
  if (event.event !== "charge.success") return json({ received: true });

  const reference: string = event.data.reference;
  const db = serviceClient();
  const { data: payment, error } = await db
    .from("payments")
    .select("id, booking_id, amount_cents, status")
    .eq("provider_reference", reference)
    .maybeSingle();
  if (error) throw error;
  if (!payment || payment.status === "success") return json({ received: true });

  // Double-check with Paystack before trusting the event.
  const tx = await verifyTransaction(reference);
  if (tx.status !== "success" || tx.amount !== payment.amount_cents || tx.currency !== "ZAR") {
    await db.from("payments").update({ status: "failed", raw: event }).eq("id", payment.id);
    return json({ received: true });
  }

  await db.from("payments").update({ status: "success", raw: event }).eq("id", payment.id);
  const { error: bookingError } = await db
    .from("bookings")
    .update({ payment_status: "paid", hold_expires_at: null })
    .eq("id", payment.booking_id);
  if (bookingError) throw bookingError;

  // Remember the card for next time if the customer asked us to.
  const auth = event.data.authorization;
  const meta = event.data.metadata ?? {};
  if (meta.save_card && meta.user_id && auth?.reusable && auth.authorization_code && auth.signature) {
    const { data: card, error: cardError } = await db
      .from("payment_cards")
      .upsert(
        {
          user_id: meta.user_id,
          card_signature: auth.signature,
          brand: auth.card_type?.trim() ?? auth.brand,
          last4: auth.last4,
          exp_month: auth.exp_month,
          exp_year: auth.exp_year,
          bank: auth.bank,
        },
        { onConflict: "user_id,card_signature" },
      )
      .select("id")
      .single();
    if (cardError) throw cardError;
    await db.from("payment_card_secrets").upsert({ card_id: card.id, authorization_code: auth.authorization_code });
  }

  return json({ received: true });
});
