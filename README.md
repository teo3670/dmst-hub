# DET Hub

Open-source hub για τους φοιτητές και αποφοίτους του **Τμήματος Διοικητικής Επιστήμης & Τεχνολογίας (ΔΕΤ), ΟΠΑ**:
projects ανά έτος σπουδών με stars και Trending, οδηγός ερευνητικών εργαστηρίων και φοιτητικών ομάδων,
board δράσεων που λήγουν αυτόματα, και (v1.1) Legacy Hall of Fame.

- **Public read:** όλα είναι δημόσια χωρίς login, ιδανικό για recruiters.
- **Verified write:** posts και stars μόνο από επαληθευμένους λογαριασμούς `@aueb.gr`.

## Γρήγορη εκκίνηση

```bash
npm install
cp .env.example .env.local
npm run dev
```

| Εντολή | Τι κάνει |
|---|---|
| `npm run dev` | τοπικός server στο http://localhost:3000 |
| `npm test` | unit tests (Trending, Legacy) |
| `npm run test:db` | εφαρμόζει τα migrations σε Postgres (PGlite) και ελέγχει τα RLS |
| `npm run lint` · `npm run typecheck` | έλεγχοι κώδικα |

## Τεκμηρίωση

- [CONTRIBUTING.md](CONTRIBUTING.md): πώς να συνεισφέρεις (ξεκίνα από εδώ)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): stack, δομή φακέλων, μοντέλο ασφάλειας
- [docs/ROADMAP.md](docs/ROADMAP.md): πλάνο MVP v1.0 και v1.1
