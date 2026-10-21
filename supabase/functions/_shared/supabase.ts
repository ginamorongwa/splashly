import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

import { requireEnv } from "./http.ts";

// Full-access client for trusted server-side writes. Never expose this key.
export function serviceClient(): SupabaseClient {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

// Resolves the signed-in user from the request's Authorization header.
export async function getUser(req: Request): Promise<User | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const client = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data, error } = await client.auth.getUser();
  if (error) return null;
  return data.user;
}
