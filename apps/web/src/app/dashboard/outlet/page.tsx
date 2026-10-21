"use client";

import {
  formatDuration,
  formatRand,
  paymentMethodLabels,
  type OpeningHours,
  type Outlet,
  type PaymentMethod,
  type Resource,
  type Service,
} from "@splashly/core";
import { useCallback, useEffect, useState } from "react";

import { Button, Card, Field, PageTitle, Toggle } from "@/components/ui";
import { useDashboard } from "@/lib/dashboard-context";
import { errorMessage, randToCents, supabase } from "@/lib/supabase";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const METHODS: PaymentMethod[] = ["card", "eft", "qr", "bank_transfer", "pay_at_outlet"];

export default function OutletPage() {
  const { outlet } = useDashboard();
  return (
    <>
      <PageTitle title="My outlet" subtitle="What customers see when they find you on Splashly." />
      {outlet ? <OutletEditor outlet={outlet} /> : <CreateOutlet />}
    </>
  );
}

function useLocation() {
  const [coords, setCoords] = useState<{ lat: string; lng: string }>({ lat: "", lng: "" });
  const locate = () =>
    navigator.geolocation.getCurrentPosition((pos) =>
      setCoords({ lat: pos.coords.latitude.toFixed(6), lng: pos.coords.longitude.toFixed(6) }),
    );
  return { coords, setCoords, locate };
}

function CreateOutlet() {
  const { session, reloadOutlet } = useDashboard();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const { coords, setCoords, locate } = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const { data, error } = await supabase()
      .from("outlets")
      .insert({ owner_id: session.user.id, name, address, phone: phone || null, lat: Number(coords.lat), lng: Number(coords.lng) })
      .select("id")
      .single();
    if (!error && data) {
      // Sensible starting point: one bay and Mon–Sat hours. Edit below.
      await supabase().from("resources").insert({ outlet_id: data.id, name: "Bay 1", kind: "bay" });
      await supabase()
        .from("opening_hours")
        .insert([1, 2, 3, 4, 5, 6].map((weekday) => ({ outlet_id: data.id, weekday, opens_at: "08:00", closes_at: weekday === 6 ? "16:00" : "17:30" })));
    }
    setBusy(false);
    if (error) setError(errorMessage(error));
    else reloadOutlet();
  }

  return (
    <Card className="flex max-w-xl flex-col gap-4">
      <h2 className="text-lg font-extrabold">Create your outlet</h2>
      <form onSubmit={create} className="flex flex-col gap-4">
        <Field label="Outlet name" value={name} onChange={(e) => setName(e.target.value)} required />
        <Field label="Street address" value={address} onChange={(e) => setAddress(e.target.value)} required />
        <Field label="Phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+27…" />
        <LocationFields coords={coords} setCoords={setCoords} locate={locate} />
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <Button type="submit" disabled={busy || !coords.lat || !coords.lng}>
          {busy ? "Creating…" : "Create outlet"}
        </Button>
      </form>
    </Card>
  );
}

function LocationFields({
  coords,
  setCoords,
  locate,
}: {
  coords: { lat: string; lng: string };
  setCoords: (c: { lat: string; lng: string }) => void;
  locate: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Latitude" value={coords.lat} onChange={(e) => setCoords({ ...coords, lat: e.target.value })} required />
        <Field label="Longitude" value={coords.lng} onChange={(e) => setCoords({ ...coords, lng: e.target.value })} required />
      </div>
      <p className="text-xs text-muted">
        This is the pin customers see on the map. Stand at your outlet and use your current location, or copy the numbers
        from Google Maps (right-click the spot).
      </p>
      <Button type="button" variant="secondary" onClick={locate} className="self-start">
        Use my current location
      </Button>
    </div>
  );
}

function OutletEditor({ outlet }: { outlet: Outlet }) {
  const { reloadOutlet } = useDashboard();
  const [status, setStatus] = useState<string | null>(null);

  async function save(changes: Partial<Outlet>) {
    const { error } = await supabase().from("outlets").update(changes).eq("id", outlet.id);
    setStatus(error ? errorMessage(error) : "Saved");
    reloadOutlet();
  }

  return (
    <div className="flex flex-col gap-6">
      {status ? <p className={`text-sm ${status === "Saved" ? "text-success" : "text-danger"}`}>{status}</p> : null}
      <DetailsSection outlet={outlet} save={save} />
      <ModesSection outlet={outlet} save={save} />
      <ServicesSection outletId={outlet.id} />
      <HoursSection outletId={outlet.id} />
      <ResourcesSection outletId={outlet.id} />
      <PaymentsSection outlet={outlet} save={save} />
    </div>
  );
}

