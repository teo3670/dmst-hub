# Roadmap

## MVP v1.0: βήμα προς βήμα

Κάθε βήμα τελειώνει με κάτι που δουλεύει και μπορεί να γίνει merge μόνο του.
Τα ✅ είναι ήδη στο repo.

### Φάση 0: Θεμέλια
- [x] Next.js 16 + TypeScript + Tailwind scaffold
- [x] Schema & RLS (`supabase/migrations/…_mvp_core.sql`) με tests (`npm run test:db`)
- [x] Trending / Legacy logic με unit tests (`npm test`)
- [ ] Δημιουργία GitHub Organization (π.χ. `det-hub`) και μεταφορά repo εκεί
- [ ] `LICENSE`, `CODE_OF_CONDUCT.md`, `GOVERNANCE.md`, issue/PR templates
- [ ] `.github/workflows/ci.yml`: `lint`, `typecheck`, `test`, `test:db`

### Φάση 1: Supabase & Auth
1. Δημιουργία Supabase project (free) και `npx supabase init`, `npx supabase link`.
2. `npx supabase db push` για να εφαρμοστούν τα migrations.
3. GitHub OAuth App (callback: `https://<project>.supabase.co/auth/v1/callback`) → Supabase → Auth → Providers → GitHub.
4. `npm i @supabase/supabase-js @supabase/ssr zod`
5. `src/lib/supabase/{server,client,admin}.ts` + `src/proxy.ts` (ανανέωση session).
6. `src/app/auth/callback/route.ts` + κουμπί «Σύνδεση με GitHub» στο Header.
7. `npx supabase gen types typescript` → `src/types/database.ts`.
   **Έτοιμο όταν:** κάνεις login και εμφανίζεται γραμμή στο `profiles`.

### Φάση 2: Επαλήθευση @aueb.gr
1. Λογαριασμός Resend + επαληθευμένο domain αποστολής (ή το sandbox για αρχή).
2. `src/lib/verification/otp.ts`: `generateOtp`, `hashOtp` (HMAC με `OTP_SECRET`), σταθερές ορίων.
3. `src/actions/verification.ts`: `sendOtp`, `confirmOtp` (με service role client).
4. Σελίδα `/settings/verify` + `VerifiedBadge`.
5. Unit tests για hashing, λήξη και όριο προσπαθειών.
   **Έτοιμο όταν:** βάζεις κωδικό και το προφίλ δείχνει `Verified ΔΕΤ`.

### Φάση 3: Προφίλ
1. `/u/[username]`: avatar, bio, links, career status, projects του χρήστη.
2. `/settings/profile`: φόρμα με zod validation και Server Action.
3. `generateMetadata` για όμορφα previews όταν κάποιος μοιράζεται το link στο LinkedIn.

### Φάση 4: Projects & Stars (η καρδιά του MVP)
1. `/new`: φόρμα project (title, tagline, description, tech stack, **έτος σπουδών**, teammates flag).
2. `/projects/[slug]`: σελίδα project με markdown description και μέλη ομάδας.
3. `StarButton` (Server Action + `useOptimistic`). Απενεργοποιημένο για μη-verified, με tooltip «Επαλήθευσε το @aueb.gr σου».
4. Αρχική `/`: `projects_ranked order by trending_score desc`.
5. `/projects/top` (`star_count desc`) και `/projects/featured` (`is_featured`).
6. Φίλτρα μέσω URL search params: `?year=year_2&tech=react&teammates=1&q=...`
   (το `search` tsvector και το GIN index στο `tech_stack` υπάρχουν ήδη).
   **Έτοιμο όταν:** δύο verified λογαριασμοί κάνουν star ο ένας στον άλλο και η σειρά αλλάζει.

### Φάση 5: Οδηγός εργαστηρίων & ομάδων
1. `content/organizations/_template.md` (frontmatter: name, kind, website, contact, tags).
2. `src/lib/content/organizations.ts`: ανάγνωση με `gray-matter`, στατικό render.
3. `/labs`, `/teams`, `/labs/[slug]`, `/teams/[slug]` (με `generateStaticParams`).
4. `scripts/sync-organizations.ts` + workflow: upsert στον πίνακα `organizations` σε κάθε merge.
5. Πρώτα issues `content` + `good first issue`: «Πρόσθεσε το εργαστήριο X».

### Φάση 6: Board δράσεων + RBAC
1. `/opportunities`: μόνο εγκεκριμένες και ενεργές (το RLS τις φιλτράρει ήδη), ομαδοποίηση ανά εβδομάδα.
2. `/opportunities/submit`: φόρμα. Ο trigger αποφασίζει pending ή approved.
3. `/mod/opportunities`: ουρά με κουμπιά ✅/❌ → `rpc('review_opportunity')`.
4. `/mod/featured`: toggle → `rpc('set_project_featured')`.
5. Ορισμός πρώτων `club_admin`: χειροκίνητα με SQL από maintainer (insert στο `organization_admins`).

### Φάση 7: Launch
- [ ] `seed.sql` με demo δεδομένα για contributors
- [ ] Lighthouse ≥ 90, έλεγχος mobile, `opengraph-image`
- [ ] Σελίδα «Σχετικά» και «Πώς να συνεισφέρω»
- [ ] Soft launch: 10–20 φοιτητές από το έτος σου, 10+ projects πριν το δημόσιο launch
- [ ] 10 `good first issues` έτοιμα πριν την ανακοίνωση

## v1.1
- **Legacy Hall of Fame**: το migration `…_v1_1_legacy.sql` είναι έτοιμο και ελεγμένο.
  Μένουν: φόρμα αίτησης με upload στο bucket `legacy-evidence`, οθόνη review για moderators,
  `/legacy/[cohort]`, workflow `record-contribution.yml` (με `pull_request.user.id`),
  και διαγραφή των δικαιολογητικών μετά το review (GDPR).
- **Recruiter filters**: `/talent?status=open_to_internship&tech=python&year=year_3`.
  Τα indexes στο `career_status` και στο `tech_stack` υπάρχουν ήδη.
