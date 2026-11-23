import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readFileSync } from 'node:fs';

import { fileURLToPath } from 'node:url';
const repo = process.argv[2] ?? fileURLToPath(new URL('../..', import.meta.url));
const db = new PGlite({ extensions: { citext, pg_trgm } });

// --- minimal Supabase stubs -------------------------------------------------
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create schema storage; create schema extensions;
  grant usage on schema auth, storage, extensions, public to anon, authenticated, service_role;
  create table auth.users (id uuid primary key default gen_random_uuid(), raw_user_meta_data jsonb);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant execute on function auth.uid() to anon, authenticated;
  create table storage.buckets (id text primary key, name text, public boolean);
  create table storage.objects (bucket_id text, name text, owner uuid);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
  grant execute on function storage.foldername(text) to authenticated;
`);

for (const f of ['20261124000001_mvp_core.sql', '20261124000002_v1_1_legacy.sql']) {
  try { await db.exec(readFileSync(`${repo}/supabase/migrations/${f}`, "utf8")); } catch (e) { console.log("MIGRATION ERROR", f, e.message, e.where ?? ""); process.exit(1); }
  console.log('applied', f);
}

let failures = 0;
const as = async (who, sql, params = []) => {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${who.id ?? ''}', false);`);
  await db.exec(`set role ${who.role}`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
};
const expectOk = async (name, fn, check) => {
  try { const r = await fn(); if (check && !check(r)) throw new Error('check failed: ' + JSON.stringify(r.rows)); console.log('  ok  ', name); }
  catch (e) { failures++; console.log('  FAIL', name, '→', e.message); }
};
const expectErr = async (name, fn, re) => {
  try { await fn(); failures++; console.log('  FAIL', name, '→ expected error'); }
  catch (e) { if (re && !re.test(e.message)) { failures++; console.log('  FAIL', name, '→ wrong error:', e.message); } else console.log('  ok  ', name, `(${e.message})`); }
};

let ghid = 1000;
const mk = async (login) => (await db.query(
  `insert into auth.users (raw_user_meta_data) values ($1) returning id`,
  [{ user_name: login, provider_id: String(++ghid), full_name: login.toUpperCase(), avatar_url: 'https://x/a.png' }])).rows[0].id;

const A = { id: await mk('alice'), role: 'authenticated' };
const B = { id: await mk('bob'), role: 'authenticated' };
const C = { id: await mk('clubby'), role: 'authenticated' };
const M = { id: await mk('mod'), role: 'authenticated' };
const dup = await mk('Alice'); // case-insensitive clash
const anon = { role: 'anon' };

console.log('\nprofiles');
await expectOk('profile auto-created + clash suffixed', () => db.query(`select username from public.profiles where id=$1`, [dup]), r => /^Alice-/.test(r.rows[0].username));
await expectErr('user cannot self-verify', () => as(A, `update public.profiles set is_verified_det = true where id = auth.uid()`), /permission denied/);
await expectErr('user cannot self-promote', () => as(A, `update public.profiles set role = 'moderator' where id = auth.uid()`), /permission denied/);
await expectOk('user edits own bio', () => as(A, `update public.profiles set bio='hi' where id = auth.uid() returning bio`), r => r.rows.length === 1);
await expectOk("user cannot edit someone else's bio (0 rows)", () => as(A, `update public.profiles set bio='x' where id = $1 returning id`, [B.id]), r => r.rows.length === 0);
await expectErr('anon cannot read det_verifications', () => as(anon, `select * from public.det_verifications`), /permission denied/);

