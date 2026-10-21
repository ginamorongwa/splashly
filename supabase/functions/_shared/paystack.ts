// Minimal Paystack client (https://paystack.com/docs/api/). Amounts are in
// the currency's subunit, so ZAR cents.

import { requireEnv } from "./http.ts";

const API = "https://api.paystack.co";

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${requireEnv("PAYSTACK_SECRET_KEY")}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const body = await res.json();
  if (!res.ok || !body.status) {
    throw new Error(`Paystack ${path} failed: ${body.message ?? res.status}`);
  }
  return body.data as T;
}

export function initializeTransaction(params: {
  email: string;
  amountCents: number;
  reference: string;
  callbackUrl?: string;
  metadata: Record<string, unknown>;
}) {
  return call<{ authorization_url: string; access_code: string; reference: string }>("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({
      email: params.email,
      amount: params.amountCents,
      currency: "ZAR",
      reference: params.reference,
      callback_url: params.callbackUrl,
      metadata: params.metadata,
    }),
  });
}

// Charges a saved card (a reusable authorization) without the checkout page.
export function chargeAuthorization(params: {
  email: string;
  amountCents: number;
  reference: string;
  authorizationCode: string;
  metadata: Record<string, unknown>;
}) {
  return call<{ status: string; reference: string }>("/transaction/charge_authorization", {
    method: "POST",
    body: JSON.stringify({
      email: params.email,
      amount: params.amountCents,
      currency: "ZAR",
      reference: params.reference,
      authorization_code: params.authorizationCode,
      metadata: params.metadata,
    }),
  });
}

export function verifyTransaction(reference: string) {
  return call<{ status: string; amount: number; currency: string; reference: string }>(
    `/transaction/verify/${encodeURIComponent(reference)}`,
  );
}

// Paystack signs webhook bodies with HMAC-SHA512 using your secret key.
export async function isValidSignature(rawBody: string, signature: string | null): Promise<boolean> {
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(requireEnv("PAYSTACK_SECRET_KEY")),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}
