-- Scenario tests for scheduling, bookings and access rules.
-- Run with tests/run.sh; any failed assert stops the run.
\set ON_ERROR_STOP 1
\set owner   '00000000-0000-0000-0000-00000000000a'
\set cust_a  '00000000-0000-0000-0000-00000000000b'
\set cust_b  '00000000-0000-0000-0000-00000000000c'
\set cust_c  '00000000-0000-0000-0000-00000000000d'
\set admin   '00000000-0000-0000-0000-00000000000e'
\set outlet  '10000000-0000-0000-0000-000000000001'
\set valet   '20000000-0000-0000-0000-000000000001'
\set ext     '20000000-0000-0000-0000-000000000002'

insert into auth.users (id, email, raw_user_meta_data) values
  (:'owner', 'owner@example.com', '{"full_name": "Owner", "role": "outlet_owner"}'),
  (:'cust_a', 'a@example.com', '{"full_name": "Customer A"}'),
  (:'cust_b', 'b@example.com', '{"full_name": "Customer B"}'),
  (:'cust_c', 'c@example.com', '{"full_name": "Customer C", "role": "admin"}'),
  (:'admin', 'admin@example.com', '{}');
update public.profiles set role = 'admin' where id = :'admin';

do $$ begin
  assert (select role from public.profiles where id = '00000000-0000-0000-0000-00000000000d') = 'customer',
    'admin role must not be self-assignable at sign-up';
end $$;

-- An outlet in Rosebank with two bays and one mobile team, open every day.
insert into public.outlets (id, owner_id, name, address, lat, lng, offers_mobile, call_out_fee_cents, mobile_radius_km)
values (:'outlet', :'owner', 'AquaShine', 'Rosebank', -26.1458, 28.0417, true, 5000, 10);
insert into public.opening_hours (outlet_id, weekday, opens_at, closes_at)
select :'outlet', d, '07:30', '18:00' from generate_series(0, 6) d;
insert into public.services (id, outlet_id, name, duration_minutes, price_cents) values
  (:'valet', :'outlet', 'Full valet', 60, 22000),
  (:'ext', :'outlet', 'Exterior wash', 30, 12000);
insert into public.resources (outlet_id, name, kind) values
  (:'outlet', 'Bay 1', 'bay'), (:'outlet', 'Bay 2', 'bay'), (:'outlet', 'Team A', 'mobile_team');

create temp table t as
select (now() at time zone 'Africa/Johannesburg')::date + 2 as day;
grant select on t to authenticated;

-- ---------------------------------------------------------------- slots
do $$
declare v_free int; v_count int;
begin
  select free_resources into v_free
  from public.get_available_slots('10000000-0000-0000-0000-000000000001', (select day from t),
                                  array['20000000-0000-0000-0000-000000000001']::uuid[], 'walk_in')
  where starts_at = ((select day from t) + time '10:00') at time zone 'Africa/Johannesburg';
  assert v_free = 2, format('expected 2 free bays at 10:00, got %s', v_free);

  select count(*) into v_count
  from public.get_available_slots('10000000-0000-0000-0000-000000000001', (select day from t),
                                  array['20000000-0000-0000-0000-000000000001']::uuid[], 'walk_in');
  -- 07:30 .. 17:00 every 30 min (a 60-min valet must finish by 18:00)
  assert v_count = 20, format('expected 20 slots, got %s', v_count);
end $$;

-- ---------------------------------------------------------------- booking as customers
select set_config('request.jwt.claim.sub', :'cust_a', false);
set role authenticated;
create temp table a_booking as
select * from public.create_booking(:'outlet', array[:'valet']::uuid[],
  ((select day from t) + time '10:00') at time zone 'Africa/Johannesburg', 'walk_in', 'card');
reset role;

select set_config('request.jwt.claim.sub', :'cust_b', false);
set role authenticated;
create temp table b_booking as
select * from public.create_booking(:'outlet', array[:'valet']::uuid[],
  ((select day from t) + time '10:00') at time zone 'Africa/Johannesburg', 'walk_in', 'pay_at_outlet');
reset role;

do $$
declare v_a uuid; v_b uuid;
begin
  select resource_id into v_a from a_booking;
  select resource_id into v_b from b_booking;
  assert v_a <> v_b, 'two bookings at the same time must go to different bays';
  assert (select status from a_booking) = 'confirmed', 'auto_accept should confirm';
  assert (select total_cents from a_booking) = 22000, 'total should be the service price';
  assert (select hold_expires_at from a_booking) is not null, 'card booking should have a payment hold';
  assert (select reference from a_booking) like 'SPL-%', 'reference format';
end $$;

-- A third booking at 10:00 must fail: both bays are taken.
select set_config('request.jwt.claim.sub', :'cust_c', false);
set role authenticated;
do $$
begin
  perform public.create_booking('10000000-0000-0000-0000-000000000001',
    array['20000000-0000-0000-0000-000000000001']::uuid[],
    ((select day from t) + time '10:00') at time zone 'Africa/Johannesburg', 'walk_in', 'card');
  raise exception 'third booking should have failed';