console.log('\nprojects & stars');
await expectErr('unverified cannot create project', () => as(A, `insert into public.projects (slug,title,tagline,study_year) values ('p1','Proj One','A neat tagline here','year_2')`), /row-level security/);
await db.query(`update public.profiles set is_verified_det = true where id = any($1)`, [[A.id, B.id, C.id, M.id]]);
await db.query(`update public.profiles set role='moderator' where id=$1`, [M.id]);
await db.query(`update public.profiles set role='club_admin' where id=$1`, [C.id]);
let P;
await expectOk('verified creates project (owner defaulted, member added)', async () => {
  const r = await as(A, `insert into public.projects (slug,title,tagline,study_year,tech_stack) values ('p1','Proj One','A neat tagline here','year_2','{nextjs,supabase}') returning id, owner_id`);
  P = r.rows[0].id; return r;
}, r => r.rows[0].owner_id === A.id);
await expectOk('owner is member', () => db.query(`select 1 from public.project_members where project_id=$1 and user_id=$2`, [P, A.id]), r => r.rows.length === 1);
await expectErr('owner cannot set star_count', () => as(A, `update public.projects set star_count = 999 where id=$1`, [P]), /permission denied/);
await expectErr('owner cannot self-feature', () => as(A, `update public.projects set is_featured = true where id=$1`, [P]), /permission denied/);
await expectErr('cannot star own project', () => as(A, `insert into public.project_stars (project_id,user_id) values ($1, auth.uid())`, [P]), /row-level security/);
await expectOk('other verified user stars', () => as(B, `insert into public.project_stars (project_id,user_id) values ($1, auth.uid())`, [P]));
await expectErr('double star rejected', () => as(B, `insert into public.project_stars (project_id,user_id) values ($1, auth.uid())`, [P]), /duplicate key/);
await expectOk('star_count synced', () => db.query(`select star_count from public.projects where id=$1`, [P]), r => r.rows[0].star_count === 1);
await expectOk('anon reads ranked view with trending score', () => as(anon, `select title, star_count, trending_score from public.projects_ranked order by trending_score desc`), r => r.rows[0].trending_score > 0);
await expectOk('full-text search', () => as(anon, `select title from public.projects where search @@ plainto_tsquery('simple','supabase')`), r => r.rows.length === 1);
await expectErr('student cannot feature', () => as(A, `select public.set_project_featured($1, true)`, [P]), /only moderators/);
await expectOk('moderator features', () => as(M, `select public.set_project_featured($1, true)`, [P]));
await expectOk('unstar decrements', () => as(B, `delete from public.project_stars where project_id=$1 and user_id=auth.uid() returning 1`, [P]), r => r.rows.length === 1);
await expectOk('star_count back to 0', () => db.query(`select star_count from public.projects where id=$1`, [P]), r => r.rows[0].star_count === 0);

console.log('\ntrending_score');
await expectOk('0h, 10 stars = 10/2^1.8', () => db.query(`select public.trending_score(10, now(), 1.8, now()) s`), r => Math.abs(r.rows[0].s - 10 / 2 ** 1.8) < 1e-9);
await expectOk('newer beats older with same stars', () => db.query(`select public.trending_score(10, now() - interval '1 hour') > public.trending_score(10, now() - interval '48 hours') ok`), r => r.rows[0].ok);

console.log('\nopportunities');
const org = (await db.query(`insert into public.organizations (slug,name,kind) values ('eltrun','ELTRUN','research_lab') returning id`)).rows[0].id;
await db.query(`insert into public.organization_admins values ($1,$2)`, [org, C.id]);
let O;
await expectOk('student submission goes to pending', async () => {
  const r = await as(B, `insert into public.opportunities (title,type,end_date) values ('Intro to RAG','seminar', now() + interval '7 days') returning id, status`);
  O = r.rows[0].id; return r;
}, r => r.rows[0].status === 'pending');
await expectErr('student cannot force approved status', () => as(B, `insert into public.opportunities (title,type,end_date,status) values ('Hack me','other', now() + interval '1 day','approved')`), /permission denied/);
await expectOk('anon does not see pending', () => as(anon, `select id from public.opportunities`), r => r.rows.length === 0);
await expectOk('submitter sees own pending', () => as(B, `select id from public.opportunities`), r => r.rows.length === 1);
await expectErr('student cannot review', () => as(B, `select public.review_opportunity($1, true)`, [O]), /only moderators/);
await expectOk('moderator approves in one call', () => as(M, `select public.review_opportunity($1, true)`, [O]));
await expectOk('anon sees approved', () => as(anon, `select id from public.opportunities`), r => r.rows.length === 1);
await expectOk('club admin of org publishes directly', () => as(C, `insert into public.opportunities (organization_id,title,type,end_date) values ($1,'Lab open day','talk', now() + interval '3 days') returning status`, [org]), r => r.rows[0].status === 'approved');
await expectOk('club admin of other org → pending', async () => {
  const other = (await db.query(`insert into public.organizations (slug,name,kind) values ('ieee','IEEE','student_team') returning id`)).rows[0].id;
  return as(C, `insert into public.opportunities (organization_id,title,type,end_date) values ($1,'Not mine','talk', now() + interval '3 days') returning status`, [other]);
}, r => r.rows[0].status === 'pending');
await db.query(`insert into public.opportunities (submitted_by,title,type,end_date,status) values ($1,'Old event','talk', now() - interval '1 day','approved')`, [M.id]);
await expectOk('expired events auto-hidden for anon', () => as(anon, `select title from public.opportunities order by title`), r => r.rows.map(x => x.title).join('|') === 'Intro to RAG|Lab open day');
await expectErr('bad dates rejected', () => as(B, `insert into public.opportunities (title,type,starts_at,end_date) values ('Backwards','talk', now(), now() - interval '1 day')`), /opportunities_dates_chk/);

