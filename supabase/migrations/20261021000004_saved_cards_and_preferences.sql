-- Saved cards (Paystack "authorizations") and per-user app preferences.

alter table public.profiles
  add column preferences jsonb not null default '{
    "booking_reminders": true,
    "washer_updates": true,
    "promotions": false,
    "default_mode": "walk_in",
    "search_radius_km": 10,
    "share_live_location": true
  }'::jsonb;

-- What the customer sees about a saved card. The reusable Paystack code lives
-- in payment_card_secrets, which only the server (service role) can read.
create table public.payment_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null default 'paystack',
  card_signature text not null,
  brand text,
  last4 text not null,
  exp_month text,
  exp_year text,
  bank text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, card_signature)
);

create table public.payment_card_secrets (
  card_id uuid primary key references public.payment_cards (id) on delete cascade,
  authorization_code text not null
);

alter table public.payment_cards enable row level security;
alter table public.payment_card_secrets enable row level security;
revoke all on public.payment_card_secrets from anon, authenticated;

create policy "Users see own cards" on public.payment_cards for select using (user_id = auth.uid());
create policy "Users remove own cards" on public.payment_cards for delete using (user_id = auth.uid());
create policy "Users choose default card" on public.payment_cards for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Making one card the default clears the others.
create function public.single_default_card()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_default then
    update payment_cards set is_default = false where user_id = new.user_id and id <> new.id and is_default;
  end if;
  return new;
end;
$$;

create trigger payment_cards_single_default
  after insert or update of is_default on public.payment_cards
  for each row execute function public.single_default_card();
