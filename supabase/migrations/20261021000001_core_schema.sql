-- Splashly core schema: accounts, outlets, services, scheduling, bookings,
-- payments, reviews, chat and support.
--
-- Money is stored in cents (ZAR) as integers. Times are timestamptz; each
-- outlet has a timezone (default Africa/Johannesburg) used to interpret its
-- opening hours.

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  phone text,
  avatar_url text,
  role text not null default 'customer' check (role in ('customer', 'outlet_owner', 'admin')),
  home_address text,
  work_address text,
  created_at timestamptz not null default now()
);

-- Create a profile row for every new auth user. full_name / role can be passed
-- as user metadata at sign-up; admin can never be self-assigned.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone, role)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'phone',
    case when new.raw_user_meta_data ->> 'role' = 'outlet_owner' then 'outlet_owner' else 'customer' end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  make text not null,
  model text not null,
  colour text,
  body_type text check (body_type in ('hatchback', 'sedan', 'suv', 'bakkie', 'minibus', 'other')),
  plate text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.push_tokens (
  user_id uuid not null references public.profiles (id) on delete cascade,
  token text not null,
  platform text not null check (platform in ('ios', 'android', 'web')),
  created_at timestamptz not null default now(),
  primary key (user_id, token)
);

-- Single-row table for settings that belong to the app owner (you).
create table public.platform_settings (
  id boolean primary key default true check (id),
  booking_fee_cents integer not null default 0 check (booking_fee_cents >= 0),
  support_email text
);
insert into public.platform_settings default values;

-- ---------------------------------------------------------------------------
-- Outlets and what they offer
-- ---------------------------------------------------------------------------

create table public.outlets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  description text,
  phone text,
  whatsapp text,
  address text not null,
  lat double precision not null,
  lng double precision not null,
  timezone text not null default 'Africa/Johannesburg',
  cover_image_url text,
  offers_walk_in boolean not null default true,
  offers_mobile boolean not null default false,
  mobile_radius_km numeric(5, 1) not null default 10,
  mobile_travel_minutes integer not null default 20 check (mobile_travel_minutes >= 0),
  call_out_fee_cents integer not null default 0 check (call_out_fee_cents >= 0),
  slot_interval_minutes integer not null default 30 check (slot_interval_minutes between 5 and 120),
  buffer_minutes integer not null default 10 check (buffer_minutes >= 0),
  cancellation_hours integer not null default 2 check (cancellation_hours >= 0),
  auto_accept boolean not null default true,
  accepting_bookings boolean not null default true,
  accepted_payment_methods text[] not null default array['card', 'eft', 'bank_transfer', 'pay_at_outlet'],
  show_bank_details boolean not null default false,
  verified boolean not null default false,
  created_at timestamptz not null default now()
);
create index outlets_owner_idx on public.outlets (owner_id);

-- Kept separate from outlets so the public can't read account numbers.
create table public.outlet_bank_details (
  outlet_id uuid primary key references public.outlets (id) on delete cascade,
  bank_name text not null,
  account_name text not null,
  account_number text not null,
  branch_code text not null,
  updated_at timestamptz not null default now()
);

create table public.opening_hours (
  outlet_id uuid not null references public.outlets (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6), -- 0 = Sunday
  opens_at time not null,
  closes_at time not null check (closes_at > opens_at),
  primary key (outlet_id, weekday)
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id) on delete cascade,
  name text not null,
  description text,
  duration_minutes integer not null check (duration_minutes between 5 and 600),
  price_cents integer not null check (price_cents >= 0),
  available_walk_in boolean not null default true,
  available_mobile boolean not null default true,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index services_outlet_idx on public.services (outlet_id);

