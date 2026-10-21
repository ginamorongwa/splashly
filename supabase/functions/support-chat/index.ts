// POST /functions/v1/support-chat
// Body: { conversation_id?: string, message: string, location?: { lat: number, lng: number } }
//
// Saves the user's message. While the conversation is with the bot, Claude
// answers; if it hands off (or fails), the conversation moves to the admin
// support inbox and a person replies from the web dashboard.

import Anthropic from "@anthropic-ai/sdk";

import { corsHeaders, json, requireEnv } from "../_shared/http.ts";
import { getUser, serviceClient } from "../_shared/supabase.ts";
import { type ChatTurn, runSupportAssistant, type SupportData } from "../_shared/support-assistant.ts";

const anthropic = new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
// Haiku (claude-haiku-5-5) is much cheaper if you want to save on chat costs.
const MODEL = Deno.env.get("SUPPORT_CHAT_MODEL") ?? "claude-opus-5-5";
const HISTORY_LIMIT = 30;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const user = await getUser(req);
  if (!user) return json({ error: "Sign in to chat with support" }, 401);

  let body: { conversation_id?: string; message?: string; location?: { lat: number; lng: number } };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const message = body.message?.trim();
  if (!message || message.length > 4000) return json({ error: "Message must be 1–4000 characters" }, 400);

  const db = serviceClient();

  // Find or start the conversation.
  let conversation: { id: string; status: string };
  if (body.conversation_id) {
    const { data, error } = await db
      .from("support_conversations")
      .select("id, status")
      .eq("id", body.conversation_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return json({ error: "Conversation not found" }, 404);
    conversation = data;
    if (conversation.status === "closed") {
      await db.from("support_conversations").update({ status: "bot", handoff_reason: null }).eq("id", conversation.id);
      conversation.status = "bot";
    }
  } else {
    const { data, error } = await db
      .from("support_conversations")
      .insert({ user_id: user.id })
      .select("id, status")
      .single();
    if (error) throw error;
    conversation = data;
  }

  const { error: insertError } = await db
    .from("support_messages")
    .insert({ conversation_id: conversation.id, sender: "user", sender_id: user.id, body: message });
  if (insertError) throw insertError;

  // A person is handling this chat; they'll see the message in the inbox.
  if (conversation.status !== "bot") {
    return json({ conversation_id: conversation.id, status: conversation.status, reply: null });
  }

  const { data: rows, error: historyError } = await db
    .from("support_messages")
    .select("sender, body")
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  if (historyError) throw historyError;
  const history = (rows as ChatTurn[]).reverse();

  const supportData: SupportData = {
    async nearbyOutlets(mode) {
      if (!body.location) return null;
      const { data, error } = await db.rpc("nearby_outlets", {
        p_lat: body.location.lat,
        p_lng: body.location.lng,
        p_radius_km: 20,
        p_mode: mode,
      });
      if (error) throw error;
      return (data ?? []).slice(0, 8).map((o: Record<string, unknown>) => ({
        id: o.id,
        name: o.name,
        address: o.address,
        distance_km: Math.round((o.distance_km as number) * 10) / 10,
        from_price_rand: o.from_price_cents === null ? null : (o.from_price_cents as number) / 100,
        rating: o.rating,
        review_count: o.review_count,
        walk_in: o.offers_walk_in,
        mobile: o.offers_mobile,
      }));
    },

    async outletDetails(nameOrId) {
      const isId = /^[0-9a-f-]{36}$/i.test(nameOrId);
      const query = db
        .from("outlets")
        .select(
          "id, name, address, phone, offers_walk_in, offers_mobile, mobile_radius_km, call_out_fee_cents, cancellation_hours, accepted_payment_methods, services(name, duration_minutes, price_cents, active), opening_hours(weekday, opens_at, closes_at)",
        )
        .limit(1);
      const { data, error } = isId ? await query.eq("id", nameOrId) : await query.ilike("name", `%${nameOrId}%`);
      if (error) throw error;
      return data?.[0] ?? null;
    },

    async myBookings() {
      const { data, error } = await db
        .from("bookings")
        .select(
          "reference, mode, starts_at, status, total_cents, payment_method, payment_status, outlets(name, phone), booking_services(name)",
        )
        .eq("customer_id", user.id)
        .order("starts_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data ?? [];
    },
  };

  const result = await runSupportAssistant({ client: anthropic, model: MODEL, history, data: supportData });

  const { error: replyError } = await db
    .from("support_messages")
    .insert({ conversation_id: conversation.id, sender: "bot", body: result.reply });
  if (replyError) throw replyError;

  let status = conversation.status;
  if (result.handoff) {
    status = "waiting_for_human";
    const { error } = await db
      .from("support_conversations")
      .update({ status, handoff_reason: result.handoff.reason })
      .eq("id", conversation.id);
    if (error) throw error;
  }

  return json({ conversation_id: conversation.id, status, reply: result.reply });
});
