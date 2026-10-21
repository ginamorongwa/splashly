"use client";

import { formatRand, formatTime, localDate, type OpeningHours, type Resource } from "@splashly/core";
import { useCallback, useEffect, useState } from "react";

import { Button, Card, Field, PageTitle } from "@/components/ui";
import { dayRange, OUTLET_BOOKING_SELECT, type OutletBooking } from "@/lib/bookings";
import { useDashboard } from "@/lib/dashboard-context";
import { errorMessage, supabase } from "@/lib/supabase";

type TimeBlock = { id: string; resource_id: string | null; slot: string; reason: string | null };

const PX_PER_MIN = 1.2;

// "[\"2026-10-22 10:00:00+00\",\"2026-10-22 11:00:00+00\")" -> [start, end]
function parseRange(range: string): [Date, Date] {
  const toDate = (part: string) => new Date(part.trim().replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  const [a, b] = range.replace(/[[\]()"]/g, "").split(",");
  return [toDate(a), toDate(b)];
}

function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export default function CalendarPage() {
  const { outlet } = useDashboard();
  const [date, setDate] = useState(localDate(new Date()));
  const [resources, setResources] = useState<Resource[]>([]);
  const [hours, setHours] = useState<OpeningHours[]>([]);
  const [bookings, setBookings] = useState<OutletBooking[]>([]);
  const [blocks, setBlocks] = useState<TimeBlock[]>([]);
  const [selected, setSelected] = useState<OutletBooking | null>(null);
  const [blockForm, setBlockForm] = useState({ resource: "", from: "12:00", to: "13:00", reason: "Lunch" });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!outlet) return;
    const { from, to } = dayRange(date);
    const [res, hrs, bks, tbs] = await Promise.all([
      supabase().from("resources").select("*").eq("outlet_id", outlet.id).eq("active", true).order("kind").order("name"),
      supabase().from("opening_hours").select("*").eq("outlet_id", outlet.id),
      supabase()
        .from("bookings")
        .select(OUTLET_BOOKING_SELECT)
        .eq("outlet_id", outlet.id)
        .gte("starts_at", from)
        .lt("starts_at", to)
        .not("status", "in", "(cancelled,declined)"),
      supabase().from("time_blocks").select("*").eq("outlet_id", outlet.id).overlaps("slot", `[${from},${to})`),
    ]);
    setResources(res.data ?? []);
    setHours(hrs.data ?? []);
    setBookings((bks.data as OutletBooking[]) ?? []);
    setBlocks(tbs.data ?? []);
  }, [outlet, date]);

  useEffect(() => {
    load();
  }, [load]);

  if (!outlet) return <p className="text-muted">Set up your outlet first.</p>;

  const weekday = new Date(`${date}T12:00:00+02:00`).getUTCDay();
  const today = hours.find((h) => h.weekday === weekday);
  const startMin = today ? Math.floor(minutesOf(today.opens_at) / 60) * 60 : 7 * 60;
  const endMin = today ? Math.ceil(minutesOf(today.closes_at) / 60) * 60 : 18 * 60;
  const dayStart = new Date(`${date}T00:00:00+02:00`).getTime();
  const offset = (d: Date) => ((d.getTime() - dayStart) / 60000 - startMin) * PX_PER_MIN;
  const hourMarks = Array.from({ length: (endMin - startMin) / 60 + 1 }, (_, i) => startMin + i * 60);

  async function addBlock(event: React.FormEvent) {
    event.preventDefault();
    const from = new Date(`${date}T${blockForm.from}:00+02:00`).toISOString();
    const to = new Date(`${date}T${blockForm.to}:00+02:00`).toISOString();
    const { error } = await supabase()
      .from("time_blocks")
      .insert({ outlet_id: outlet!.id, resource_id: blockForm.resource || null, slot: `[${from},${to})`, reason: blockForm.reason || null });
    setError(error ? errorMessage(error) : null);
    load();
  }

  async function removeBlock(id: string) {
    await supabase().from("time_blocks").delete().eq("id", id);
    load();
  }

  async function reassign(booking: OutletBooking, resourceId: string) {
    const { error } = await supabase().rpc("reassign_booking", { p_booking_id: booking.id, p_resource_id: resourceId });
    setError(error ? errorMessage(error) : null);
    setSelected(null);
    load();
  }

  return (
    <>
      <PageTitle
        title="Calendar"
        subtitle="New bookings go into the first free bay or mobile team automatically."
        action={
          <input
            type="date"
            aria-label="Day"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="min-h-11 rounded-xl border border-line bg-surface px-3"
          />
        }
      />
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {!today ? <p className="text-sm text-warning">You are closed on this day (see My outlet → Opening hours).</p> : null}
      {resources.length === 0 ? (
        <p className="text-sm text-warning">Add bays or mobile teams under My outlet so bookings can be scheduled.</p>
      ) : null}

      <Card className="overflow-x-auto p-0">
        <div className="flex min-w-[640px]">
          <div className="relative w-14 shrink-0 border-r border-line" style={{ height: (endMin - startMin) * PX_PER_MIN + 40 }}>
            {hourMarks.map((m) => (
              <div key={m} className="absolute right-2 text-xs text-muted" style={{ top: 32 + (m - startMin) * PX_PER_MIN - 7 }}>
                {String(m / 60).padStart(2, "0")}:00
              </div>
            ))}
          </div>
          {resources.map((resource) => (
            <div key={resource.id} className="relative flex-1 border-r border-line last:border-r-0" style={{ minWidth: 140 }}>
              <div className="sticky top-0 h-8 border-b border-line px-2 py-1.5 text-xs font-bold">
                {resource.name}
                {resource.kind === "mobile_team" ? <span className="text-muted"> · mobile</span> : null}
              </div>
              <div className="relative" style={{ height: (endMin - startMin) * PX_PER_MIN }}>
                {hourMarks.map((m) => (
                  <div key={m} className="absolute inset-x-0 border-t border-line" style={{ top: (m - startMin) * PX_PER_MIN }} />
                ))}
                {blocks
                  .filter((b) => b.resource_id === null || b.resource_id === resource.id)
                  .map((block) => {
                    const [from, to] = parseRange(block.slot);
                    return (
                      <div
                        key={block.id}
                        className="absolute inset-x-1 rounded-lg border border-line bg-background p-1 text-xs text-muted"
                        style={{ top: offset(from), height: Math.max(18, offset(to) - offset(from)) }}>
                        {block.reason ?? "Blocked"}
                      </div>
                    );
                  })}
                {bookings
                  .filter((b) => b.resource_id === resource.id)
                  .map((booking) => {
                    const top = offset(new Date(booking.starts_at));
                    const height = Math.max(22, offset(new Date(booking.ends_at)) - top);
                    return (
                      <button
                        key={booking.id}
                        type="button"
                        onClick={() => setSelected(booking)}
                        className={`absolute inset-x-1 overflow-hidden rounded-lg border p-1 text-left text-xs ${
                          booking.mode === "mobile" ? "border-success bg-brand-soft" : "border-brand bg-brand-soft"
                        } ${booking.status === "pending" ? "border-dashed" : ""}`}
                        style={{ top, height }}>
                        <div className="font-bold">
                          {formatTime(booking.starts_at, outlet.timezone)} {booking.booking_services.map((s) => s.name).join(", ")}
                        </div>
                        <div className="text-muted">{booking.vehicles ? `${booking.vehicles.make} ${booking.vehicles.model}` : booking.profiles?.full_name}</div>
                      </button>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {selected ? (
        <Card className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold">
                {formatTime(selected.starts_at, outlet.timezone)} · {selected.booking_services.map((s) => s.name).join(", ")}
              </h2>
              <p className="text-sm text-muted">
                {selected.profiles?.full_name} · {formatRand(selected.total_cents)} · {selected.reference}
              </p>
            </div>
            <Button variant="secondary" onClick={() => setSelected(null)}>
              Close
            </Button>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold text-muted">Move to another bay / team (same time)</span>
            <select
              className="min-h-11 rounded-xl border border-line bg-surface px-3"
              value={selected.resource_id}
              onChange={(e) => reassign(selected, e.target.value)}>
              {resources
                .filter((r) => r.kind === resources.find((x) => x.id === selected.resource_id)?.kind)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </select>
          </label>
        </Card>
      ) : null}

      <Card className="flex flex-col gap-4">
        <h2 className="text-lg font-extrabold">Block time</h2>
        <p className="text-sm text-muted">Lunch breaks, maintenance or a walk-in you took by phone. Customers can&apos;t book blocked time.</p>
        <form onSubmit={addBlock} className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold text-muted">Applies to</span>
            <select
              className="min-h-11 rounded-xl border border-line bg-surface px-3"
              value={blockForm.resource}
              onChange={(e) => setBlockForm({ ...blockForm, resource: e.target.value })}>
              <option value="">Whole outlet</option>
              {resources.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <Field label="From" type="time" value={blockForm.from} onChange={(e) => setBlockForm({ ...blockForm, from: e.target.value })} />
          <Field label="To" type="time" value={blockForm.to} onChange={(e) => setBlockForm({ ...blockForm, to: e.target.value })} />
          <Field label="Reason" value={blockForm.reason} onChange={(e) => setBlockForm({ ...blockForm, reason: e.target.value })} />
          <Button type="submit">Add block</Button>
        </form>
        {blocks.length ? (
          <ul className="flex flex-col gap-2 text-sm">
            {blocks.map((block) => {
              const [from, to] = parseRange(block.slot);
              return (
                <li key={block.id} className="flex items-center justify-between gap-2">
                  <span>
                    {formatTime(from.toISOString(), outlet.timezone)}–{formatTime(to.toISOString(), outlet.timezone)} ·{" "}
                    {block.reason ?? "Blocked"} · {resources.find((r) => r.id === block.resource_id)?.name ?? "Whole outlet"}
                  </span>
                  <Button variant="danger" onClick={() => removeBlock(block.id)}>
                    Remove
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </Card>
    </>
  );
}