-- Bays (at the outlet) and mobile teams. Each booking occupies one resource.
create table public.resources (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('bay', 'mobile_team')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index resources_outlet_idx on public.resources (outlet_id);

-- Lunch breaks, maintenance, public holidays. resource_id null = whole outlet.
create table public.time_blocks (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets (id) on delete cascade,
  resource_id uuid references public.resources (id) on delete cascade,
  slot tstzrange not null,
  reason text,
  created_at timestamptz not null default now()
);
create index time_blocks_outlet_idx on public.time_blocks using gist (outlet_id, slot);

-- ---------------------------------------------------------------------------
-- Bookings and payments
-- ---------------------------------------------------------------------------

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  customer_id uuid not null references public.profiles (id),
  outlet_id uuid not null references public.outlets (id),
  resource_id uuid not null references public.resources (id),
  vehicle_id uuid references public.vehicles (id) on delete set null,
  mode text not null check (mode in ('walk_in', 'mobile')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- Time the resource is occupied: the wash plus buffer (and travel for mobile).
  slot tstzrange not null,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'declined', 'no_show')),
  service_address text,
  service_lat double precision,
  service_lng double precision,
  notes text,
  subtotal_cents integer not null,
  call_out_fee_cents integer not null default 0,
  booking_fee_cents integer not null default 0,
  total_cents integer not null,
  payment_method text not null check (payment_method in ('card', 'eft', 'qr', 'bank_transfer', 'pay_at_outlet')),
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'awaiting_proof', 'proof_uploaded', 'paid', 'refunded')),
  proof_of_payment_path text,
  -- Unpaid online / bank-transfer bookings are released after this time.
  hold_expires_at timestamptz,
  created_at timestamptz not null default now(),
  -- The database itself guarantees a bay or team is never double-booked.
  constraint bookings_no_overlap exclude using gist (resource_id with =, slot with &&)
    where (status in ('pending', 'confirmed', 'in_progress'))
);
create index bookings_customer_idx on public.bookings (customer_id, starts_at desc);
create index bookings_outlet_idx on public.bookings (outlet_id, starts_at);

-- Snapshot of what was booked, so later price changes don't alter history.
create table public.booking_services (
  booking_id uuid not null references public.bookings (id) on delete cascade,
  service_id uuid references public.services (id) on delete set null,
  name text not null,
  price_cents integer not null,
  duration_minutes integer not null,
  primary key (booking_id, name)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  provider text not null default 'paystack',
  provider_reference text not null unique,
  amount_cents integer not null,
  status text not null default 'pending' check (status in ('pending', 'success', 'failed', 'refunded')),
  raw jsonb,
  created_at timestamptz not null default now()
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id) on delete cascade,
  customer_id uuid not null references public.profiles (id),
  outlet_id uuid not null references public.outlets (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);
create index reviews_outlet_idx on public.reviews (outlet_id);

-- ---------------------------------------------------------------------------
-- Messaging: customer <-> outlet per booking, and customer <-> support
-- ---------------------------------------------------------------------------

create table public.booking_messages (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  sender_id uuid not null references public.profiles (id),
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index booking_messages_booking_idx on public.booking_messages (booking_id, created_at);

-- status: 'bot' = the AI assistant answers; 'waiting_for_human' = handed off,
-- shown in the admin inbox; 'with_human' = an admin has replied; 'closed'.
create table public.support_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'bot' check (status in ('bot', 'waiting_for_human', 'with_human', 'closed')),
  handoff_reason text,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index support_conversations_user_idx on public.support_conversations (user_id, last_message_at desc);
create index support_conversations_status_idx on public.support_conversations (status, last_message_at);

create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations (id) on delete cascade,
  sender text not null check (sender in ('user', 'bot', 'agent')),
  sender_id uuid references public.profiles (id),
  body text not null check (length(body) between 1 and 8000),
  created_at timestamptz not null default now()
);
create index support_messages_conversation_idx on public.support_messages (conversation_id, created_at);

create function public.touch_support_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update support_conversations
  set last_message_at = new.created_at,
      -- An admin reply takes the conversation over from the bot.
      status = case when new.sender = 'agent' and status in ('bot', 'waiting_for_human') then 'with_human' else status end
  where id = new.conversation_id;
  return new;
end;
$$;

create trigger support_messages_touch
  after insert on public.support_messages
  for each row execute function public.touch_support_conversation();

-- ---------------------------------------------------------------------------
-- Scheduling logic
-- ---------------------------------------------------------------------------

-- Cancels unpaid holds whose time ran out, freeing the bay for others.
create function public.release_expired_holds(p_outlet_id uuid default null)
returns integer
language sql
security definer
set search_path = public
as $$
  with released as (
    update bookings
    set status = 'cancelled'
    where status in ('pending', 'confirmed')
      and payment_status in ('unpaid', 'awaiting_proof')
      and payment_method <> 'pay_at_outlet'
      and hold_expires_at < now()
      and (p_outlet_id is null or outlet_id = p_outlet_id)
    returning 1
  )
  select count(*)::integer from released;
$$;