exception when exclusion_violation then
  null; -- expected: 'That time is no longer available'
end $$;
reset role;

do $$
declare v_slots timestamptz[];
begin
  select array_agg(starts_at) into v_slots
  from public.get_available_slots('10000000-0000-0000-0000-000000000001', (select day from t),
                                  array['20000000-0000-0000-0000-000000000001']::uuid[], 'walk_in');
  -- 10:00-11:10 (incl. 10-min buffer) is taken on both bays, so 09:30..11:00 are gone; 11:30 is free.
  assert not (((select day from t) + time '10:00') at time zone 'Africa/Johannesburg' = any (v_slots)), '10:00 should be full';
  assert not (((select day from t) + time '09:30') at time zone 'Africa/Johannesburg' = any (v_slots)), '09:30 overlaps 10:00';
  assert not (((select day from t) + time '11:00') at time zone 'Africa/Johannesburg' = any (v_slots)), '11:00 is inside the buffer';
  assert ((select day from t) + time '11:30') at time zone 'Africa/Johannesburg' = any (v_slots), '11:30 should be free';
end $$;

-- Lunch break for the whole outlet removes overlapping slots.
insert into public.time_blocks (outlet_id, slot, reason)
select :'outlet', tstzrange(((select day from t) + time '12:00') at time zone 'Africa/Johannesburg',
                            ((select day from t) + time '13:00') at time zone 'Africa/Johannesburg'), 'Lunch';
do $$
declare v_slots timestamptz[];
begin
  select array_agg(starts_at) into v_slots
  from public.get_available_slots('10000000-0000-0000-0000-000000000001', (select day from t),
                                  array['20000000-0000-0000-0000-000000000001']::uuid[], 'walk_in');
  assert not (((select day from t) + time '11:30') at time zone 'Africa/Johannesburg' = any (v_slots)), '11:30 valet runs into lunch';
  assert not (((select day from t) + time '12:30') at time zone 'Africa/Johannesburg' = any (v_slots)), '12:30 is lunch';
  assert ((select day from t) + time '13:00') at time zone 'Africa/Johannesburg' = any (v_slots), '13:00 should be free';
end $$;

-- Soonest slot finds something.
do $$ begin
  assert public.find_soonest_slot('10000000-0000-0000-0000-000000000001',
    array['20000000-0000-0000-0000-000000000002']::uuid[], 'walk_in') is not null, 'soonest slot';
end $$;

-- ---------------------------------------------------------------- mobile washes
select set_config('request.jwt.claim.sub', :'cust_c', false);
set role authenticated;
do $$
declare v_b public.bookings;
begin
  -- Pretoria is ~50 km away: outside the 10 km radius.
  begin
    perform public.create_booking('10000000-0000-0000-0000-000000000001',
      array['20000000-0000-0000-0000-000000000001']::uuid[],
      ((select day from t) + time '14:00') at time zone 'Africa/Johannesburg', 'mobile', 'card',
      null, null, 'Pretoria', -25.7479, 28.2293);
    raise exception 'out-of-radius mobile booking should fail';
  exception when invalid_parameter_value then null;
  end;

  v_b := public.create_booking('10000000-0000-0000-0000-000000000001',
      array['20000000-0000-0000-0000-000000000001']::uuid[],
      ((select day from t) + time '14:00') at time zone 'Africa/Johannesburg', 'mobile', 'card',
      null, null, 'Parkview', -26.1600, 28.0300);
  assert v_b.call_out_fee_cents = 5000 and v_b.total_cents = 27000, 'mobile booking adds call-out fee';
  -- wash 60 + buffer 10 + travel 20
  assert upper(v_b.slot) - lower(v_b.slot) = interval '90 minutes', 'mobile slot includes travel time';
end $$;
reset role;

-- ---------------------------------------------------------------- access rules
select set_config('request.jwt.claim.sub', :'cust_b', false);
set role authenticated;
do $$ begin
  assert (select count(*) from public.bookings) = 1, 'customer B must only see their own booking';
  begin
    insert into public.bookings (reference, customer_id, outlet_id, resource_id, mode, starts_at, ends_at, slot,
                                 subtotal_cents, total_cents, payment_method)
    select 'X', auth.uid(), outlet_id, resource_id, mode, starts_at, ends_at, slot, 0, 0, 'card' from public.bookings;
    raise exception 'direct insert into bookings should be blocked';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set role = 'admin' where id = auth.uid();
    raise exception 'role escalation should be blocked';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select set_config('request.jwt.claim.sub', :'owner', false);
set role authenticated;
do $$ begin
  assert (select count(*) from public.bookings) = 3, 'owner sees all bookings at their outlet';
  assert (select count(*) from public.profiles) = 4, 'owner sees own profile and their 3 customers';
end $$;
reset role;

set role anon;
select set_config('request.jwt.claim.sub', '', false);
do $$ begin
  assert (select count(*) from public.outlets) = 1, 'anyone can browse outlets';
  assert (select count(*) from public.bookings) = 0, 'anon sees no bookings';
  assert (select count(*) from public.outlet_bank_details) = 0, 'anon sees no bank details';
