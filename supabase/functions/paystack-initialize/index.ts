// POST /functions/v1/paystack-initialize   Body: { booking_id: string, save_card?: boolean }
// Starts a card / instant EFT / QR payment for one of the user's bookings and
// returns the Paystack checkout URL for the app to open.

import { corsHeaders, json } from "../_shared/http.ts";
import { initializeTransaction } from "../_shared/paystack.ts";
import { getUser, serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const user = await getUser(req);
  if (!user?.email) return json({ error: "Sign in to pay" }, 401);

  const { booking_id, save_card } = await req.json().catch(() => ({}));
  if (typeof booking_id !== "string") return json({ error: "booking_id is required" }, 400);

  const db = serviceClient();
  const { data: booking, error } = await db
    .from("bookings")
    .select("id, reference, total_cents, status, payment_method, payment_status, hold_expires_at")
    .eq("id", booking_id)
    .eq("customer_id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (!booking) return json({ error: "Booking not found" }, 404);
  if (!["card", "eft", "qr"].includes(booking.payment_method)) {
    return json({ error: "This booking isn't paid online" }, 400);
  }
  if (booking.payment_status === "paid") return json({ error: "Already paid" }, 409);
  if (!["pending", "confirmed"].includes(booking.status) ||
      (booking.hold_expires_at && new Date(booking.hold_expires_at) < new Date())) {
    return json({ error: "This booking has expired. Please book again." }, 410);
  }

  // A fresh reference per attempt; Paystack rejects reused references.
  const reference = `${booking.reference}-${crypto.randomUUID().slice(0, 8)}`;
  const checkout = await initializeTransaction({
    email: user.email,
    amountCents: booking.total_cents,
    reference,
    callbackUrl: Deno.env.get("PAYSTACK_CALLBACK_URL"),
    metadata: { booking_id: booking.id, booking_reference: booking.reference, save_card: save_card === true, user_id: user.id },
  });

  const { error: insertError } = await db.from("payments").insert({
    booking_id: booking.id,
    provider: "paystack",
    provider_reference: reference,
    amount_cents: booking.total_cents,
  });
  if (insertError) throw insertError;

  return json({ authorization_url: checkout.authorization_url, reference });
});
