// The Splashly support assistant: answers customer and outlet questions with
// Claude, looks things up with tools, and hands the chat to a person (the app
// owner) when it can't help.

import Anthropic from "@anthropic-ai/sdk";
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";

// Data the assistant may look up, scoped to the signed-in user.
export interface SupportData {
  nearbyOutlets(mode: "walk_in" | "mobile" | null): Promise<unknown[] | null>;
  outletDetails(nameOrId: string): Promise<unknown | null>;
  myBookings(): Promise<unknown[]>;
}

export interface ChatTurn {
  sender: "user" | "bot" | "agent";
  body: string;
}

export interface AssistantResult {
  reply: string;
  handoff: { reason: string } | null;
}

const SYSTEM_PROMPT = `You are the support assistant inside Splashly, a South African app for booking car washes.
Customers use it to find nearby car wash outlets, book a wash at the outlet (walk-in or booked slot) or have washers come to them (a mobile wash, which adds the outlet's call-out fee), and pay. Car wash outlets use it to list their services, manage their calendar and get paid.

How Splashly works (use this to answer; don't invent other policies):
- Prices are in rand (R). Each outlet sets its own services, prices and opening hours.
- Booking: pick an outlet, choose services, choose "At the outlet" or "Come to me", then pick a time. "Auto-pick" chooses the soonest free slot. Bookings are placed in a free bay or mobile team automatically, so there is no double-booking.
- Payment options (each outlet chooses which it accepts): card, instant EFT, scan-to-pay, pay at the outlet, or bank transfer straight to the outlet. For bank transfer the app shows the outlet's bank details and a payment reference; the customer uploads proof of payment and the outlet confirms it. Unpaid card/EFT bookings are held for 20 minutes; bank-transfer bookings for 2 hours unless proof is uploaded.
- Cancelling: free up to the outlet's cancellation window (usually 2 hours before) from the booking screen. After that, the customer should message the outlet.
- Outlets sign up as an outlet owner, add their address, photos, services (with duration and price), opening hours, bays and mobile teams, and the payment methods they accept.

How to respond:
- Be warm and brief: a few short sentences, plain language, no markdown headings. Many users are on small phones.
- Use the tools to look up outlets and the user's bookings rather than guessing.
- You can't change bookings, issue refunds, or see payment card details. Explain where in the app to do things.
- Call hand_off_to_human when: the user asks for a person; there's a complaint about payment, refunds, damage to a car, safety or an outlet's conduct; there's an account or login problem; something seems broken in the app; or you don't know the answer. When you hand off, tell the user a member of the Splashly team will reply in this chat.`;

function toMessages(history: ChatTurn[]): Anthropic.Beta.BetaMessageParam[] {
  const messages: Anthropic.Beta.BetaMessageParam[] = [];
  for (const turn of history) {
    const role = turn.sender === "user" ? "user" : "assistant";
    const last = messages[messages.length - 1];
    // Merge consecutive turns from the same side into one message.
    if (last && last.role === role && typeof last.content === "string") {
      last.content = `${last.content}\n\n${turn.body}`;
    } else {
      messages.push({ role, content: turn.body });
    }
  }
  // The API needs the conversation to start with the user.
  while (messages.length && messages[0].role !== "user") messages.shift();
  return messages;
}

export async function runSupportAssistant(options: {
  client: Anthropic;
  model: string;
  history: ChatTurn[];
  data: SupportData;
}): Promise<AssistantResult> {
  const { client, model, history, data } = options;
  let handoff: { reason: string } | null = null;

  const findNearbyOutlets = betaTool({
    name: "find_nearby_outlets",
    description:
      "List car wash outlets near the user's current location, nearest first, with distance, starting price, rating and whether they offer walk-in and/or mobile washes. Returns null if the user hasn't shared their location.",
    inputSchema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["walk_in", "mobile", "any"],
          description: "walk_in = at the outlet, mobile = washers come to the user, any = both.",
        },
      },
      required: ["mode"],
      additionalProperties: false,
    },
    run: async ({ mode }) => {
      const outlets = await data.nearbyOutlets(mode === "any" ? null : mode);
      if (outlets === null) {
        return "The user's location isn't available. Ask them to allow location access in the app or tell you their area.";
      }
      return JSON.stringify(outlets);
    },
  });

  const getOutletDetails = betaTool({
    name: "get_outlet_details",
    description:
      "Get one outlet's services (name, duration, price), opening hours, address, payment methods accepted, and whether it offers mobile washes.",
    inputSchema: {
      type: "object",
      properties: {
        outlet: { type: "string", description: "The outlet's name (or id from find_nearby_outlets)." },
      },
      required: ["outlet"],
      additionalProperties: false,
    },
    run: async ({ outlet }) => {
      const details = await data.outletDetails(outlet);
      return details ? JSON.stringify(details) : `No outlet found matching "${outlet}".`;
    },
  });

  const getMyBookings = betaTool({
    name: "get_my_bookings",
    description:
      "Get the signed-in user's recent and upcoming bookings: reference, outlet, time, services, status, total and payment status.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => JSON.stringify(await data.myBookings()),
  });

  const handOffToHuman = betaTool({
    name: "hand_off_to_human",
    description:
      "Pass this conversation to the Splashly support team, who will reply in this chat. Use it when you can't resolve the issue yourself (see instructions).",
    inputSchema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "One or two sentences for the support team: what the user needs and anything you already found.",
        },
      },
      required: ["reason"],
      additionalProperties: false,
    },
    run: ({ reason }) => {
      handoff = { reason };
      return "Handed off. Tell the user a member of the Splashly team will reply here soon.";
    },
  });

  const messages = toMessages(history);
  if (!messages.length) {
    return { reply: "Hi! How can I help with your car wash today?", handoff: null };
  }

  let final: Anthropic.Beta.BetaMessage;
  try {
    final = await client.beta.messages.toolRunner({
      model,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages,
      tools: [findNearbyOutlets, getOutletDetails, getMyBookings, handOffToHuman],
      output_config: { effort: "low" },
      // If the model declines for policy reasons, retry on Anthropic's
      // recommended fallback model instead of failing the chat.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      max_iterations: 6,
    });
  } catch (error) {
    console.error("support assistant failed", error);
    return {
      reply: "Sorry, I'm having trouble right now. I've passed your message to the Splashly team and someone will reply here.",
      handoff: { reason: "The assistant hit an error answering this conversation." },
    };
  }

  const text = final.content
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  if (final.stop_reason === "refusal" || !text) {
    return {
      reply: "I've passed this to the Splashly team and someone will reply here soon.",
      handoff: handoff ?? { reason: "The assistant couldn't answer this message." },
    };
  }

  return { reply: text, handoff };
}
