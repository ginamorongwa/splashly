"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button, Card, Field } from "@/components/ui";
import { errorMessage, supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("signup")) setMode("sign-up");
    supabase()
      .auth.getSession()
      .then(({ data }) => {
        if (data.session) router.replace("/dashboard");
      });
  }, [router]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const auth = supabase().auth;
    const { data, error } =
      mode === "sign-in"
        ? await auth.signInWithPassword({ email, password })
        : await auth.signUp({ email, password, options: { data: { full_name: fullName, role: "outlet_owner" } } });
    setBusy(false);
    if (error) setMessage(errorMessage(error));
    else if (data.session) router.replace("/dashboard");
    else setMessage("Check your email to confirm your account, then sign in.");
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <Card className="flex w-full max-w-md flex-col gap-5">
        <div>
          <Link href="/" className="text-sm font-bold text-brand">
            ← Splashly
          </Link>
          <h1 className="mt-2 text-2xl font-extrabold">{mode === "sign-in" ? "Outlet login" : "List your car wash"}</h1>
          <p className="text-sm text-muted">Manage bookings, your calendar and payments.</p>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {mode === "sign-up" ? (
            <Field label="Your name" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" required />
          ) : null}
          <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
            minLength={6}
            required
          />
          {message ? <p className="text-sm text-warning">{message}</p> : null}
          <Button type="submit" disabled={busy}>
            {busy ? "Please wait…" : mode === "sign-in" ? "Sign in" : "Create outlet account"}
          </Button>
        </form>
        <button
          type="button"
          className="text-sm font-bold text-brand"
          onClick={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}>
          {mode === "sign-in" ? "New here? Create an outlet account" : "Already have an account? Sign in"}
        </button>
      </Card>
    </main>
  );
}