type SaveFn = (changes: Partial<Outlet>) => Promise<void>;

function DetailsSection({ outlet, save }: { outlet: Outlet; save: SaveFn }) {
  const [form, setForm] = useState({
    name: outlet.name,
    description: outlet.description ?? "",
    address: outlet.address,
    phone: outlet.phone ?? "",
    whatsapp: outlet.whatsapp ?? "",
  });
  const { coords, setCoords, locate } = useLocation();
  useEffect(() => setCoords({ lat: String(outlet.lat), lng: String(outlet.lng) }), [outlet.lat, outlet.lng, setCoords]);
  const [uploading, setUploading] = useState(false);

  async function uploadCover(file: File) {
    setUploading(true);
    const path = `${outlet.id}/cover-${Date.now()}-${file.name}`;
    const { error } = await supabase().storage.from("outlet-photos").upload(path, file, { contentType: file.type });
    if (!error) {
      const { data } = supabase().storage.from("outlet-photos").getPublicUrl(path);
      await save({ cover_image_url: data.publicUrl });
    }
    setUploading(false);
  }

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-lg font-extrabold">Business details</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Outlet name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Field label="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        <Field label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <Field label="WhatsApp" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} />
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold text-muted">Description</span>
        <textarea
          className="min-h-20 rounded-xl border border-line bg-surface p-3 text-base"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </label>
      <LocationFields coords={coords} setCoords={setCoords} locate={locate} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-semibold text-muted">Cover photo {uploading ? "(uploading…)" : ""}</span>
        {outlet.cover_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={outlet.cover_image_url} alt="Outlet cover" className="h-32 w-full max-w-sm rounded-xl object-cover" />
        ) : null}
        <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && uploadCover(e.target.files[0])} />
      </label>
      <Button
        className="self-start"
        onClick={() =>
          save({
            name: form.name,
            description: form.description || null,
            address: form.address,
            phone: form.phone || null,
            whatsapp: form.whatsapp || null,
            lat: Number(coords.lat),
            lng: Number(coords.lng),
          })
        }>
        Save details
      </Button>
    </Card>
  );
}

function ModesSection({ outlet, save }: { outlet: Outlet; save: SaveFn }) {
  const [radius, setRadius] = useState(String(outlet.mobile_radius_km));
  const [fee, setFee] = useState(String(outlet.call_out_fee_cents / 100));
  return (
    <Card className="flex flex-col gap-2">
      <h2 className="text-lg font-extrabold">How you serve customers</h2>
      <Toggle
        label="At my outlet"
        hint="Walk-ins and booked slots in your bays"
        checked={outlet.offers_walk_in}
        onChange={(offers_walk_in) => save({ offers_walk_in })}
      />
      <Toggle
        label="We come to you"
        hint="Mobile washers travel to the customer"
        checked={outlet.offers_mobile}
        onChange={(offers_mobile) => save({ offers_mobile })}
      />
      {outlet.offers_mobile ? (
        <div className="grid items-end gap-3 sm:grid-cols-3">
          <Field label="Travel radius (km)" inputMode="decimal" value={radius} onChange={(e) => setRadius(e.target.value)} />
          <Field label="Call-out fee (R)" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
          <Button onClick={() => save({ mobile_radius_km: Number(radius), call_out_fee_cents: randToCents(fee) })}>Save</Button>
        </div>
      ) : null}
    </Card>
  );
}