-- Total minutes for a set of services; raises if any service is invalid.
create function public.booking_duration(p_outlet_id uuid, p_service_ids uuid[], p_mode text)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_minutes integer;
begin
  if p_mode not in ('walk_in', 'mobile') then
    raise exception 'Unknown mode %', p_mode using errcode = '22023';
  end if;
  if coalesce(cardinality(p_service_ids), 0) = 0 then
    raise exception 'Choose at least one service' using errcode = '22023';
  end if;

  select count(*), sum(duration_minutes)
  into v_count, v_minutes
  from services
  where outlet_id = p_outlet_id
    and id = any (p_service_ids)
    and active
    and (case when p_mode = 'mobile' then available_mobile else available_walk_in end);

  if v_count <> cardinality(array(select distinct unnest(p_service_ids))) then
    raise exception 'One or more services are not available for this booking' using errcode = '22023';
  end if;
  return v_minutes;
end;
$$;

-- Minutes a resource is blocked for: wash + buffer (+ travel for mobile).
create function public.occupied_minutes(p_outlet public.outlets, p_mode text, p_duration integer)
returns integer
language sql
immutable
as $$
  select p_duration + p_outlet.buffer_minutes
    + case when p_mode = 'mobile' then p_outlet.mobile_travel_minutes else 0 end;
$$;

