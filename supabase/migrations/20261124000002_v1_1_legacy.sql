-- =============================================================================
-- DET Hub — v1.1: Legacy Hall of Fame (Top 10 graduates per cohort)
--
-- Score (max 16.5), same formula as src/lib/legacy/score.ts — keep them in sync:
--   GPA                         : gpa itself (5.00–10.00)                  ≤ 10
--   Projects & Open Source      : min(3, 0.5·log2(1+stars) + 0.5·merged_prs) ≤ 3
--   Research lab                : 1.5 if verified                          ≤ 1.5
--   Teams & awards              : min(2, team_role + award)                ≤ 2
--
-- Only moderator-VERIFIED claims count. Stars / PRs are snapshotted at review
-- time, so later activity does not reshuffle a closed cohort.
-- Privacy: GPA and score never leave this table; the public view shows rank only.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Merged PRs to the DET Hub repo (filled by .github/workflows/record-contribution.yml
-- with the service role key). Also powers "Contributor" badges.
-- -----------------------------------------------------------------------------
create table public.app_contributions (
  pr_number        integer primary key,
  github_username  extensions.citext not null,
  user_id          uuid references public.profiles (id) on delete set null,
  pr_title         text not null,
  pr_url           text not null check (pr_url ~* '^https://github\.com/'),
  merged_at        timestamptz not null
);
create index app_contributions_github_idx on public.app_contributions (github_username);
create index app_contributions_user_idx   on public.app_contributions (user_id);

-- Link contributions to a profile by GitHub username, whichever arrives first.
create or replace function public.link_contribution_to_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is null then
    select p.id into new.user_id
      from public.profiles p
     where p.github_username = new.github_username;
  end if;
  return new;
end;
$$;

create trigger app_contributions_link_profile
  before insert on public.app_contributions
  for each row execute function public.link_contribution_to_profile();

-- -----------------------------------------------------------------------------
-- Scoring (pure function, used by the trigger and by tests)
-- -----------------------------------------------------------------------------
create or replace function public.legacy_score(
  gpa             numeric,
  total_stars     integer,
  merged_prs      integer,
  lab_verified    boolean,
  team_verified   boolean,
  award_verified  boolean
)
returns numeric
language sql
immutable
parallel safe
set search_path = ''
as $$
  select round(
      least(greatest(coalesce(gpa, 0), 0), 10)
    + least(3, 0.5 * log(2, 1 + greatest(coalesce(total_stars, 0), 0)::numeric)
                + 0.5 * greatest(coalesce(merged_prs, 0), 0))
    + case when lab_verified then 1.5 else 0 end
    + least(2, (case when team_verified  then 1 else 0 end)
             + (case when award_verified then 1 else 0 end)),
    3);
$$;