function ServicesSection({ outletId }: { outletId: string }) {
  const [services, setServices] = useState<Service[]>([]);
  const [draft, setDraft] = useState({ name: "", description: "", duration: "30", price: "" });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase().from("services").select("*").eq("outlet_id", outletId).order("sort_order").order("price_cents");
    setServices(data ?? []);
  }, [outletId]);
  useEffect(() => {
    load();
  }, [load]);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const { error } = await supabase().from("services").insert({
      outlet_id: outletId,
      name: draft.name,
      description: draft.description || null,
      duration_minutes: Number(draft.duration),
      price_cents: randToCents(draft.price),
      sort_order: services.length,
    });
    setError(error ? errorMessage(error) : null);
    if (!error) setDraft({ name: "", description: "", duration: "30", price: "" });
    load();
  }

  async function update(service: Service, changes: Partial<Service>) {
    await supabase().from("services").update(changes).eq("id", service.id);
    load();
  }

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-extrabold">Services & prices</h2>
        <p className="text-sm text-muted">The duration decides how long a bay is booked for.</p>
      </div>
      <ul className="flex flex-col divide-y divide-line">
        {services.map((s) => (
          <li key={s.id} className={`flex flex-wrap items-center gap-3 py-3 ${s.active ? "" : "opacity-50"}`}>
            <div className="min-w-48 flex-1">
              <div className="font-bold">{s.name}</div>
              <div className="text-sm text-muted">
                {s.description ? `${s.description} · ` : ""}
                {formatDuration(s.duration_minutes)}
              </div>
            </div>
            <div className="font-bold">{formatRand(s.price_cents)}</div>
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={s.available_walk_in} onChange={(e) => update(s, { available_walk_in: e.target.checked })} />
              At outlet
            </label>
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={s.available_mobile} onChange={(e) => update(s, { available_mobile: e.target.checked })} />
              Mobile
            </label>
            <Button variant="secondary" onClick={() => update(s, { active: !s.active })}>
              {s.active ? "Hide" : "Show"}
            </Button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] items-end gap-3">
        <Field label="Service" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Full valet" required />
        <Field label="Short description" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Inside & out" />
        <Field label="Minutes" type="number" min={5} step={5} value={draft.duration} onChange={(e) => setDraft({ ...draft, duration: e.target.value })} required />
        <Field label="Price (R)" inputMode="decimal" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} required />
        <Button type="submit">Add service</Button>
      </form>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </Card>
  );
}

function HoursSection({ outletId }: { outletId: string }) {
  const [rows, setRows] = useState<{ open: boolean; opens_at: string; closes_at: string }[]>(
    DAYS.map(() => ({ open: false, opens_at: "08:00", closes_at: "17:00" })),
  );
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    supabase()
      .from("opening_hours")
      .select("*")
      .eq("outlet_id", outletId)
      .then(({ data }) => {
        const hours = (data ?? []) as OpeningHours[];
        setRows(
          DAYS.map((_, weekday) => {
            const h = hours.find((x) => x.weekday === weekday);
            return h ? { open: true, opens_at: h.opens_at.slice(0, 5), closes_at: h.closes_at.slice(0, 5) } : { open: false, opens_at: "08:00", closes_at: "17:00" };
          }),
        );
      });
  }, [outletId]);

  async function saveHours() {
    const db = supabase();
    const { error: delError } = await db.from("opening_hours").delete().eq("outlet_id", outletId);
    const open = rows.map((r, weekday) => ({ ...r, weekday })).filter((r) => r.open);
    const { error } = open.length
      ? await db.from("opening_hours").insert(open.map((r) => ({ outlet_id: outletId, weekday: r.weekday, opens_at: r.opens_at, closes_at: r.closes_at })))
      : { error: null };
    setStatus(delError || error ? errorMessage(delError ?? error) : "Saved");
  }

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="text-lg font-extrabold">Opening hours</h2>
      {rows.map((row, weekday) => (
        <div key={DAYS[weekday]} className="flex flex-wrap items-center gap-3">
          <label className="flex w-36 items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={row.open}
              onChange={(e) => setRows(rows.map((r, i) => (i === weekday ? { ...r, open: e.target.checked } : r)))}
            />
            {DAYS[weekday]}
          </label>
          {row.open ? (
            <>
              <input
                type="time"
                aria-label={`${DAYS[weekday]} opens`}
                className="min-h-11 rounded-xl border border-line bg-surface px-3"
                value={row.opens_at}
                onChange={(e) => setRows(rows.map((r, i) => (i === weekday ? { ...r, opens_at: e.target.value } : r)))}
              />
              <span className="text-muted">to</span>
              <input
                type="time"
                aria-label={`${DAYS[weekday]} closes`}
                className="min-h-11 rounded-xl border border-line bg-surface px-3"
                value={row.closes_at}
                onChange={(e) => setRows(rows.map((r, i) => (i === weekday ? { ...r, closes_at: e.target.value } : r)))}
              />
            </>
          ) : (
            <span className="text-sm text-muted">Closed</span>
          )}
        </div>
      ))}
      <div className="flex items-center gap-3">
        <Button onClick={saveHours}>Save hours</Button>
        {status ? <span className={`text-sm ${status === "Saved" ? "text-success" : "text-danger"}`}>{status}</span> : null}
      </div>
    </Card>
  );
}

