// Row shapes for the Supabase tables (see supabase/migrations). Keep in sync
// with the schema, or replace with generated types:
//   npx supabase gen types typescript --linked > packages/core/src/database.ts

export type ServiceMode = "walk_in" | "mobile";
export type PaymentMethod = "card" | "eft" | "qr" | "bank_transfer" | "pay_at_outlet";
export type PaymentStatus = "unpaid" | "awaiting_proof" | "proof_uploaded" | "paid" | "refunded";
export type BookingStatus = "pending" | "confirmed" | "in_progress" | "completed" | "cancelled" | "declined" | "no_show";
export type SupportStatus = "bot" | "waiting_for_human" | "with_human" | "closed";

export interface Profile {
  id: string;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  role: "customer" | "outlet_owner" | "admin";
  home_address: string | null;
  work_address: string | null;
  preferences: Record<string, unknown>;
}

export interface Vehicle {
  id: string;
  owner_id: string;
  make: string;
  model: string;
  colour: string | null;
  body_type: string | null;
  plate: string | null;
  is_default: boolean;
}

export interface Outlet {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  phone: string | null;
  whatsapp: string | null;
  address: string;
  lat: number;
  lng: number;
  timezone: string;
  cover_image_url: string | null;
  offers_walk_in: boolean;
  offers_mobile: boolean;
  mobile_radius_km: number;
  mobile_travel_minutes: number;
  call_out_fee_cents: number;
  slot_interval_minutes: number;
  buffer_minutes: number;
  cancellation_hours: number;
  auto_accept: boolean;
  accepting_bookings: boolean;
  accepted_payment_methods: PaymentMethod[];
  show_bank_details: boolean;
  verified: boolean;
}

export interface NearbyOutlet {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  cover_image_url: string | null;
  offers_walk_in: boolean;
  offers_mobile: boolean;
  verified: boolean;
  distance_km: number;
  from_price_cents: number | null;
  rating: number | null;
  review_count: number;
}

export interface Service {
  id: string;
  outlet_id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  price_cents: number;
  available_walk_in: boolean;
  available_mobile: boolean;
  active: boolean;
  sort_order: number;
}

export interface Resource {
  id: string;
  outlet_id: string;
  name: string;
  kind: "bay" | "mobile_team";
  active: boolean;
}

export interface OpeningHours {
  outlet_id: string;
  weekday: number; // 0 = Sunday
  opens_at: string; // "07:30:00"
  closes_at: string;
}

export interface Booking {
  id: string;
  reference: string;
  customer_id: string;
  outlet_id: string;
  resource_id: string;
  vehicle_id: string | null;
  mode: ServiceMode;
  starts_at: string;
  ends_at: string;
  status: BookingStatus;
  service_address: string | null;
  notes: string | null;
  subtotal_cents: number;
  call_out_fee_cents: number;
  booking_fee_cents: number;
  total_cents: number;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  proof_of_payment_path: string | null;
  hold_expires_at: string | null;
  created_at: string;
}

export interface Slot {
  starts_at: string;
  ends_at: string;
  free_resources: number;
}

export interface SupportConversation {
  id: string;
  user_id: string;
  status: SupportStatus;
  handoff_reason: string | null;
  created_at: string;
  last_message_at: string;
}

export interface SupportMessage {
  id: string;
  conversation_id: string;
  sender: "user" | "bot" | "agent";
  sender_id: string | null;
  body: string;
  created_at: string;
}