-- Free start times on a local date, with how many bays/teams are free at each.
create function public.get_available_slots(
  p_outlet_id uuid,
  p_date date,
  p_service_ids uuid[],
  p_mode text default 'walk_in'
)
returns table (starts_at timestamptz, ends_at timestamptz, free_resources integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_outlet outlets;
  v_hours opening_hours;
  v_duration integer;
  v_occupied integer;
begin
  select * into v_outlet from outlets where id = p_outlet_id;
  if not found then
    raise exception 'Outlet not found' using errcode = 'P0002';
  end if;
  if not v_outlet.accepting_bookings
     or (p_mode = 'walk_in' and not v_outlet.offers_walk_in)
     or (p_mode = 'mobile' and not v_outlet.offers_mobile) then
    return;
  end if;

  v_duration := booking_duration(p_outlet_id, p_service_ids, p_mode);
  v_occupied := occupied_minutes(v_outlet, p_mode, v_duration);

  select * into v_hours
  from opening_hours
  where outlet_id = p_outlet_id and weekday = extract(dow from p_date)::smallint;
  if not found then
    return;
  end if;

  return query
  with candidates as (
    select (t at time zone v_outlet.timezone) as s
    from generate_series(
      p_date + v_hours.opens_at,
      p_date + v_hours.closes_at - make_interval(mins => v_duration),
      make_interval(mins => v_outlet.slot_interval_minutes)
    ) as t
  )
  select c.s, c.s + make_interval(mins => v_duration), count(r.id)::integer
  from candidates c
  join resources r
    on r.outlet_id = p_outlet_id
   and r.active
   and r.kind = case when p_mode = 'mobile' then 'mobile_team' else 'bay' end
  where c.s > now()
    and not exists (
      select 1 from bookings b
      where b.resource_id = r.id
        and b.status in ('pending', 'confirmed', 'in_progress')
        and not (b.payment_status in ('unpaid', 'awaiting_proof')
                 and b.payment_method <> 'pay_at_outlet'
                 and b.hold_expires_at < now())
        and b.slot && tstzrange(c.s, c.s + make_interval(mins => v_occupied))
    )
    and not exists (
      select 1 from time_blocks tb
      where tb.outlet_id = p_outlet_id
        and (tb.resource_id is null or tb.resource_id = r.id)
        and tb.slot && tstzrange(c.s, c.s + make_interval(mins => v_duration))
    )
  group by c.s
  order by c.s;
end;
$$;

-- The soonest free start time within the next two weeks (the "auto-pick" button).
create function public.find_soonest_slot(p_outlet_id uuid, p_service_ids uuid[], p_mode text default 'walk_in')
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz text;
  v_today date;
  v_found timestamptz;
begin
  select timezone into v_tz from outlets where id = p_outlet_id;
  v_today := (now() at time zone coalesce(v_tz, 'Africa/Johannesburg'))::date;
  for i in 0..13 loop
    select s.starts_at into v_found
    from get_available_slots(p_outlet_id, v_today + i, p_service_ids, p_mode) s
    limit 1;
    if v_found is not null then
      return v_found;
    end if;
  end loop;
  return null;
end;
$$;

create function public.distance_km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision
language sql
immutable
as $$
  select 6371 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

-- Outlets near a point, for the Explore screen.
create function public.nearby_outlets(
  p_lat double precision,
  p_lng double precision,
  p_radius_km double precision default 15,
  p_mode text default null -- null = any, 'walk_in' or 'mobile'
)
returns table (
  id uuid,
  name text,
  address text,
  lat double precision,
  lng double precision,
  cover_image_url text,
  offers_walk_in boolean,
  offers_mobile boolean,
  verified boolean,
  distance_km double precision,
  from_price_cents integer,
  rating numeric,
  review_count integer
)
language sql
stable
security definer
set search_path = public
as $$
  select o.id, o.name, o.address, o.lat, o.lng, o.cover_image_url, o.offers_walk_in, o.offers_mobile,
         o.verified, d.km,
         (select min(s.price_cents) from services s where s.outlet_id = o.id and s.active)::integer,
         (select round(avg(r.rating)::numeric, 1) from reviews r where r.outlet_id = o.id),
         (select count(*) from reviews r where r.outlet_id = o.id)::integer
  from outlets o
  cross join lateral (select distance_km(p_lat, p_lng, o.lat, o.lng) as km) d
  where o.accepting_bookings
    and (p_mode is null
         or (p_mode = 'walk_in' and o.offers_walk_in)
         or (p_mode = 'mobile' and o.offers_mobile and d.km <= o.mobile_radius_km))
    and d.km <= p_radius_km
  order by d.km;
$$;

create function public.new_booking_reference()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  v_ref text;
begin
  loop
    v_ref := 'SPL-' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
    exit when not exists (select 1 from bookings where reference = v_ref);
  end loop;
  return v_ref;
end;
$$;

-- Books a slot for the signed-in customer. The bay / mobile team is chosen
-- automatically (first free one), which is what powers auto-scheduling.
create function public.create_booking(
  p_outlet_id uuid,
  p_service_ids uuid[],
  p_starts_at timestamptz,
  p_mode text,
  p_payment_method text,
  p_vehicle_id uuid default null,
  p_notes text default null,
  p_service_address text default null,
  p_service_lat double precision default null,
  p_service_lng double precision default null
)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_outlet outlets;
  v_duration integer;
  v_occupied integer;
  v_subtotal integer;
  v_call_out integer := 0;
  v_fee integer := 0;
  v_booking bookings;
  v_resource record;
begin
  if v_user is null then
    raise exception 'Sign in to book' using errcode = '42501';
  end if;

  select * into v_outlet from outlets where id = p_outlet_id;
  if not found then
    raise exception 'Outlet not found' using errcode = 'P0002';
  end if;
  if not v_outlet.accepting_bookings then
    raise exception 'This outlet is not taking bookings right now' using errcode = '22023';
  end if;
  if not (p_payment_method = any (v_outlet.accepted_payment_methods)) then
    raise exception 'This outlet does not accept %', p_payment_method using errcode = '22023';
  end if;
  if p_payment_method = 'bank_transfer' and not v_outlet.show_bank_details then
    raise exception 'This outlet does not accept direct bank transfers' using errcode = '22023';
  end if;
  if p_vehicle_id is not null and not exists (select 1 from vehicles where id = p_vehicle_id and owner_id = v_user) then
    raise exception 'Vehicle not found' using errcode = 'P0002';
  end if;

  if p_mode = 'mobile' then
    if not v_outlet.offers_mobile then
      raise exception 'This outlet does not offer mobile washes' using errcode = '22023';
    end if;
    if p_service_address is null or p_service_lat is null or p_service_lng is null then
      raise exception 'A mobile wash needs an address' using errcode = '22023';
    end if;
    if distance_km(v_outlet.lat, v_outlet.lng, p_service_lat, p_service_lng) > v_outlet.mobile_radius_km then
      raise exception 'That address is outside this outlet''s travel area' using errcode = '22023';
    end if;
    v_call_out := v_outlet.call_out_fee_cents;
  elsif not v_outlet.offers_walk_in then
    raise exception 'This outlet only offers mobile washes' using errcode = '22023';
  end if;

  -- Must be one of the advertised start times.
  if not exists (
    select 1 from get_available_slots(p_outlet_id, (p_starts_at at time zone v_outlet.timezone)::date, p_service_ids, p_mode) s
    where s.starts_at = p_starts_at
  ) then
    raise exception 'That time is no longer available' using errcode = '23P01';
  end if;

  perform release_expired_holds(p_outlet_id);

  v_duration := booking_duration(p_outlet_id, p_service_ids, p_mode);
  v_occupied := occupied_minutes(v_outlet, p_mode, v_duration);
  select sum(price_cents) into v_subtotal from services where id = any (p_service_ids);
  if p_payment_method in ('card', 'eft', 'qr') then
    select booking_fee_cents into v_fee from platform_settings;
  end if;

  -- Try each free bay/team in order; the exclusion constraint makes this safe
  -- when two people book the same slot at the same moment.
  for v_resource in
    select r.id from resources r
    where r.outlet_id = p_outlet_id
      and r.active
      and r.kind = case when p_mode = 'mobile' then 'mobile_team' else 'bay' end
      and not exists (
        select 1 from time_blocks tb
        where tb.outlet_id = p_outlet_id
          and (tb.resource_id is null or tb.resource_id = r.id)
          and tb.slot && tstzrange(p_starts_at, p_starts_at + make_interval(mins => v_duration))
      )
    order by r.name
  loop
    begin
      insert into bookings (
        reference, customer_id, outlet_id, resource_id, vehicle_id, mode, starts_at, ends_at, slot,
        status, service_address, service_lat, service_lng, notes,
        subtotal_cents, call_out_fee_cents, booking_fee_cents, total_cents,
        payment_method, payment_status, hold_expires_at
      ) values (
        new_booking_reference(), v_user, p_outlet_id, v_resource.id, p_vehicle_id, p_mode,
        p_starts_at, p_starts_at + make_interval(mins => v_duration),
        tstzrange(p_starts_at, p_starts_at + make_interval(mins => v_occupied)),
        case when v_outlet.auto_accept then 'confirmed' else 'pending' end,
        p_service_address, p_service_lat, p_service_lng, p_notes,
        v_subtotal, v_call_out, v_fee, v_subtotal + v_call_out + v_fee,
        p_payment_method,
        case when p_payment_method = 'bank_transfer' then 'awaiting_proof' else 'unpaid' end,
        case
          when p_payment_method in ('card', 'eft', 'qr') then now() + interval '20 minutes'
          when p_payment_method = 'bank_transfer' then now() + interval '2 hours'
        end
      )
      returning * into v_booking;

      insert into booking_services (booking_id, service_id, name, price_cents, duration_minutes)
      select v_booking.id, s.id, s.name, s.price_cents, s.duration_minutes
      from services s where s.id = any (p_service_ids);

      return v_booking;
    exception when exclusion_violation then
      -- Someone else just took this bay; try the next one.
    end;
  end loop;

  raise exception 'That time is no longer available' using errcode = '23P01';
end;
$$;

create function public.is_outlet_owner(p_outlet_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from outlets where id = p_outlet_id and owner_id = auth.uid());
$$;

-- Customer cancels (within the outlet's window) or outlet cancels any time.
create function public.cancel_booking(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking bookings;
  v_hours integer;
begin
  select b.* into v_booking from bookings b where b.id = p_booking_id for update;
  if not found then
    raise exception 'Booking not found' using errcode = 'P0002';
  end if;
  if v_booking.status not in ('pending', 'confirmed') then
    raise exception 'This booking can no longer be cancelled' using errcode = '22023';
  end if;

  if is_outlet_owner(v_booking.outlet_id) then
    null;
  elsif v_booking.customer_id = auth.uid() then
    select cancellation_hours into v_hours from outlets where id = v_booking.outlet_id;
    if now() > v_booking.starts_at - make_interval(hours => v_hours) then
      raise exception 'Free cancellation closed % hours before the booking; please contact the outlet', v_hours
        using errcode = '22023';
    end if;
  else
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  update bookings set status = 'cancelled' where id = p_booking_id returning * into v_booking;
  return v_booking;
end;
$$;

-- Outlet moves a booking through its life: accept/decline, start, finish, no-show.
create function public.update_booking_status(p_booking_id uuid, p_status text)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking bookings;
  v_allowed boolean;
begin
  select * into v_booking from bookings where id = p_booking_id for update;
  if not found or not is_outlet_owner(v_booking.outlet_id) then
    raise exception 'Booking not found' using errcode = 'P0002';
  end if;

  v_allowed := case
    when v_booking.status = 'pending' then p_status in ('confirmed', 'declined')
    when v_booking.status = 'confirmed' then p_status in ('in_progress', 'no_show', 'completed')
    when v_booking.status = 'in_progress' then p_status = 'completed'
    else false
  end;
  if not v_allowed then
    raise exception 'Cannot change a % booking to %', v_booking.status, p_status using errcode = '22023';
  end if;

  update bookings set status = p_status where id = p_booking_id returning * into v_booking;
  return v_booking;
end;
$$;

-- Outlet moves a booking to another bay/team (same time).
create function public.reassign_booking(p_booking_id uuid, p_resource_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking bookings;
begin
  select * into v_booking from bookings where id = p_booking_id for update;
  if not found or not is_outlet_owner(v_booking.outlet_id) then
    raise exception 'Booking not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from resources where id = p_resource_id and outlet_id = v_booking.outlet_id and active) then
    raise exception 'Bay or team not found' using errcode = 'P0002';
  end if;

  update bookings set resource_id = p_resource_id where id = p_booking_id returning * into v_booking;
  return v_booking;
exception when exclusion_violation then
  raise exception 'That bay is already booked at this time' using errcode = '23P01';
end;
$$;

-- Customer has uploaded proof of a direct bank transfer.
create function public.submit_payment_proof(p_booking_id uuid, p_path text)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking bookings;
begin
  update bookings
  set payment_status = 'proof_uploaded', proof_of_payment_path = p_path,
      -- Keep the slot while the outlet checks the transfer.
      hold_expires_at = null
  where id = p_booking_id
    and customer_id = auth.uid()
    and payment_method = 'bank_transfer'
    and payment_status in ('awaiting_proof', 'proof_uploaded')
    and status in ('pending', 'confirmed')
  returning * into v_booking;
  if not found then
    raise exception 'Booking not found' using errcode = 'P0002';
  end if;
  return v_booking;
end;
$$;

-- Outlet confirms money has arrived (bank transfer or paid at outlet).
create function public.mark_booking_paid(p_booking_id uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking bookings;
begin
  update bookings
  set payment_status = 'paid', hold_expires_at = null
  where id = p_booking_id
    and is_outlet_owner(outlet_id)
    and payment_method in ('bank_transfer', 'pay_at_outlet')
    and status not in ('cancelled', 'declined')
  returning * into v_booking;
  if not found then
    raise exception 'Booking not found' using errcode = 'P0002';
  end if;
  return v_booking;
end;
$$;

-- Bank details are only shown to a customer with a bank-transfer booking.
create function public.get_bank_details_for_booking(p_booking_id uuid)
returns table (bank_name text, account_name text, account_number text, branch_code text, reference text)
language sql
stable
security definer
set search_path = public
as $$
  select d.bank_name, d.account_name, d.account_number, d.branch_code, b.reference
  from bookings b
  join outlets o on o.id = b.outlet_id and o.show_bank_details
  join outlet_bank_details d on d.outlet_id = b.outlet_id
  where b.id = p_booking_id
    and b.payment_method = 'bank_transfer'
    and (b.customer_id = auth.uid() or o.owner_id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.vehicles enable row level security;
alter table public.push_tokens enable row level security;
alter table public.platform_settings enable row level security;
alter table public.outlets enable row level security;
alter table public.outlet_bank_details enable row level security;
alter table public.opening_hours enable row level security;
alter table public.services enable row level security;
alter table public.resources enable row level security;
alter table public.time_blocks enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_services enable row level security;
alter table public.payments enable row level security;
alter table public.reviews enable row level security;
alter table public.booking_messages enable row level security;
alter table public.support_conversations enable row level security;
alter table public.support_messages enable row level security;

-- profiles
create policy "Read own profile" on public.profiles for select using (id = auth.uid() or is_admin());
create policy "Outlets read their customers" on public.profiles for select using (
  exists (select 1 from bookings b join outlets o on o.id = b.outlet_id
          where b.customer_id = profiles.id and o.owner_id = auth.uid())
);
create policy "Update own profile" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- Only an admin can change someone's role.
create function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role and not is_admin() and auth.uid() is not null then
    raise exception 'Only an admin can change roles' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_protect_role
  before update on public.profiles
  for each row execute function public.protect_profile_role();

-- vehicles
create policy "Manage own vehicles" on public.vehicles for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "Outlets read booked vehicles" on public.vehicles for select using (
  exists (select 1 from bookings b where b.vehicle_id = vehicles.id and is_outlet_owner(b.outlet_id))
);

-- push tokens
create policy "Manage own push tokens" on public.push_tokens for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- platform settings (read by anyone, changed only by admin)
create policy "Read platform settings" on public.platform_settings for select using (true);
create policy "Admin updates platform settings" on public.platform_settings for update using (is_admin());

-- outlets and their catalogue are public; owners manage their own
create policy "Anyone can view outlets" on public.outlets for select using (true);
create policy "Owners create outlets" on public.outlets for insert with check (
  owner_id = auth.uid() and verified = false
);
create policy "Owners update outlets" on public.outlets for update using (owner_id = auth.uid() or is_admin())
  with check (owner_id = auth.uid() or is_admin());
create policy "Owners delete outlets" on public.outlets for delete using (owner_id = auth.uid());

create policy "Owners manage bank details" on public.outlet_bank_details for all
  using (is_outlet_owner(outlet_id)) with check (is_outlet_owner(outlet_id));

create policy "Anyone can view hours" on public.opening_hours for select using (true);
create policy "Owners manage hours" on public.opening_hours for all
  using (is_outlet_owner(outlet_id)) with check (is_outlet_owner(outlet_id));

create policy "Anyone can view services" on public.services for select using (true);
create policy "Owners manage services" on public.services for all
  using (is_outlet_owner(outlet_id)) with check (is_outlet_owner(outlet_id));

create policy "Anyone can view resources" on public.resources for select using (true);
create policy "Owners manage resources" on public.resources for all
  using (is_outlet_owner(outlet_id)) with check (is_outlet_owner(outlet_id));

create policy "Owners manage time blocks" on public.time_blocks for all
  using (is_outlet_owner(outlet_id)) with check (is_outlet_owner(outlet_id));

-- bookings: created and changed only through the functions above
create policy "Customers see own bookings" on public.bookings for select using (customer_id = auth.uid());
create policy "Outlets see their bookings" on public.bookings for select using (is_outlet_owner(outlet_id));
create policy "Admin sees bookings" on public.bookings for select using (is_admin());

create policy "See services of visible bookings" on public.booking_services for select using (
  exists (select 1 from bookings b where b.id = booking_services.booking_id)
);

create policy "See payments of visible bookings" on public.payments for select using (
  exists (select 1 from bookings b where b.id = payments.booking_id)
);

-- reviews
create policy "Anyone can read reviews" on public.reviews for select using (true);
create policy "Customers review completed bookings" on public.reviews for insert with check (
  customer_id = auth.uid()
  and exists (select 1 from bookings b
              where b.id = reviews.booking_id and b.customer_id = auth.uid()
                and b.outlet_id = reviews.outlet_id and b.status = 'completed')
);

-- booking chat: the customer and the outlet owner
create policy "Booking participants read messages" on public.booking_messages for select using (
  exists (select 1 from bookings b where b.id = booking_messages.booking_id
          and (b.customer_id = auth.uid() or is_outlet_owner(b.outlet_id)))
);
create policy "Booking participants send messages" on public.booking_messages for insert with check (
  sender_id = auth.uid()
  and exists (select 1 from bookings b where b.id = booking_messages.booking_id
              and (b.customer_id = auth.uid() or is_outlet_owner(b.outlet_id)))
);

-- support chat: users see their own; admins see and answer all.
-- Bot messages are written by the support-chat edge function (service role).
create policy "Users read own support conversations" on public.support_conversations for select
  using (user_id = auth.uid() or is_admin());
create policy "Users start support conversations" on public.support_conversations for insert
  with check (user_id = auth.uid() and status = 'bot');
create policy "Admin updates support conversations" on public.support_conversations for update
  using (is_admin()) with check (is_admin());

create policy "Read support messages" on public.support_messages for select using (
  exists (select 1 from support_conversations c where c.id = support_messages.conversation_id
          and (c.user_id = auth.uid() or is_admin()))
);
create policy "Admin replies to support" on public.support_messages for insert with check (
  is_admin() and sender = 'agent' and sender_id = auth.uid()
);

-- Live updates in the apps
alter publication supabase_realtime add table public.bookings, public.booking_messages, public.support_messages, public.support_conversations;
