-- =============================================================================
-- DET Hub — MVP v1.0 schema
-- Profiles · ΔΕΤ verification (OTP) · Projects · Stars · Organizations · Opportunities
--
-- Principles
--   * Public read: anon can SELECT everything that is meant to be public.
--   * Verified write: only users with profiles.is_verified_det = true can create
--     content or star. Privileged columns (role, is_verified_det, is_featured,
--     star_count, status) are protected with column-level GRANTs + triggers,
--     because RLS alone cannot restrict which columns a row owner changes.
--   * Anything private (aueb email, OTP codes) lives in tables without any
--     anon/authenticated policy, reachable only through the service role.
-- =============================================================================

create extension if not exists extensions.citext  with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.user_role as enum ('student', 'club_admin', 'moderator');

create type public.career_status as enum (
  'not_looking',
  'open_to_internship',
  'open_to_junior_roles'
);

create type public.study_year as enum (
  'year_1',
  'year_2',
  'year_3',
  'year_4_plus',
  'multi_year'
);

create type public.organization_kind as enum ('research_lab', 'student_team');

create type public.opportunity_type as enum (
  'seminar',
  'workshop',
  'hackathon',
  'competition',
  'talk',
  'recruitment',
  'other'
);

create type public.review_status as enum ('pending', 'approved', 'rejected');