end $$;
reset role;

-- ---------------------------------------------------------------- bank transfer flow
insert into public.outlet_bank_details (outlet_id, bank_name, account_name, account_number, branch_code)
values (:'outlet', 'Test Bank', 'AquaShine', '1234567890', '250655');
update public.outlets set show_bank_details = true where id = :'outlet';

select set_config('request.jwt.claim.sub', :'cust_a', false);
set role authenticated;
do $$
declare v_b public.bookings;
begin
  assert (select count(*) from public.outlet_bank_details) = 0, 'customers cannot list bank details';
  assert (select count(*) from public.get_bank_details_for_booking((select id from a_booking))) = 0,
    'card booking does not reveal bank details';

  v_b := public.create_booking('10000000-0000-0000-0000-000000000001',
      array['20000000-0000-0000-0000-000000000002']::uuid[],
      ((select day from t) + time '15:00') at time zone 'Africa/Johannesburg', 'walk_in', 'bank_transfer');
  assert v_b.payment_status = 'awaiting_proof', 'bank transfer waits for proof';
  assert (select account_number from public.get_bank_details_for_booking(v_b.id)) = '1234567890',
    'bank transfer booking reveals bank details';

  v_b := public.submit_payment_proof(v_b.id, v_b.id || '/proof.pdf');
  assert v_b.payment_status = 'proof_uploaded' and v_b.hold_expires_at is null, 'proof keeps the slot';

  v_b := public.cancel_booking(v_b.id);
  assert v_b.status = 'cancelled', 'customer can cancel inside the window';
end $$;
reset role;

-- ---------------------------------------------------------------- outlet workflow
select set_config('request.jwt.claim.sub', :'owner', false);
set role authenticated;
do $$
declare v_b public.bookings;
begin
  v_b := public.update_booking_status((select id from b_booking), 'in_progress');
  v_b := public.update_booking_status(v_b.id, 'completed');
  assert v_b.status = 'completed', 'owner completes a wash';
  v_b := public.mark_booking_paid(v_b.id);
  assert v_b.payment_status = 'paid', 'owner marks pay-at-outlet booking paid';
  begin
    perform public.update_booking_status(v_b.id, 'confirmed');
    raise exception 'completed booking cannot go back to confirmed';
  exception when invalid_parameter_value then null;
  end;
end $$;
reset role;

-- Customer B reviews the completed wash; it shows in nearby_outlets.
select set_config('request.jwt.claim.sub', :'cust_b', false);
set role authenticated;
insert into public.reviews (booking_id, customer_id, outlet_id, rating, comment)
select id, auth.uid(), outlet_id, 5, 'Spotless' from b_booking;
do $$
declare v record;
begin
  select * into v from public.nearby_outlets(-26.15, 28.04, 15);
  assert v.name = 'AquaShine' and v.rating = 5 and v.review_count = 1 and v.from_price_cents = 12000,
    'nearby_outlets returns rating and from-price';
  assert v.distance_km < 1, 'distance is computed';
end $$;
reset role;

-- ---------------------------------------------------------------- expired holds
update public.bookings set hold_expires_at = now() - interval '1 minute' where id = (select id from a_booking);
do $$ begin
  assert public.release_expired_holds() = 1, 'unpaid card bookings past their hold are released';
  assert (select status from public.bookings where id = (select id from a_booking)) = 'cancelled', 'hold released';
end $$;

-- ---------------------------------------------------------------- support chat
select set_config('request.jwt.claim.sub', :'cust_a', false);
set role authenticated;
insert into public.support_conversations (user_id) values (auth.uid());
do $$ begin
  begin
    insert into public.support_messages (conversation_id, sender, body)
    select id, 'bot', 'fake bot reply' from public.support_conversations;
    raise exception 'users cannot write bot messages';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

select set_config('request.jwt.claim.sub', :'admin', false);
set role authenticated;
insert into public.support_messages (conversation_id, sender, sender_id, body)
select id, 'agent', auth.uid(), 'Hi, this is support' from public.support_conversations;
do $$ begin
  assert (select status from public.support_conversations) = 'with_human', 'agent reply takes over from bot';
end $$;
reset role;

-- ---------------------------------------------------------------- saved cards
insert into public.payment_cards (user_id, card_signature, brand, last4, is_default)
values (:'cust_a', 'SIG_1', 'visa', '4821', true), (:'cust_a', 'SIG_2', 'mastercard', '1190', false);
insert into public.payment_card_secrets (card_id, authorization_code)
select id, 'AUTH_' || last4 from public.payment_cards;

select set_config('request.jwt.claim.sub', :'cust_a', false);
set role authenticated;
update public.payment_cards set is_default = true where last4 = '1190';
do $$ begin
  assert (select last4 from public.payment_cards where is_default) = '1190', 'only one default card';
  begin
    perform 1 from public.payment_card_secrets;
    raise exception 'card secrets must not be readable by users';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', :'cust_b', false);
set role authenticated;
do $$ begin
  assert (select count(*) from public.payment_cards) = 0, 'users only see their own cards';
end $$;
reset role;

\echo ALL TESTS PASSED