function ResourcesSection({ outletId }: { outletId: string }) {
  const [resources, setResources] = useState<Resource[]>([]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"bay" | "mobile_team">("bay");

  const load = useCallback(async () => {
    const { data } = await supabase().from("resources").select("*").eq("outlet_id", outletId).order("kind").order("name");
    setResources(data ?? []);
  }, [outletId]);
  useEffect(() => {
    load();
  }, [load]);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    await supabase().from("resources").insert({ outlet_id: outletId, name, kind });
    setName("");
    load();
  }

  async function toggle(resource: Resource) {
    await supabase().from("resources").update({ active: !resource.active }).eq("id", resource.id);
    load();
  }

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-extrabold">Bays & mobile teams</h2>
        <p className="text-sm text-muted">
          Each bay or team takes one car at a time. More bays means more bookings at the same time.
        </p>
      </div>
      <ul className="flex flex-col gap-2">
        {resources.map((r) => (
          <li key={r.id} className={`flex items-center justify-between gap-3 ${r.active ? "" : "opacity-50"}`}>
            <span className="font-semibold">
              {r.name} <span className="text-sm text-muted">· {r.kind === "bay" ? "Bay" : "Mobile team"}</span>
            </span>
            <Button variant="secondary" onClick={() => toggle(r)}>
              {r.active ? "Pause" : "Resume"}
            </Button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex flex-wrap items-end gap-3">
        <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Bay 2 / Team A" required />
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold text-muted">Type</span>
          <select className="min-h-11 rounded-xl border border-line bg-surface px-3" value={kind} onChange={(e) => setKind(e.target.value as "bay" | "mobile_team")}>
            <option value="bay">Bay at the outlet</option>
            <option value="mobile_team">Mobile team</option>
          </select>
        </label>
        <Button type="submit">Add</Button>
      </form>
    </Card>
  );
}

function PaymentsSection({ outlet, save }: { outlet: Outlet; save: SaveFn }) {
  const [bank, setBank] = useState({ bank_name: "", account_name: "", account_number: "", branch_code: "" });
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    supabase()
      .from("outlet_bank_details")
      .select("*")
      .eq("outlet_id", outlet.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setBank({ bank_name: data.bank_name, account_name: data.account_name, account_number: data.account_number, branch_code: data.branch_code });
      });
  }, [outlet.id]);

  function toggleMethod(method: PaymentMethod) {
    const current = outlet.accepted_payment_methods;
    save({ accepted_payment_methods: current.includes(method) ? current.filter((m) => m !== method) : [...current, method] });
  }

  async function saveBank(event: React.FormEvent) {
    event.preventDefault();
    const { error } = await supabase()
      .from("outlet_bank_details")
      .upsert({ outlet_id: outlet.id, ...bank, updated_at: new Date().toISOString() });
    setStatus(error ? errorMessage(error) : "Bank details saved");
  }

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="text-lg font-extrabold">Payments</h2>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-muted">Payment options customers can choose</span>
        <div className="flex flex-wrap gap-2">
          {METHODS.map((m) => {
            const on = outlet.accepted_payment_methods.includes(m);
            return (
              <button
                key={m}
                type="button"
                aria-pressed={on}
                onClick={() => toggleMethod(m)}
                className={`min-h-10 rounded-full border px-4 text-sm font-bold ${on ? "border-brand bg-brand text-on-brand" : "border-line bg-surface"}`}>
                {paymentMethodLabels[m]}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted">Card, instant EFT and scan-to-pay are processed by Paystack and paid out by Splashly.</p>
      </div>

      <Toggle
        label="Show my bank details to customers"
        hint="For direct transfers. Customers upload proof of payment and you confirm it."
        checked={outlet.show_bank_details}
        onChange={(show_bank_details) => save({ show_bank_details })}
      />

      <form onSubmit={saveBank} className="grid gap-3 md:grid-cols-2">
        <Field label="Bank" value={bank.bank_name} onChange={(e) => setBank({ ...bank, bank_name: e.target.value })} required />
        <Field label="Account holder" value={bank.account_name} onChange={(e) => setBank({ ...bank, account_name: e.target.value })} required />
        <Field label="Account number" inputMode="numeric" value={bank.account_number} onChange={(e) => setBank({ ...bank, account_number: e.target.value })} required />
        <Field label="Branch code" inputMode="numeric" value={bank.branch_code} onChange={(e) => setBank({ ...bank, branch_code: e.target.value })} required />
        <div className="flex items-center gap-3 md:col-span-2">
          <Button type="submit">Save bank details</Button>
          {status ? <span className="text-sm text-muted">{status}</span> : null}
        </div>
      </form>
      <p className="text-xs text-muted">Only you can see these, and customers who chose bank transfer for a booking with you.</p>
    </Card>
  );
}
