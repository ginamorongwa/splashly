import type { BookingStatus, PaymentMethod, PaymentStatus } from "./types";

export const TIMEZONE = "Africa/Johannesburg";

// 22000 -> "R220", 22050 -> "R220.50", 286000 -> "R2 860"
export function formatRand(cents: number): string {
  const rand = cents / 100;
  const hasCents = cents % 100 !== 0;
  const [whole, fraction] = rand.toFixed(hasCents ? 2 : 0).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `R${grouped}${fraction ? `.${fraction}` : ""}`;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// "10:30" in the outlet's local time.
export function formatTime(iso: string, timeZone = TIMEZONE): string {
  return new Intl.DateTimeFormat("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(
    new Date(iso),
  );
}

// "Thu 22 Oct"
export function formatDay(iso: string, timeZone = TIMEZONE): string {
  const parts = new Intl.DateTimeFormat("en-ZA", { weekday: "short", day: "numeric", month: "short", timeZone })
    .formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}`;
}

// The local calendar date ("2026-10-22") for an instant, in the outlet's timezone.
export function localDate(date: Date, timeZone = TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(date);
}

export function formatDistance(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  card: "Card",
  eft: "Instant EFT",
  qr: "Scan to pay",
  bank_transfer: "Bank transfer to outlet",
  pay_at_outlet: "Pay at the outlet",
};

export const bookingStatusLabels: Record<BookingStatus, string> = {
  pending: "Waiting for outlet",
  confirmed: "Confirmed",
  in_progress: "Wash in progress",
  completed: "Completed",
  cancelled: "Cancelled",
  declined: "Declined by outlet",
  no_show: "Missed",
};

export const paymentStatusLabels: Record<PaymentStatus, string> = {
  unpaid: "Not paid yet",
  awaiting_proof: "Upload proof of payment",
  proof_uploaded: "Outlet is checking payment",
  paid: "Paid",
  refunded: "Refunded",
};

export const onlinePaymentMethods: PaymentMethod[] = ["card", "eft", "qr"];
