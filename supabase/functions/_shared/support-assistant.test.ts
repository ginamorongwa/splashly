// deno test supabase/functions/_shared/support-assistant.test.ts
// Checks the hand-off rules without calling the real API.

import type Anthropic from "@anthropic-ai/sdk";

import { runSupportAssistant, type SupportData } from "./support-assistant.ts";

const data: SupportData = {
  nearbyOutlets: () => Promise.resolve([]),
  outletDetails: () => Promise.resolve(null),
  myBookings: () => Promise.resolve([]),
};

function fakeClient(toolRunner: (params?: unknown) => Promise<unknown>): Anthropic {
  return { beta: { messages: { toolRunner } } } as unknown as Anthropic;
}

function assertEquals<T>(actual: T, expected: T) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("returns the model's answer without a hand-off", async () => {
  const client = fakeClient(() =>
    Promise.resolve({ stop_reason: "end_turn", content: [{ type: "text", text: "Open until 18:00." }] })
  );
  const result = await runSupportAssistant({
    client, model: "test", data, history: [{ sender: "user", body: "When do you close?" }],
  });
  assertEquals(result, { reply: "Open until 18:00.", handoff: null });
});

Deno.test("hands off to a person when the API fails", async () => {
  const client = fakeClient(() => Promise.reject(new Error("boom")));
  const result = await runSupportAssistant({
    client, model: "test", data, history: [{ sender: "user", body: "Hi" }],
  });
  assertEquals(result.handoff !== null, true);
});

Deno.test("hands off on a refusal", async () => {
  const client = fakeClient(() => Promise.resolve({ stop_reason: "refusal", content: [] }));
  const result = await runSupportAssistant({
    client, model: "test", data, history: [{ sender: "user", body: "Hi" }],
  });
  assertEquals(result.handoff !== null, true);
});

Deno.test("history must start with the user", async () => {
  let sent: Anthropic.Beta.BetaMessageParam[] = [];
  const client = fakeClient((params?: unknown) => {
    sent = (params as { messages: Anthropic.Beta.BetaMessageParam[] }).messages;
    return Promise.resolve({ stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] });
  });
  await runSupportAssistant({
    client, model: "test", data,
    history: [
      { sender: "bot", body: "Welcome" },
      { sender: "user", body: "Hello" },
      { sender: "user", body: "Anyone?" },
    ],
  });
  assertEquals(sent, [{ role: "user", content: "Hello\n\nAnyone?" }]);
});