-- -----------------------------------------------------------------------------
-- Shared trigger: updated_at
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Profiles (1:1 with auth.users, created automatically on GitHub sign-in)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  username         extensions.citext not null unique
                     check (username ~ '^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,38})$'),
  full_name        text check (char_length(full_name) <= 120),
  avatar_url       text,
  bio              text check (char_length(bio) <= 500),
  github_username  extensions.citext,
  linkedin_url     text check (linkedin_url ~* '^https://([a-z]{2,3}\.)?linkedin\.com/'),
  website_url      text check (website_url ~* '^https?://'),
  contact_email    extensions.citext check (contact_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  career_status    public.career_status not null default 'not_looking',
  graduation_year  smallint check (graduation_year between 1990 and 2100),
  -- privileged (not user-writable, see GRANTs below)
  role             public.user_role not null default 'student',
  is_verified_det  boolean not null default false,
  verified_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index profiles_career_status_idx on public.profiles (career_status)
  where career_status <> 'not_looking';
create index profiles_graduation_year_idx on public.profiles (graduation_year);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Private: which @aueb.gr address verified which account.
-- UNIQUE(aueb_email) => one institutional email can verify only one account,
-- which is what makes "1 star per verified @aueb.gr account" hold.
create table public.det_verifications (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  aueb_email  extensions.citext not null unique,
  verified_at timestamptz not null default now()
);

-- Private: OTP codes (only a hash is stored). Written/read by the server only.
create table public.email_otps (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  email        extensions.citext not null,
  code_hash    text not null,
  attempts     smallint not null default 0,
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index email_otps_user_idx on public.email_otps (user_id, created_at desc);

-- Create a profile when someone signs in with GitHub for the first time.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  gh_login text := coalesce(
    new.raw_user_meta_data ->> 'user_name',
    new.raw_user_meta_data ->> 'preferred_username',
    'user-' || substr(new.id::text, 1, 8)
  );
begin
  insert into public.profiles (id, username, full_name, avatar_url, github_username)
  values (
    new.id,
    gh_login,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url',
    new.raw_user_meta_data ->> 'user_name'
  )
  on conflict (username) do nothing;
  -- rare: the GitHub login is already taken (e.g. someone renamed on GitHub)
  if not found then
    insert into public.profiles (id, username, full_name, avatar_url, github_username)
    values (
      new.id,
      gh_login || '-' || substr(new.id::text, 1, 4),
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'avatar_url',
      new.raw_user_meta_data ->> 'user_name'
    );
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Authorization helpers (SECURITY DEFINER so RLS policies can call them
-- without recursive RLS on profiles)
-- -----------------------------------------------------------------------------
create or replace function public.is_verified_det()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.is_verified_det from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

create or replace function public.has_role(required public.user_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.is_verified_det
      and (p.role = required or p.role = 'moderator')
  );
$$;

-- -----------------------------------------------------------------------------
-- Organizations: research labs & student teams.
-- Source of truth for descriptions is content/organizations/*.md (edited via PR);
-- this table only holds what the DB needs (FKs, admins). Synced by
-- scripts/sync-organizations.ts on every merge to main.
-- -----------------------------------------------------------------------------
create table public.organizations (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name       text not null,
  kind       public.organization_kind not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.organization_admins (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index organization_admins_user_idx on public.organization_admins (user_id);

create or replace function public.is_org_admin(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_role('moderator')
      or (
        public.has_role('club_admin')
        and exists (
          select 1 from public.organization_admins oa
          where oa.organization_id = org and oa.user_id = auth.uid()
        )
      );
$$;

-- -----------------------------------------------------------------------------
-- Projects
-- -----------------------------------------------------------------------------
-- array_to_string() is only STABLE in general, but it is immutable for text[];
-- generated columns require an IMMUTABLE expression.
create or replace function public.text_array_to_string(arr text[])
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$ select array_to_string(arr, ' ') $$;

create table public.projects (
  id                     uuid primary key default gen_random_uuid(),
  owner_id               uuid not null references public.profiles (id) on delete cascade,
  slug                   text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  title                  text not null check (char_length(title) between 3 and 80),
  tagline                text not null check (char_length(tagline) between 10 and 140),
  description            text check (char_length(description) <= 10000), -- markdown
  repo_url               text check (repo_url ~* '^https://'),
  demo_url               text check (demo_url ~* '^https://'),
  cover_image_url        text,
  tech_stack             text[] not null default '{}'
                           check (cardinality(tech_stack) <= 15),
  study_year             public.study_year not null,
  looking_for_teammates  boolean not null default false,
  -- privileged
  star_count             integer not null default 0 check (star_count >= 0),
  is_featured            boolean not null default false,
  featured_at            timestamptz,
  featured_by            uuid references public.profiles (id) on delete set null,
  launched_at            timestamptz not null default now(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  search                 tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(tagline, '')), 'B') ||
    setweight(to_tsvector('simple', public.text_array_to_string(tech_stack)), 'B') ||
    setweight(to_tsvector('simple', coalesce(description, '')), 'C')
  ) stored
);

create index projects_owner_idx        on public.projects (owner_id);
create index projects_launched_idx     on public.projects (launched_at desc);
create index projects_star_count_idx   on public.projects (star_count desc, launched_at desc);
create index projects_featured_idx     on public.projects (featured_at desc) where is_featured;
create index projects_study_year_idx   on public.projects (study_year);
create index projects_teammates_idx    on public.projects (launched_at desc) where looking_for_teammates;
create index projects_tech_stack_idx   on public.projects using gin (tech_stack);
create index projects_search_idx       on public.projects using gin (search);
create index projects_title_trgm_idx   on public.projects using gin (title extensions.gin_trgm_ops);

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- Team members (the owner is added automatically).
create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role_label text check (char_length(role_label) <= 40), -- e.g. "Frontend", "Design"
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_members_user_idx on public.project_members (user_id);

create or replace function public.add_owner_as_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.project_members (project_id, user_id, role_label)
  values (new.id, new.owner_id, 'Owner')
  on conflict do nothing;
  return new;
end;
$$;

create trigger projects_add_owner_member
  after insert on public.projects
  for each row execute function public.add_owner_as_member();

-- -----------------------------------------------------------------------------
-- Stars: 1 per verified account per project (PK enforces it)
-- -----------------------------------------------------------------------------
create table public.project_stars (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_stars_user_idx on public.project_stars (user_id, created_at desc);

-- Keep projects.star_count in sync (denormalised for fast ranking).
create or replace function public.sync_star_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.projects set star_count = star_count + 1 where id = new.project_id;
  elsif tg_op = 'DELETE' then
    update public.projects set star_count = greatest(star_count - 1, 0) where id = old.project_id;
  end if;
  return null;
end;
$$;

create trigger project_stars_sync_count
  after insert or delete on public.project_stars
  for each row execute function public.sync_star_count();

-- -----------------------------------------------------------------------------
-- Ranking. Trending = HN-style time decay:
--   score = stars / (hours_since_launch + 2) ^ gravity
-- Kept in SQL (not a stored column) because it changes with time; at our scale
-- (hundreds–low thousands of projects) computing it per request is cheap.
-- The same formula lives in src/lib/ranking/trending.ts — keep them in sync.
-- -----------------------------------------------------------------------------
create or replace function public.trending_score(
  stars       integer,
  launched_at timestamptz,
  gravity     double precision default 1.8,
  now_ts      timestamptz default now()
)
returns double precision
language sql
immutable
parallel safe
set search_path = ''
as $$
  select stars::double precision
         / power(greatest(extract(epoch from (now_ts - launched_at)) / 3600.0, 0) + 2, gravity);
$$;

create or replace view public.projects_ranked
with (security_invoker = true)
as
select
  p.*,
  public.trending_score(p.star_count, p.launched_at, 1.8, now()) as trending_score
from public.projects p;

-- -----------------------------------------------------------------------------
-- Opportunities (seminars, hackathons, ...). Auto-expire via end_date.
-- -----------------------------------------------------------------------------
create table public.opportunities (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid references public.organizations (id) on delete set null,
  submitted_by     uuid not null references public.profiles (id) on delete cascade,
  title            text not null check (char_length(title) between 5 and 120),
  description      text check (char_length(description) <= 5000),
  type             public.opportunity_type not null,
  url              text check (url ~* '^https://'),
  location         text check (char_length(location) <= 120),
  is_online        boolean not null default false,
  starts_at        timestamptz,
  end_date         timestamptz not null,
  -- privileged
  status           public.review_status not null default 'pending',
  reviewed_by      uuid references public.profiles (id) on delete set null,
  reviewed_at      timestamptz,
  rejection_reason text check (char_length(rejection_reason) <= 500),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint opportunities_dates_chk check (starts_at is null or starts_at <= end_date)
);

create index opportunities_live_idx
  on public.opportunities (end_date)
  where status = 'approved';
create index opportunities_pending_idx
  on public.opportunities (created_at)
  where status = 'pending';
create index opportunities_org_idx on public.opportunities (organization_id);

create trigger opportunities_set_updated_at
  before update on public.opportunities
  for each row execute function public.set_updated_at();

-- On insert, the server decides the status: club admins of the org (and
-- moderators) publish directly; everyone else goes to the review queue.
create or replace function public.opportunities_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.submitted_by := auth.uid();
  if (new.organization_id is not null and public.is_org_admin(new.organization_id))
     or public.has_role('moderator') then
    new.status := 'approved';
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  else
    new.status := 'pending';
    new.reviewed_by := null;
    new.reviewed_at := null;
  end if;
  new.rejection_reason := null;
  return new;
end;
$$;

create trigger opportunities_set_status
  before insert on public.opportunities
  for each row execute function public.opportunities_before_insert();

-- One-click review for moderators.
create or replace function public.review_opportunity(
  opportunity_id uuid,
  approve boolean,
  reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role('moderator') then
    raise exception 'only moderators can review opportunities' using errcode = '42501';
  end if;
  update public.opportunities
     set status = case when approve then 'approved'::public.review_status
                       else 'rejected'::public.review_status end,
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         rejection_reason = case when approve then null else reason end
   where id = opportunity_id;
end;
$$;

-- Featured / Community Picks.
create or replace function public.set_project_featured(project uuid, featured boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role('moderator') then
    raise exception 'only moderators can feature projects' using errcode = '42501';
  end if;
  update public.projects
     set is_featured = featured,
         featured_at = case when featured then now() else null end,
         featured_by = case when featured then auth.uid() else null end
   where id = project;
end;
$$;

-- =============================================================================
-- Privileges
-- =============================================================================
-- Start from zero for API roles, then grant exactly what is needed.
-- Default privileges are revoked too, so every FUTURE table/function must be
-- granted explicitly in its migration (see CONTRIBUTING.md → "Database").
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated, public;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated, public;

-- Public read
grant select on public.profiles, public.projects, public.projects_ranked,
                public.project_members, public.project_stars,
                public.organizations, public.organization_admins,
                public.opportunities
  to anon, authenticated;

-- Profiles: users edit only their own non-privileged columns.
grant update (username, full_name, avatar_url, bio, github_username, linkedin_url,
              website_url, contact_email, career_status, graduation_year)
  on public.profiles to authenticated;

-- Projects
grant insert (slug, title, tagline, description, repo_url, demo_url, cover_image_url,
              tech_stack, study_year, looking_for_teammates)
  on public.projects to authenticated;
grant update (slug, title, tagline, description, repo_url, demo_url, cover_image_url,
              tech_stack, study_year, looking_for_teammates)
  on public.projects to authenticated;
grant delete on public.projects to authenticated;

grant insert, update (role_label), delete on public.project_members to authenticated;
grant insert, delete on public.project_stars to authenticated;

-- Opportunities (status columns are set by trigger / review function)
grant insert (organization_id, title, description, type, url, location, is_online,
              starts_at, end_date)
  on public.opportunities to authenticated;
grant update (title, description, type, url, location, is_online, starts_at, end_date)
  on public.opportunities to authenticated;
grant delete on public.opportunities to authenticated;

-- Functions callable from the client
grant execute on function public.is_verified_det()                       to anon, authenticated;
grant execute on function public.has_role(public.user_role)              to authenticated;
grant execute on function public.is_org_admin(uuid)                      to authenticated;
grant execute on function public.trending_score(integer, timestamptz, double precision, timestamptz)
  to anon, authenticated;
grant execute on function public.review_opportunity(uuid, boolean, text) to authenticated;
grant execute on function public.set_project_featured(uuid, boolean)     to authenticated;

-- owner_id on insert always = caller
alter table public.projects alter column owner_id set default auth.uid();

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.profiles             enable row level security;
alter table public.det_verifications    enable row level security; -- no policies: service role only
alter table public.email_otps           enable row level security; -- no policies: service role only
alter table public.organizations        enable row level security;
alter table public.organization_admins  enable row level security;
alter table public.projects             enable row level security;
alter table public.project_members      enable row level security;
alter table public.project_stars        enable row level security;
alter table public.opportunities        enable row level security;

-- Profiles ---------------------------------------------------------------------
create policy "profiles are public"
  on public.profiles for select
  to anon, authenticated
  using (true);

create policy "users update own profile"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Organizations ----------------------------------------------------------------
create policy "organizations are public"
  on public.organizations for select to anon, authenticated using (true);

create policy "organization admins are public"
  on public.organization_admins for select to anon, authenticated using (true);

-- Projects ---------------------------------------------------------------------
create policy "projects are public"
  on public.projects for select to anon, authenticated using (true);

create policy "verified members create projects"
  on public.projects for insert
  to authenticated
  with check (owner_id = (select auth.uid()) and (select public.is_verified_det()));

create policy "owners update projects"
  on public.projects for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "owners or moderators delete projects"
  on public.projects for delete
  to authenticated
  using (owner_id = (select auth.uid()) or (select public.has_role('moderator')));

-- Project members ---------------------------------------------------------------
create policy "project members are public"
  on public.project_members for select to anon, authenticated using (true);

create policy "owners manage members"
  on public.project_members for all
  to authenticated
  using (exists (select 1 from public.projects p
                 where p.id = project_id and p.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.projects p
                      where p.id = project_id and p.owner_id = (select auth.uid())));

create policy "members can leave"
  on public.project_members for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- Stars ------------------------------------------------------------------------
create policy "stars are public"
  on public.project_stars for select to anon, authenticated using (true);

create policy "verified members star others' projects"
  on public.project_stars for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and (select public.is_verified_det())
    and not exists (select 1 from public.projects p
                    where p.id = project_id and p.owner_id = (select auth.uid()))
  );

create policy "users remove own star"
  on public.project_stars for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- Opportunities ----------------------------------------------------------------
-- Public sees only approved & not expired. This is the "auto-hide": no cron job.
create policy "live opportunities are public"
  on public.opportunities for select
  to anon, authenticated
  using (status = 'approved' and end_date >= now());

create policy "submitters see own submissions"
  on public.opportunities for select
  to authenticated
  using (submitted_by = (select auth.uid()));

create policy "moderators see everything"
  on public.opportunities for select
  to authenticated
  using ((select public.has_role('moderator')));

create policy "org admins see their org's opportunities"
  on public.opportunities for select
  to authenticated
  using (organization_id is not null and (select public.is_org_admin(organization_id)));

create policy "verified members submit opportunities"
  on public.opportunities for insert
  to authenticated
  with check ((select public.is_verified_det()));

create policy "submitters edit pending, admins edit their org"
  on public.opportunities for update
  to authenticated
  using (
    (submitted_by = (select auth.uid()) and status = 'pending')
    or (organization_id is not null and (select public.is_org_admin(organization_id)))
  )
  with check (
    (submitted_by = (select auth.uid()) and status = 'pending')
    or (organization_id is not null and (select public.is_org_admin(organization_id)))
  );

create policy "submitters, org admins and moderators delete"
  on public.opportunities for delete
  to authenticated
  using (
    submitted_by = (select auth.uid())
    or (organization_id is not null and (select public.is_org_admin(organization_id)))
  );
