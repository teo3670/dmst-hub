-- =============================================================================
-- Harden EXECUTE grants on functions.
--
-- Found by the Supabase security advisor on the real project: functions created
-- in 20261124000002 received EXECUTE for PUBLIC (and so for anon) even though
-- 20261124000001 revoked the default privileges. Lesson (now in CONTRIBUTING):
-- every migration that creates a function must REVOKE ... FROM public, anon,
-- authenticated and then GRANT exactly what is needed.
--
-- Trigger functions need no EXECUTE grant at all: Postgres does not check it
-- when a trigger fires.
-- =============================================================================

-- Trigger functions: nobody calls these directly.
revoke all on function public.link_contribution_to_profile()      from public, anon, authenticated;
revoke all on function public.link_existing_contributions()       from public, anon, authenticated;
revoke all on function public.legacy_applications_compute_score() from public, anon, authenticated;
revoke all on function public.legacy_applications_reset_on_edit() from public, anon, authenticated;

-- Pure scoring function: used by the score trigger (runs as the caller).
revoke all on function public.legacy_score(numeric, integer, integer, boolean, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.legacy_score(numeric, integer, integer, boolean, boolean, boolean)
  to authenticated;

-- Moderator RPC: signed-in only (it re-checks the moderator role itself).
revoke all on function public.review_legacy_application(uuid, boolean, boolean, boolean, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.review_legacy_application(uuid, boolean, boolean, boolean, boolean, boolean)
  to authenticated;

-- Visitors never need to know whether "they" are verified.
revoke execute on function public.is_verified_det() from anon;
