-- File storage: outlet photos (public) and proof-of-payment uploads (private).
-- Upload paths: outlet-photos/<outlet_id>/<file>, payment-proofs/<booking_id>/<file>

insert into storage.buckets (id, name, public)
values ('outlet-photos', 'outlet-photos', true), ('payment-proofs', 'payment-proofs', false)
on conflict (id) do nothing;

create policy "Owners upload outlet photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'outlet-photos' and public.is_outlet_owner(((storage.foldername(name))[1])::uuid));

create policy "Owners delete outlet photos" on storage.objects for delete to authenticated
  using (bucket_id = 'outlet-photos' and public.is_outlet_owner(((storage.foldername(name))[1])::uuid));

create policy "Customers upload proof of payment" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'payment-proofs'
    and exists (select 1 from public.bookings b
                where b.id = ((storage.foldername(name))[1])::uuid and b.customer_id = auth.uid())
  );

create policy "Customer and outlet read proof of payment" on storage.objects for select to authenticated
  using (
    bucket_id = 'payment-proofs'
    and exists (select 1 from public.bookings b
                where b.id = ((storage.foldername(name))[1])::uuid
                  and (b.customer_id = auth.uid() or public.is_outlet_owner(b.outlet_id)))
  );
