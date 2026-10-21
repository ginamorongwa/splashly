// POST /functions/v1/paystack-charge-card   Body: { booking_id: string, card_id: string }
// Pays for a booking with one of the customer's saved cards. The booking is
// marked paid by paystack-webhook when Paystack confirms the charge.

import { corsHeaders, json } from "../_shared/http.ts";
import { chargeAuthorization } from "../_shared/paystack.ts";
import { getUser, serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const user = await getUser(req);
  if (!user?.email) return json({ error: "Sign in to pay" }, 401);

  const { booking_id, card_id } = await req.json().catch(() => ({}));
  if (typeof booking_id !== "string" || typeof card_id !== "string") {
    return json({ error: "booking_id and card_id are required" }, 400);
  }

  const db = serviceClient();
  const { data: booking, error } = await db
    .from("bookings")
    .select("id, reference, total_cents, status, payment_method, payment_status, hold_expires_at")
    .eq("id", booking_id)
    .eq("customer_id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (!booking) return json({ error: "Booking not found" }, 404);
  if (booking.payment_method !== "card") return json({ error: "This booking isn't paid by card" }, 400);
  if (booking.payment_status === "paid") return json({ error: "Already paid" }, 409);
  if (!["pending", "confirmed"].includes(booking.status) ||
      (booking.hold_expires_at && new Date(booking.hold_expires_at) < new Date())) {
    return json({ error: "This booking has expired. Please book again." }, 410);
  }

  const { data: card, error: cardError } = await db
    .from("payment_cards")
    .select("id, payment_card_secrets(authorization_code)")
    .eq("id", card_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (cardError) throw cardError;
  const secret = card?.payment_card_secrets as { authorization_code: string } | { authorization_code: string }[] | null;
  const authorizationCode = Array.isArray(secret) ? secret[0]?.authorization_code : secret?.authorization_code;
  if (!authorizationCode) return json({ error: "Card not found" }, 404);

  const reference = `${booking.reference}-${crypto.randomUUID().slice(0, 8)}`;
  const { error: insertError } = await db.from("payments").insert({
    booking_id: booking.id,
    provider: "paystack",
    provider_reference: reference,
    amount_cents: booking.total_cents,
  });
  if (insertError) throw insertError;

  const charge = await chargeAuthorization({
    email: user.email,
    amountCents: booking.total_cents,
    reference,
    authorizationCode,
    metadata: { booking_id: booking.id, booking_reference: booking.reference },
  });

  return json({ status: charge.status, reference });
});
