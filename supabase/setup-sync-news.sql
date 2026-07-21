-- ============================================================
-- Setup for the sync-news edge function.
-- Run once in the Supabase SQL editor, AFTER deploying the
-- function (supabase functions deploy sync-news).
-- ============================================================

-- 1) Dedupe key the upsert relies on (onConflict: 'url').
--    If existing rows have NULL/duplicate urls, clean them first.
alter table public.news_stories
  add constraint news_stories_url_key unique (url);

-- 2) Extensions used to call the function on a schedule.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 3) Store the project URL + service-role key in Vault so they are
--    not written in plaintext into the cron job definition.
--    (Re-run with update if the values change.)
select vault.create_secret('https://YOUR-PROJECT-ref.supabase.co', 'project_url');
select vault.create_secret('YOUR-SERVICE-ROLE-KEY',                'service_role_key');

-- 4) Schedule the function hourly (top of every hour).
--    The service-role key is a valid project JWT, so the default
--    verify_jwt on the function accepts it.
select cron.schedule(
  'sync-news-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/sync-news',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Useful management queries:
--   select * from cron.job;                                  -- view schedules
--   select * from cron.job_run_details order by start_time desc limit 20;  -- run history
--   select cron.unschedule('sync-news-hourly');              -- remove schedule
