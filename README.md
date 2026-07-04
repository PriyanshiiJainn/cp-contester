# CP Contester

A small app for **you and friends**: on-demand Codeforces virtual contests.

1. Enter a CF handle, pick a division and duration.
2. Get five problems you have **not** solved yet.
3. Paste code and **run sample tests** in the app (like a parse-tests extension).
4. **Submit on codeforces.com** — Accepted is detected automatically.
5. Finish the round; your **profile** shows contests given, problems solved, and per-round performance (solved count + ICPC penalty).

No rating predictor. Optional signup links finished rounds to your account.

The browser never calls codeforces.com directly for the API; CF traffic goes through
`/api/cf/[method]`. Sample statements are fetched server-side and cached.

## Layout

| Package | What |
|---|---|
| `apps/web` | Next.js UI, CF proxy, ingest, contest build/finish, sample run, profile |
| `packages/cf` | Typed CF client + zod schemas + `divisionOf()` / `roundProgress()` |
| `packages/db` | Prisma schema + client (`User`, `Problem`, `VirtualRound`, `IngestMeta`) |
| `packages/rating` | Unused legacy estimator (kept for now; not wired into the app) |

## Architecture

```
Browser ──► Next.js API routes ──► Codeforces (API + problem HTML for samples)
                │              └──► Piston (run code on samples)
                └──► Prisma ──► Supabase Postgres
                     Problem cache (+ samples) + finished VirtualRound rows
```

In-flight contests live in `localStorage`. Finished rounds are written to the DB
and shown on `/profile`.

## Setup

1. Create a free project at [supabase.com](https://supabase.com).
2. Copy connection strings into both env files:

   | Env var | Which string | Notes |
   |---|---|---|
   | `DATABASE_URL` | **Transaction** pooler (port **6543**) | Append `?pgbouncer=true` |
   | `DIRECT_URL` | **Session** pooler (port **5432**) | Used by `prisma migrate` only |
   | `CRON_SECRET` | any long random string | Guards `/api/ingest` |
   | `SESSION_SECRET` | ≥16 random chars | Cookie sessions for login |

   ```bash
   cp apps/web/.env.example apps/web/.env.local
   cp packages/db/.env.example packages/db/.env
   ```

3. Install, migrate, run:

   ```bash
   pnpm install
   pnpm --filter @cp/db migrate:deploy
   pnpm --filter web dev
   ```

4. Seed the problem cache once:

   ```bash
   curl -H "x-ingest-secret: <your-CRON_SECRET>" http://localhost:3000/api/ingest
   ```

## Sample tests

- **Sample tests** loads I/O from the CF problem page and caches it on `Problem.samples`.
- **Run samples** executes your code via the public [Piston](https://github.com/engineer-man/piston) API (`PISTON_URL`, default `https://emkc.org/api/v2/piston/execute`).
- Status in the contest table:
  - **Samples passed** — all sample cases green
  - **Accepted** — CF `OK` detected (or manual mark)

Submit on Codeforces for the real verdict; this app does not host a full judge.

## Profile

`/profile?handle=…` shows:

- Contests given
- Unique problems solved in virtual contests
- Average solves per contest and overall solve rate
- Per-round solved/total and ICPC penalty
- Optional public CF rating / CF solve count

## Deploy (Vercel)

1. Root directory `apps/web`; set `DATABASE_URL`, `DIRECT_URL`, `CRON_SECRET`, `SESSION_SECRET`.
2. `apps/web/vercel.json` schedules `/api/ingest` daily.
3. Run `pnpm --filter @cp/db migrate:deploy` once, then hit `/api/ingest` once.
