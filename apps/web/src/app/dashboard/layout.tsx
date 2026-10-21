"use client";

import type { Outlet, Profile } from "@splashly/core";
import type { Session } from "@supabase/supabase-js";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { DashboardContext } from "@/lib/dashboard-context";
import { supabase } from "@/lib/supabase";

const NAV = [
  { href: "/dashboard", label: "Today" },
  { href: "/dashboard/calendar", label: "Calendar" },
  { href: "/dashboard/outlet", label: "My outlet" },
  { href: "/dashboard/settings", label: "Settings" },
];

export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [outlet, setOutlet] = useState<Outlet | null>(null);
  const [ready, setReady] = useState(false);

  const reloadOutlet = useCallback(async () => {
    const { data: auth } = await supabase().auth.getSession();
    if (!auth.session) return;
    const { data } = await supabase()
      .from("outlets")
      .select("*")
      .eq("owner_id", auth.session.user.id)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    setOutlet(data);
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase().auth.getSession();
      if (!data.session) {
        router.replace("/login");
        return;
      }
      setSession(data.session);
      const { data: me } = await supabase().from("profiles").select("*").eq("id", data.session.user.id).single();
      setProfile(me);
      await reloadOutlet();
      setReady(true);
    })();
    const { data: listener } = supabase().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") router.replace("/login");
    });
    return () => listener.subscription.unsubscribe();
  }, [router, reloadOutlet]);

  if (!ready || !session || !profile) {
    return <div className="flex flex-1 items-center justify-center text-muted">Loading…</div>;
  }

  const nav = profile.role === "admin" ? [...NAV, { href: "/dashboard/support", label: "Support inbox" }] : NAV;

  return (
    <DashboardContext.Provider value={{ session, profile, outlet, reloadOutlet }}>
      <div className="flex flex-1 flex-wrap">
        <aside className="flex w-full flex-col gap-1 border-b border-line bg-surface p-4 md:w-60 md:border-b-0 md:border-r">
          <div className="mb-3 flex items-center justify-between md:block">
            <div>
              <div className="text-lg font-extrabold">Splashly</div>
              <div className="text-xs text-muted">{outlet?.name ?? "Set up your outlet"}</div>
            </div>
          </div>
          <nav className="flex flex-wrap gap-1 md:flex-col">
            {nav.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-xl px-3 py-2 text-sm font-bold ${active ? "bg-brand-soft text-brand" : "text-muted hover:text-foreground"}`}>
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <button
            type="button"
            onClick={() => supabase().auth.signOut()}
            className="mt-2 rounded-xl px-3 py-2 text-left text-sm font-bold text-muted hover:text-foreground md:mt-auto">
            Sign out
          </button>
        </aside>
        <main className="flex min-w-0 flex-[999_1_560px] flex-col gap-6 p-4 sm:p-8">{children}</main>
      </div>
    </DashboardContext.Provider>
  );
}
