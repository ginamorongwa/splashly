import type { Booking } from "@splashly/core";

export type OutletBooking = Booking & {
  profiles: { full_name: string | null; phone: string | null } | null;
  vehicles: { make: string; model: string; colour: string | null } | null;
  booking_services: { name: string }[];
  resources: { name: string } | null;
};

export const OUTLET_BOOKING_SELECT =
  "*, profiles(full_name, phone), vehicles(make, model, colour), booking_services(name), resources(name)";

// South Africa is UTC+2 all year (no daylight saving).
export function dayRange(date: string): { from: string; to: string } {
  const from = new Date(`${date}T00:00:00+02:00`);
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}
