-- Release unpaid booking holds every 5 minutes so bays free up for others.
-- (create_booking also releases expired holds for the outlet it books.)
create extension if not exists pg_cron;

select cron.schedule('release-expired-holds', '*/5 * * * *', $$select public.release_expired_holds()$$);
