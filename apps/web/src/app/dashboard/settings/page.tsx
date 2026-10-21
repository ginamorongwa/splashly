"use client";

import type { Outlet } from "@splashly/core";
import { useState } from "react";

import { Button, Card, Field, PageTitle, Toggle } from "@/components/ui";
import { useDashboard } from "@/lib/dashboard-context";
import { errorMessage, supabase } from "@/lib/supabase";

export default function SettingsPage() {
  const { outlet, reloadOutlet } = useDashboard();
  const [status, setStatus] = useState<string | null>(null);
  const [numbers, setNumbers] = useState(() => ({
    buffer_minutes: String(outlet?.buffer_minutes ?? 10),
    slot_interval_minutes: String(outlet?.slot_interval_minutes ?? 30),
    cancellation_hours: String(outlet?.cancellation_hours ?? 2),
    mobile_travel_minutes: String(outlet?.mobile_travel_minutes ?? 20),
  }));

  if (!outlet) return <p className="text-muted">Set up your outlet first.</p>;

  async function save(changes: Partial<Outlet>) {
    const { error } = await supabase().from("outlets").update(changes).eq("id", outlet!.id);
    setStatus(error ? errorMessage(error) : "Saved");
    reloadOutlet();
  }

  return (
    <>
      <PageTitle title="Settings" subtitle={outlet.verified ? `${outlet.name} · Verified outlet` : outlet.name} />
      {status ? <p className={`text-sm ${status === "Saved" ? "text-success" : "text-danger"}`}>{status}</p> : null}

      <Card className="flex flex-col gap-1">
        <h2 className="text-lg font-extrabold">Bookings</h2>
        <Toggle
          label="Accepting bookings"
          hint="Turn off to hide your outlet from search"
          checked={outlet.accepting_bookings}
          onChange={(accepting_bookings) => save({ accepting_bookings })}
        />
        <Toggle
          label="Auto-accept bookings"
          hint="Off = you approve each request on the Today page"
          checked={outlet.auto_accept}
          onChange={(auto_accept) => save({ auto_accept })}
        />
      </Card>

      <Card className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-extrabold">Scheduling</h2>
          <p className="text-sm text-muted">
            Bookings are always placed in the first free bay (or mobile team) automatically, so nothing is double-booked.
          </p>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
          <Field
            label="Buffer between washes (min)"
            type="number"
            min={0}
            value={numbers.buffer_minutes}
            onChange={(e) => setNumbers({ ...numbers, buffer_minutes: e.target.value })}
          />
          <Field
            label="Start times every (min)"
            type="number"
            min={5}
            step={5}
            value={numbers.slot_interval_minutes}
            onChange={(e) => setNumbers({ ...numbers, slot_interval_minutes: e.target.value })}
          />
          <Field
            label="Free cancellation until (hours before)"
            type="number"
            min={0}
            value={numbers.cancellation_hours}
            onChange={(e) => setNumbers({ ...numbers, cancellation_hours: e.target.value })}
          />
          <Field
            label="Travel time for mobile jobs (min)"
            type="number"
            min={0}
            value={numbers.mobile_travel_minutes}
            onChange={(e) => setNumbers({ ...numbers, mobile_travel_minutes: e.target.value })}
          />
        </div>
        <Button
          className="self-start"
          onClick={() =>
            save({
              buffer_minutes: Number(numbers.buffer_minutes),
              slot_interval_minutes: Number(numbers.slot_interval_minutes),
              cancellation_hours: Number(numbers.cancellation_hours),
              mobile_travel_minutes: Number(numbers.mobile_travel_minutes),
            })
          }>
          Save scheduling
        </Button>
      </Card>

      <Card className="flex flex-col gap-2">
        <h2 className="text-lg font-extrabold">Account</h2>
        <p className="text-sm text-muted">Need help, or want to close your outlet account? Email Splashly support.</p>
        <Button variant="secondary" className="self-start" onClick={() => supabase().auth.signOut()}>
          Log out
        </Button>
      </Card>
    </>
  );
}