console.log('\nlegacy');
await db.query(`insert into public.app_contributions (pr_number,github_id,github_username,pr_title,pr_url,merged_at) values (1,1001,'alice','Fix typo','https://github.com/x/y/pull/1',now()),(2,1001,'alice-renamed','Add filter','https://github.com/x/y/pull/2',now()),(3,2000,'late','Docs','https://github.com/x/y/pull/3',now())`);
await expectOk('contribution back-filled on later sign-up', async () => {
  const late = (await db.query(`insert into auth.users (raw_user_meta_data) values ($1) returning id`, [{ user_name: 'late', provider_id: '2000' }])).rows[0].id;
  return db.query(`select user_id from public.app_contributions where pr_number=3`).then(r => ({ rows: [{ ok: r.rows[0].user_id === late }] }));
}, r => r.rows[0].ok);
await expectOk('contribution linked to profile', () => db.query(`select count(*)::int n from public.app_contributions where user_id=$1`, [A.id]), r => r.rows[0].n === 2);
await db.query(`insert into public.project_stars values ($1,$2,now()),($1,$3,now()),($1,$4,now())`, [P, B.id, C.id, M.id]);
let L;
await expectOk('verified graduate applies (score 0 until verified)', async () => {
  const r = await as(A, `insert into public.legacy_applications (cohort_year,gpa,transcript_path,lab_organization_id,team_organization_id,team_role,award_title,consent_public)
    values (2026, 8.73, 'x/transcript.pdf', $1, $1, 'Lead', 'Hackathon winner', true) returning id, score`, [org]);
  L = r.rows[0].id; return r;
}, r => Number(r.rows[0].score) === 0);
await expectErr('applicant cannot set score', () => as(A, `update public.legacy_applications set score = 16.5 where id=$1`, [L]), /permission denied/);
await expectErr('anon cannot read applications (GPA private)', () => as(anon, `select gpa from public.legacy_applications`), /permission denied/);
// expected: 8.73 + min(3, 0.5*log2(4) + 0.5*2 = 2) + 1.5 + 2 = 14.23
await expectOk('moderator review computes score = 14.23', () => as(M, `select public.review_legacy_application($1, true, true, true, true, true) s`, [L]), r => Number(r.rows[0].s) === 14.23);
await expectOk('legacy_score max is 16.5', () => db.query(`select public.legacy_score(10, 100000, 100, true, true, true) s`), r => Number(r.rows[0].s) === 16.5);
await expectOk('anon sees hall of fame rank without GPA', () => as(anon, `select * from public.legacy_hall_of_fame`), r => r.rows.length === 1 && r.rows[0].cohort_rank == 1 && !('gpa' in r.rows[0]) && !('score' in r.rows[0]));
await expectOk('applicant edit resets to pending', () => as(A, `update public.legacy_applications set open_to_mentoring = true where id=$1 returning status, score`, [L]), r => r.rows[0].status === 'pending' && Number(r.rows[0].score) === 0);
await expectErr('anon cannot insert contributions', () => as(anon, `insert into public.app_contributions (pr_number,github_id,github_username,pr_title,pr_url,merged_at) values (9,1,'x','x','https://github.com/a',now())`), /permission denied/);
await expectOk('hall of fame empty again', () => as(anon, `select * from public.legacy_hall_of_fame`), r => r.rows.length === 0);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
