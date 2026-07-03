# CP Contester

On-demand **Codeforces virtual contests**: enter your CF handle, pick a division
(Div. 1–4) and a duration, and get a contest built only from problems you
haven't solved. Solve on real Codeforces; the app detects your ACs and, when
the round ends, shows an estimated performance and rating change.

No login, no passwords — everything uses **public** CF data by handle.
The browser never calls codeforces.com directly; all CF traffic goes through
the `/api/cf/[method]` proxy route.

## Layout

| Package | What |
|---|---|
| `apps/web` | Next.js (App Router): UI, `/api/cf` proxy, `/api/ingest` cron, contest build/finish routes |
| `packages/cf` | Typed CF client + zod schemas + `divisionOf()` |
| `packages/rating` | Pure performance → delta estimator (Vitest-tested) |
| `packages/db` | Prisma schema + client (`Problem`, `VirtualRound`) |

## Local development

```bash
pnpm install                    # also runs prisma generate
pnpm test                       # vitest: packages/rating + packages/cf
cp apps/web/.env.example apps/web/.env.local   # fill in real values
cp packages/db/.env.example packages/db/.env   # fill in real values (for prisma CLI)
pnpm --filter @cp/db migrate:deploy            # apply migrations to Supabase
pnpm --filter web dev                          # http://localhost:3000
```

## Environment variables

| Var | Where | What |
|---|---|---|
| `DATABASE_URL` | `apps/web` runtime (+ Vercel) | Supabase **pooled** connection (port 6543, `?pgbouncer=true`) |
| `DIRECT_URL` | wherever `prisma migrate` runs | Supabase **direct** connection (port 5432) |
| `CRON_SECRET` | `apps/web` runtime (+ Vercel) | Guards `/api/ingest`. On Vercel this exact name makes Vercel Cron send `Authorization: Bearer <value>` automatically |

## The one manual step

After migrating, seed the problem cache **once** (the daily cron re-runs it):

```bash
curl -H "x-ingest-secret: $CRON_SECRET" https://<your-app>/api/ingest
# locally: curl -H "x-ingest-secret: dev-secret" http://localhost:3000/api/ingest
```

It pulls `problemset.problems` + `contest.list` (two CF calls total), stamps
each problem's division from its contest title, and rebuilds the `Problem`
table (~11k rows). Until it has run, "Start" will answer
`503 problem cache is empty`.

## Deploying to Vercel

1. Import the repo; set **Root Directory** to `apps/web` (Vercel detects the
   Turborepo + pnpm workspace and installs from the repo root).
2. Set `DATABASE_URL`, `DIRECT_URL`, `CRON_SECRET` env vars.
3. `apps/web/vercel.json` already schedules `/api/ingest` daily at 03:17 UTC.
4. Run the migration once from your machine
   (`pnpm --filter @cp/db migrate:deploy`) and hit `/api/ingest` once.

## How the estimate works

`packages/rating`: P(solve problem of difficulty d at rating R) is the Elo
expectancy `1 / (1 + 10^((d-R)/400))`. We binary-search the R whose expected
solve count equals your actual solve count → that's the performance;
`delta = round((perf − rating) / 2)`. It is a deliberately rough single-user
estimate — speed, hacks, and the actual field are ignored, and it is labeled
as such in the UI.

## v1 scope notes (TODOs, intentionally not built)

- **Handle-ownership verification** — anyone can start a round as any handle.
- **Penalty / speed scoring** — solve minute is recorded per problem
  (`solvedIds` + minute in the UI state) as a seam for ICPC/IOI-style scoring.
- Combined "Div. 1 + Div. 2" rounds are filed under Div. 1 (first match in the
  title); a future version could file them under both.
- The contest builder may pick two problems from the same past contest.
- `VirtualRound` rows are written only at round end; in-flight rounds live in
  `localStorage` (timer is derived from `startedAt`, so refresh can't pause it).
