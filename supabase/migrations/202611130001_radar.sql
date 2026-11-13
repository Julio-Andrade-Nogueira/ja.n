-- Apply once, in order. No existing tables are dropped or recreated.
begin;

create table public.radar_jobs (
  id uuid primary key default gen_random_uuid(),
  canonical_key text not null unique,
  title text not null check (length(title) between 1 and 500),
  company text not null,
  source text not null,
  source_board text not null,
  external_id text not null,
  url text not null check (url ~ '^https://'),
  area text not null default 'Outras',
  level text not null default 'Não informado',
  country text,
  city text,
  location text,
  mode text not null default 'Não informado',
  eligibility text not null default 'A confirmar' check (eligibility in ('Sim','Não','A confirmar')),
  eligibility_evidence text,
  salary_min numeric check (salary_min >= 0),
  salary_max numeric check (salary_max >= 0),
  salary_text text,
  currency text,
  salary_period text,
  hours_per_day numeric check (hours_per_day > 0 and hours_per_day <= 24),
  weekly_hours numeric check (weekly_hours > 0 and weekly_hours <= 168),
  contract text not null default 'Não informado',
  requirements text,
  differentials text,
  description text,
  languages text[] not null default '{}',
  language text not null default 'Não informado',
  posted_at timestamptz,
  deadline_at timestamptz,
  score smallint check (score between 0 and 100),
  score_reason text,
  score_breakdown jsonb not null default '{}',
  gaps text[] not null default '{}',
  scoring_version text not null default 'fumec-v1',
  priority smallint not null default 6 check (priority between 1 and 6),
  status text not null default 'unverified' check (status in ('active','closed','unverified')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz,
  last_checked_at timestamptz,
  closed_at timestamptz,
  updated_at timestamptz not null default now(),
  check (salary_min is null or salary_max is null or salary_min <= salary_max),
  unique (source, source_board, external_id)
);
create index radar_jobs_status_priority on public.radar_jobs(status, priority, score desc nulls last);
create index radar_jobs_updated on public.radar_jobs(updated_at desc, id);
create index radar_jobs_filters on public.radar_jobs(area, level, mode);
create index radar_jobs_search on public.radar_jobs using gin
  (to_tsvector('simple', title || ' ' || company || ' ' || coalesce(description,'')));

create table public.radar_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','success','partial','failed')),
  summary jsonb not null default '{}'
);
create table public.radar_origins (
  source text not null,
  board text not null,
  external_id text not null,
  job_id uuid not null references public.radar_jobs(id),
  url text not null,
  status text not null check (status in ('active','closed','unverified')),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz,
  last_checked_at timestamptz,
  last_detail_checked_at timestamptz,
  missing_since timestamptz,
  missing_count integer not null default 0 check (missing_count >= 0),
  primary key(source, board, external_id)
);
create index radar_origins_job on public.radar_origins(job_id);
create table public.radar_checks (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.radar_runs(id),
  job_id uuid references public.radar_jobs(id),
  source text not null,
  board text not null,
  checked_at timestamptz not null default now(),
  outcome text not null check (outcome in ('seen','missing','closed','error')),
  http_status integer,
  detail text
);
create index radar_checks_job_time on public.radar_checks(job_id, checked_at desc);
create index radar_checks_run on public.radar_checks(run_id);

-- Personal data has no place in radar_jobs or collector payloads.
create table public.radar_user_states (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  job_id uuid not null references public.radar_jobs(id),
  saved boolean not null default false,
  read_at timestamptz,
  clicked_at timestamptz,
  applied_at timestamptz,
  stage text not null default 'Nenhuma' check
    (stage in ('Nenhuma','Interessado','Candidatado','Entrevista','Proposta','Rejeitado','Contratado','Descartado')),
  notes text not null default '' check (length(notes) <= 20000),
  updated_at timestamptz not null default now(),
  primary key(user_id, job_id)
);
create table public.radar_user_events (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  job_id uuid not null references public.radar_jobs(id),
  happened_at timestamptz not null default now(),
  patch jsonb not null check (jsonb_typeof(patch) = 'object')
);
create index radar_user_events_owner on public.radar_user_events(user_id, happened_at desc);

