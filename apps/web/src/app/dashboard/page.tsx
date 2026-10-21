"use client";

import {
  bookingStatusLabels,
  formatRand,
  formatTime,
  localDate,
  paymentMethodLabels,
  paymentStatusLabels,
} from "@splashly/core";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Badge, Button, Card, PageTitle, Toggle } from "@/components/ui";
import { dayRange, OUTLET_BOOKING_SELECT, type OutletBooking } from "@/lib/bookings";
import { useDashboard } from "@/lib/dashboard-context";
import { errorMessage, supabase } from "@/lib/supabase";

export default function TodayPage() {
  const { outlet, reloadOutlet } = useDashboard();
  const [bookings, setBookings] = useState<OutletBooking[]>([]);
  const [pending, setPending] = useState<OutletBooking[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    if (!outlet) return;
    setNow(Date.now());
    const { from, to } = dayRange(localDate(new Date()));
    const [today, requests] = await Promise.all([
      supabase()
        .from("bookings")
        .select(OUTLET_BOOKING_SELECT)
        .eq("outlet_id", outlet.id)
        .gte("starts_at", from)
        .lt("starts_at", to)
        .order("starts_at"),
      supabase()
        .from("bookings")
        .select(OUTLET_BOOKING_SELECT)
        .eq("outlet_id", outlet.id)
        .eq("status", "pending")
        .gte("starts_at", new Date().toISOString())
        .order("starts_at"),
    ]);
    setBookings((today.data as OutletBooking[]) ?? []);
    setPending((requests.data as OutletBooking[]) ?? []);
  }, [outlet]);

  useEffect(() => {
    load();
    if (!outlet) return;
    const channel = supabase()
      .channel(`outlet-${outlet.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings", filter: `outlet_id=eq.${outlet.id}` }, load)
      .subscribe();
    return () => {
      supabase().removeChannel(channel);
    };
  }, [outlet, load]);

  if (!outlet) {
    return (
      <Card className="flex flex-col gap-3">
        <h1 className="text-2xl font-extrabold">Welcome to Splashly</h1>
        <p className="text-muted">Set up your outlet so customers can find and book you.</p>
        <Link href="/dashboard/outlet" className="self-start rounded-xl bg-brand px-4 py-3 font-bold text-on-brand">
          Set up my outlet
        </Link>
      </Card>
    );
  }

  async function run(action: () => PromiseLike<{ error: unknown }>) {
    const { error } = await action();
    setError(error ? errorMessage(error) : null);
    load();
  }

  async function toggleAccepting(next: boolean) {
    await supabase().from("outlets").update({ accepting_bookings: next }).eq("id", outlet!.id);
    reloadOutlet();
  }

  async function viewProof(path: string) {
    const { data, error } = await supabase().storage.from("payment-proofs").createSignedUrl(path, 300);
    if (error) setError(errorMessage(error));
    else window.open(data.signedUrl, "_blank", "noopener");
  }

  const live = bookings.filter((b) => !["cancelled", "declined"].includes(b.status));
  const earned = live.filter((b) => b.payment_status === "paid").reduce((sum, b) => sum + b.total_cents, 0);
  const busyNow = live.filter((b) => b.status === "in_progress" || (new Date(b.starts_at).getTime() <= now && new Date(b.ends_at).getTime() > now)).length;

  return (
    <>
      <PageTitle
        title="Today"
        subtitle={new Intl.DateTimeFormat("en-ZA", { weekday: "long", day: "numeric", month: "long" }).format(new Date())}
      />

      <Card>
        <Toggle
          label={outlet.accepting_bookings ? "Accepting bookings" : "Paused: not taking bookings"}
          hint={outlet.accepting_bookings ? "Customers can find and book you" : "You're hidden from search until you resume"}
          checked={outlet.accepting_bookings}
          onChange={toggleAccepting}
        />
      </Card>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-4">
        <Stat label="Bookings today" value={String(live.length)} />
        <Stat label="Paid today" value={formatRand(earned)} />
        <Stat label="Busy right now" value={String(busyNow)} />
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      {pending.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-extrabold">New requests ({pending.length})</h2>
          {pending.map((b) => (
            <BookingCard key={b.id} booking={b} timezone={outlet.timezone}>
              <Button variant="secondary" onClick={() => run(() => supabase().rpc("update_booking_status", { p_booking_id: b.id, p_status: "declined" }))}>
                Decline
              </Button>
              <Button onClick={() => run(() => supabase().rpc("update_booking_status", { p_booking_id: b.id, p_status: "confirmed" }))}>
                Accept
              </Button>
            </BookingCard>
          ))}
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-extrabold">Schedule</h2>
          <Link href="/dashboard/calendar" className="text-sm font-bold text-brand">
            Open calendar
          </Link>
        </div>
        {bookings.length === 0 ? <p className="text-sm text-muted">No bookings yet today.</p> : null}
        {bookings.map((b) => (
          <BookingCard key={b.id} booking={b} timezone={outlet.timezone}>
            {b.status === "confirmed" ? (
              <Button variant="secondary" onClick={() => run(() => supabase().rpc("update_booking_status", { p_booking_id: b.id, p_status: "in_progress" }))}>
                Start wash
              </Button>
            ) : null}
            {b.status === "in_progress" ? (
              <Button onClick={() => run(() => supabase().rpc("update_booking_status", { p_booking_id: b.id, p_status: "completed" }))}>
                Mark done
              </Button>
            ) : null}
            {b.status === "confirmed" && new Date(b.starts_at).getTime() < now ? (
              <Button variant="danger" onClick={() => run(() => supabase().rpc("update_booking_status", { p_booking_id: b.id, p_status: "no_show" }))}>
                No-show
              </Button>
            ) : null}
            {b.proof_of_payment_path ? (
              <Button variant="secondary" onClick={() => viewProof(b.proof_of_payment_path!)}>
                View proof
              </Button>
            ) : null}
            {["bank_transfer", "pay_at_outlet"].includes(b.payment_method) &&
            b.payment_status !== "paid" &&
            !["cancelled", "declined"].includes(b.status) ? (
              <Button variant="secondary" onClick={() => run(() => supabase().rpc("mark_booking_paid", { p_booking_id: b.id }))}>
                Mark paid
              </Button>
            ) : null}
          </BookingCard>
        ))}
      </section>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <div className="text-sm text-muted">{label}</div>
      <div className="text-2xl font-extrabold">{value}</div>
    </Card>
  );
}

function BookingCard({ booking: b, timezone, children }: { booking: OutletBooking; timezone: string; children?: React.ReactNode }) {
  const tone = b.status === "confirmed" || b.status === "completed" ? "success" : b.status === "pending" || b.status === "in_progress" ? "warning" : "danger";
  return (
    <Card className="flex flex-wrap items-center gap-4">
      <div className="w-14 text-lg font-extrabold">{formatTime(b.starts_at, timezone)}</div>
      <div className="min-w-48 flex-1">
        <div className="font-bold">
          {b.booking_services.map((s) => s.name).join(", ")} · {formatRand(b.total_cents)}
        </div>
        <div className="text-sm text-muted">
          {b.profiles?.full_name ?? "Customer"}
          {b.profiles?.phone ? ` · ${b.profiles.phone}` : ""}
          {b.vehicles ? ` · ${b.vehicles.make} ${b.vehicles.model}${b.vehicles.colour ? ` (${b.vehicles.colour})` : ""}` : ""}
        </div>
        <div className="text-sm text-muted">
          {b.mode === "mobile" ? `Mobile: ${b.service_address}` : b.resources?.name} · {paymentMethodLabels[b.payment_method]}:{" "}
          {paymentStatusLabels[b.payment_status]} · {b.reference}
        </div>
        {b.notes ? <div className="text-sm">Note: {b.notes}</div> : null}
      </div>
      <Badge tone={tone}>{bookingStatusLabels[b.status]}</Badge>
      <div className="flex flex-wrap gap-2">{children}</div>
    </Card>
  );
}