-- -----------------------------------------------------------------------------
-- Applications
-- -----------------------------------------------------------------------------
create table public.legacy_applications (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null unique references public.profiles (id) on delete cascade,
  cohort_year           smallint not null check (cohort_year between 2000 and 2100),
  gpa                   numeric(4,2) not null check (gpa between 5 and 10),
  transcript_path       text not null,          -- storage: legacy-evidence/<uid>/...
  lab_organization_id   uuid references public.organizations (id) on delete set null,
  lab_description       text check (char_length(lab_description) <= 500),
  lab_evidence_path     text,
  team_organization_id  uuid references public.organizations (id) on delete set null,
  team_role             text check (char_length(team_role) <= 120),
  team_evidence_path    text,
  award_title           text check (char_length(award_title) <= 200),
  award_evidence_path   text,
  featured_project_ids  uuid[] not null default '{}'
                          check (cardinality(featured_project_ids) <= 3),
  open_to_mentoring     boolean not null default false,
  consent_public        boolean not null check (consent_public), -- explicit opt-in
  -- set by moderators only
  status                public.review_status not null default 'pending',
  gpa_verified          boolean not null default false,
  lab_verified          boolean not null default false,
  team_verified         boolean not null default false,
  award_verified        boolean not null default false,
  stars_snapshot        integer not null default 0,
  merged_prs_snapshot   integer not null default 0,
  score                 numeric(6,3) not null default 0,
  reviewed_by           uuid references public.profiles (id) on delete set null,
  reviewed_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index legacy_applications_cohort_rank_idx
  on public.legacy_applications (cohort_year, score desc)
  where status = 'approved';

create trigger legacy_applications_set_updated_at
  before update on public.legacy_applications
  for each row execute function public.set_updated_at();

-- Score is always derived, never trusted from the client.
create or replace function public.legacy_applications_compute_score()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.score := public.legacy_score(
    case when new.gpa_verified then new.gpa else 0 end,
    new.stars_snapshot,
    new.merged_prs_snapshot,
    new.lab_verified,
    new.team_verified,
    new.award_verified
  );
  return new;
end;
$$;

create trigger legacy_applications_score
  before insert or update on public.legacy_applications
  for each row execute function public.legacy_applications_compute_score();

-- Applicants who edit their application go back to the queue.
create or replace function public.legacy_applications_reset_on_edit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.has_role('moderator') then
    new.status := 'pending';
    new.gpa_verified := false;
    new.lab_verified := false;
    new.team_verified := false;
    new.award_verified := false;
    new.reviewed_by := null;
    new.reviewed_at := null;
  end if;
  return new;
end;
$$;

create trigger legacy_applications_reset
  before update on public.legacy_applications
  for each row execute function public.legacy_applications_reset_on_edit();

-- Moderator review: verifies claims and snapshots stars / merged PRs.
create or replace function public.review_legacy_application(
  application_id uuid,
  approve        boolean,
  gpa_ok         boolean,
  lab_ok         boolean,
  team_ok        boolean,
  award_ok       boolean
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  applicant uuid;
  stars     integer;
  prs       integer;
  result    numeric;
begin
  if not public.has_role('moderator') then
    raise exception 'only moderators can review legacy applications' using errcode = '42501';
  end if;

  select user_id into applicant from public.legacy_applications where id = application_id;
  if applicant is null then
    raise exception 'application not found' using errcode = 'P0002';
  end if;

  select coalesce(sum(p.star_count), 0)::integer into stars
    from public.projects p
    join public.project_members m on m.project_id = p.id
   where m.user_id = applicant;

  select count(*)::integer into prs
    from public.app_contributions c
   where c.user_id = applicant;

  update public.legacy_applications
     set status              = case when approve then 'approved'::public.review_status
                                    else 'rejected'::public.review_status end,
         gpa_verified        = gpa_ok,
         lab_verified        = lab_ok and lab_organization_id is not null,
         team_verified       = team_ok and team_organization_id is not null,
         award_verified      = award_ok and award_title is not null,
         stars_snapshot      = stars,
         merged_prs_snapshot = prs,
         reviewed_by         = auth.uid(),
         reviewed_at         = now()
   where id = application_id
  returning score into result;

  return result;
end;
$$;

-- -----------------------------------------------------------------------------
-- Public Hall of Fame: top 10 per cohort, rank only (no GPA, no score).
-- Runs with the view owner's rights on purpose (security_invoker = false) so
-- anon can read the ranked subset without reading legacy_applications.
-- -----------------------------------------------------------------------------
create or replace view public.legacy_hall_of_fame
with (security_invoker = false)
as
with ranked as (
  select
    a.*,
    rank() over (partition by a.cohort_year order by a.score desc, a.reviewed_at asc) as cohort_rank
  from public.legacy_applications a
  where a.status = 'approved' and a.consent_public
)
select
  r.cohort_year,
  r.cohort_rank,
  pr.id            as user_id,
  pr.username,
  pr.full_name,
  pr.avatar_url,
  pr.linkedin_url,
  r.open_to_mentoring,
  lab.slug         as lab_slug,
  lab.name         as lab_name,
  r.featured_project_ids
from ranked r
join public.profiles pr on pr.id = r.user_id
left join public.organizations lab on lab.id = r.lab_organization_id and r.lab_verified
where r.cohort_rank <= 10;

-- -----------------------------------------------------------------------------
-- Private storage bucket for evidence (transcripts, certificates).
-- Files live under <user_id>/...; delete them after review (see ROADMAP).
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('legacy-evidence', 'legacy-evidence', false)
on conflict (id) do nothing;

create policy "applicants upload own evidence"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'legacy-evidence'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.is_verified_det())
  );

create policy "applicants read own evidence, moderators read all"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'legacy-evidence'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (select public.has_role('moderator'))
    )
  );

create policy "applicants and moderators delete evidence"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'legacy-evidence'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (select public.has_role('moderator'))
    )
  );

-- =============================================================================
-- Privileges & RLS
-- =============================================================================
grant select on public.app_contributions, public.legacy_hall_of_fame to anon, authenticated;

grant select on public.legacy_applications to authenticated;
grant insert (cohort_year, gpa, transcript_path, lab_organization_id, lab_description,
              lab_evidence_path, team_organization_id, team_role, team_evidence_path,
              award_title, award_evidence_path, featured_project_ids,
              open_to_mentoring, consent_public)
  on public.legacy_applications to authenticated;
grant update (cohort_year, gpa, transcript_path, lab_organization_id, lab_description,
              lab_evidence_path, team_organization_id, team_role, team_evidence_path,
              award_title, award_evidence_path, featured_project_ids,
              open_to_mentoring, consent_public)
  on public.legacy_applications to authenticated;
grant delete on public.legacy_applications to authenticated;

grant execute on function public.legacy_score(numeric, integer, integer, boolean, boolean, boolean)
  to anon, authenticated;
grant execute on function public.review_legacy_application(uuid, boolean, boolean, boolean, boolean, boolean)
  to authenticated;

alter table public.legacy_applications alter column user_id set default auth.uid();

alter table public.app_contributions   enable row level security;
alter table public.legacy_applications enable row level security;

create policy "contributions are public"
  on public.app_contributions for select to anon, authenticated using (true);
-- inserts: service role only (GitHub Action)

create policy "applicants and moderators read applications"
  on public.legacy_applications for select
  to authenticated
  using (user_id = (select auth.uid()) or (select public.has_role('moderator')));

create policy "verified members apply once"
  on public.legacy_applications for insert
  to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_verified_det()));

create policy "applicants edit own application"
  on public.legacy_applications for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "applicants withdraw own application"
  on public.legacy_applications for delete
  to authenticated
  using (user_id = (select auth.uid()));