alter table public.radar_jobs enable row level security;
alter table public.radar_runs enable row level security;
alter table public.radar_origins enable row level security;
alter table public.radar_checks enable row level security;
alter table public.radar_user_states enable row level security;
alter table public.radar_user_events enable row level security;

-- Explicit grants also remove Supabase's possible default broad grants.
revoke all on public.radar_jobs, public.radar_runs, public.radar_origins, public.radar_checks,
  public.radar_user_states, public.radar_user_events from anon, authenticated;
grant select on public.radar_jobs to anon, authenticated;
grant select, insert, update on public.radar_user_states to authenticated;
grant select, insert on public.radar_user_events to authenticated;
grant usage on sequence public.radar_user_events_id_seq to authenticated;
grant all on public.radar_jobs, public.radar_runs, public.radar_origins, public.radar_checks,
  public.radar_user_states, public.radar_user_events to service_role;
grant usage, select on sequence public.radar_checks_id_seq, public.radar_user_events_id_seq to service_role;

create policy radar_jobs_public_read on public.radar_jobs for select to anon, authenticated using (true);
create policy radar_states_read on public.radar_user_states for select to authenticated using ((select auth.uid()) = user_id);
create policy radar_states_insert on public.radar_user_states for insert to authenticated with check ((select auth.uid()) = user_id);
create policy radar_states_update on public.radar_user_states for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy radar_events_read on public.radar_user_events for select to authenticated using ((select auth.uid()) = user_id);
create policy radar_events_insert on public.radar_user_events for insert to authenticated with check ((select auth.uid()) = user_id);
-- Internal tables intentionally have no anon/authenticated policies.

-- Atomic, field-level patch. A favorite from another device cannot erase notes.
-- SECURITY INVOKER means the caller's RLS applies to every statement.
create function public.radar_patch_state(p_job_id uuid, p_patch jsonb, p_only_if_absent boolean default false)
returns public.radar_user_states language plpgsql security invoker
set search_path = '' as $$
declare result public.radar_user_states; inserted integer;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb or
    (p_patch - array['saved','read_at','clicked_at','applied_at','stage','notes']) <> '{}'::jsonb
    then raise exception 'Invalid state patch'; end if;
  insert into public.radar_user_states(user_id, job_id)
    values (auth.uid(), p_job_id) on conflict (user_id, job_id) do nothing;
  get diagnostics inserted = row_count;
  if p_only_if_absent and inserted = 0 then
    select * into result from public.radar_user_states where user_id = auth.uid() and job_id = p_job_id;
    return result; -- Concurrent migration cannot overwrite a row created on another device.
  end if;
  update public.radar_user_states set
    saved = case when p_patch ? 'saved' then (p_patch->>'saved')::boolean else saved end,
    read_at = case when p_patch ? 'read_at' then coalesce(read_at, (p_patch->>'read_at')::timestamptz) else read_at end,
    clicked_at = case when p_patch ? 'clicked_at' then coalesce(clicked_at, (p_patch->>'clicked_at')::timestamptz) else clicked_at end,
    applied_at = case when p_patch ? 'applied_at' then coalesce(applied_at, (p_patch->>'applied_at')::timestamptz) else applied_at end,
    stage = case when p_patch ? 'stage' then p_patch->>'stage' else stage end,
    notes = case when p_patch ? 'notes' then p_patch->>'notes' else notes end,
    updated_at = now()
    where user_id = auth.uid() and job_id = p_job_id returning * into result;
  insert into public.radar_user_events(user_id, job_id, patch) values (auth.uid(), p_job_id, p_patch);
  return result;
end $$;
revoke all on function public.radar_patch_state(uuid,jsonb,boolean) from public, anon;
grant execute on function public.radar_patch_state(uuid,jsonb,boolean) to authenticated;
commit;
