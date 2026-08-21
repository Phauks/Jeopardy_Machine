# Cloudflare Setup Runbook

> One-time account setup for the Jeopardy Machine, written 2026-08-13 (pre-M0-completion). Owner executes this; agent sessions have no Cloudflare credentials by design. Est. 15 minutes.
> The wrangler.jsonc files referenced land with the M0 scaffold; their bindings ship commented-out and get uncommented as each resource is created.

## 0. Account decisions (once)

| Decision              | Recommendation                                             | Why                                                                                                                                                                                                                                                                                                 |
| --------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan                  | **Workers Paid ($5/mo) - SETTLED, this account is on it**  | Chosen and active (owner, confirmed 2026-08-20). Free would have worked (it runs SQLite-backed Durable Objects), but Paid removes every limit question - DO duration, D1 size, request caps - for less than one JeopardyLabs subscription. Nothing in the repo assumes free-tier headroom any more. |
| workers.dev subdomain | Claim one (Dashboard -> Workers & Pages -> your subdomain) | The app is fully usable at `*.workers.dev` URLs while the product name / custom domain is still being workshopped.                                                                                                                                                                                  |
| Custom domain         | Defer until the name lands                                 | When ready: buy through Cloudflare Registrar (at-cost) and attach - see §4.                                                                                                                                                                                                                         |

## 1. Local prerequisites (your machine, not the agent's)

```sh
npm i -g wrangler        # or use the repo's pinned devDependency via pnpm
wrangler login           # opens browser OAuth; grants your CLI your account
wrangler whoami          # verify; note the Account ID (also needed in §5)
```

## 2. Resources - ALREADY PROVISIONED, do not recreate

Both were created in the dashboard on 2026-08-13 and are bound in the configs by id. Nothing
below needs running again, and recreating either would break the bindings that already work:

| Resource | Name                     | Bound as | Where                                                                                       |
| -------- | ------------------------ | -------- | ------------------------------------------------------------------------------------------- |
| D1       | `jeopardy-machine`       | `DB`     | apps/web/wrangler.jsonc AND apps/realtime/wrangler.jsonc - the SAME id, held by a gate test |
| R2       | `jeopardy-machine-media` | `MEDIA`  | apps/web/wrangler.jsonc                                                                     |

The **id** is what the configs bind, not the name, so renaming either in the dashboard is safe
and changing which resource they point at is not. `worker-config.gate.test.ts` fails if the two
Workers ever bind different database ids.

R2 is provisioned and **unused by code** so far. Clue media currently travels as URLs the app
serves (the club night's pictures ship as static assets); R2 arrives when uploads do.

The one D1 item still open is applying the SCHEMA to the database that already exists - §2a.
That is SQL against `jeopardy-machine`, not a new database.

Durable Objects need **no manual creation** - the `GameRoomDO` namespace is created
automatically by the migration block in apps/realtime/wrangler.jsonc on first deploy.

<details>
<summary>Provisioning from scratch (a self-hoster on their own account, not you)</summary>

```sh
wrangler d1 create jeopardy-machine
#   -> copy the printed database_id into BOTH wrangler.jsonc files
wrangler r2 bucket create jeopardy-machine-media
#   -> bind it in apps/web/wrangler.jsonc as MEDIA
```

</details>

### 2a. Apply the D1 schema (owner-run; required for the public lobby)

D1 has its first real use as of 2026-08-14: the **room registry** that backs the public lobby (docs/decisions/2026-08-14-room-visibility-and-lobby.md). Its schema lives in `apps/web/migrations/` and is applied with wrangler's migration tool - by hand, by the owner, never by CI or an agent session:

```sh
# see what would run
npx wrangler d1 migrations list jeopardy-machine --remote -c apps/web/wrangler.jsonc

# apply (repeat after any new file lands in apps/web/migrations/)
npx wrangler d1 migrations apply jeopardy-machine --remote -c apps/web/wrangler.jsonc
```

Both Workers bind this database (web writes/reads, the room DO reports its own transitions - see the decision's addendum), but the migration is applied **once**, through the web config that owns the schema.

> **RE-APPLY REQUIRED (2026-08-14, extended 2026-08-16 - ONE re-apply covers both).** `0001_create_rooms.sql` was **rewritten in place**, not extended, twice:
>
> 1. the listing axis became `public` / `private` (docs/decisions/2026-08-14-room-controls-and-staging.md), so the column is now `listing` and its CHECK constraint moved with it;
> 2. the room's **spectator budget** joined the projection at the reconcile - `spectator_count`, `spectator_cap`, `spectators_allowed` - so the lobby card can show who is watching beside who is playing.
>
> The full column list the table now carries: `code, title, host_label, listing, has_password, phase, player_count, player_cap, spectator_count, spectator_cap, spectators_allowed, created_at, last_seen_at, expires_at, ended_at`.
>
> The file starts with `DROP TABLE IF EXISTS rooms`, which is the honest edit for a product with no users and rooms that live hours - but it means an environment that already ran §2a must run it **again**, and will lose every row it had. Those rows are lobby projections of rooms that expired long ago; no game, code, or player state lives in D1. Wrangler records migrations as applied, so force the re-run in whichever way you prefer:
>
> ```sh
> # simplest: drop the recorded migration and apply again
> npx wrangler d1 execute jeopardy-machine --remote -c apps/web/wrangler.jsonc \
>   --command "DELETE FROM d1_migrations WHERE name = '0001_create_rooms.sql'"
> npx wrangler d1 migrations apply jeopardy-machine --remote -c apps/web/wrangler.jsonc
>
> # or run the file directly (it is idempotent - it drops and recreates)
> npx wrangler d1 execute jeopardy-machine --remote -c apps/web/wrangler.jsonc \
>   --file apps/web/migrations/0001_create_rooms.sql
> ```
>
> Do the same with `--local` for the dev loop (docs/DEVELOPMENT.md). Skipping it leaves the lobby broken in the loud way rather than the silent one: `GET /api/rooms` will report `{"status":"unavailable","reason":"error"}` with `no such column: listing` (or `no such column: spectator_count`) in `detail`, and room creation and joining keep working throughout.

If the migration is never applied, nothing breaks: `POST /api/rooms` still creates rooms and every join still works - `GET /api/rooms` just answers an empty lobby. Rooms are usable by code from day one; the lobby is the thing that switches on here.

**Empty lobby? Check `/api/rooms` (and `/api/version`) - they say why.** Both responses carry a `registry` field, and it is the difference between a quiet night and an unapplied migration:

```sh
curl -s https://<your-worker>/api/version | grep -o '"registry":[^}]*}'
#   {"status":"ok"}                                   -> the lobby works; it really is empty
#   {"status":"unavailable","reason":"no-table",...}  -> THIS section was never run. Run it.
#   {"status":"unavailable","reason":"no-binding"}    -> no D1 bound to this Worker at all
#   {"status":"unavailable","reason":"error",...}     -> D1's own message is in `detail`
```

Applying the migration switches the lobby on with **no redeploy** - the next `GET /api/rooms` lists rooms created before it, as long as they have not expired. This reporting exists because it once did not: a public room that never appeared in the lobby and an ordinary empty lobby looked identical on every surface (owner report 2026-08-14).

### 2b. Dashboard path (equivalent - owner prefers dash.cloudflare.com)

Both resources can be created in the dashboard instead of the CLI; the _only_ CLI-ish step that remains is pasting one ID into config:

1. **D1**: Dashboard -> Storage & Databases -> D1 -> Create database -> name it. Then open the database and copy its **Database ID** into `apps/web/wrangler.jsonc` under `[[d1_databases]]` (the code binds by ID, not by name).
2. **R2**: Dashboard -> R2 -> Create bucket -> name it (location: automatic). No ID needed - the binding uses the bucket name; make the name in wrangler.jsonc match exactly.
3. **The two Workers cannot be pre-created in the dashboard** in any useful way - they are born from the repo's build output on first `wrangler deploy` (§3). The dashboard is where you _manage_ them afterward (logs, settings, domains, rename).

### 2c. Renameability (verified 2026-08-13 - plan around this when naming)

| Resource                 | Renameable later?            | Notes                                                                                                                                                                                                                                                |
| ------------------------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker (each of the two) | **Yes**, in the dashboard    | Workers now have stable UUIDs under the hood; after a dashboard rename, update `name` in that app's wrangler.jsonc to match (Workers Builds even auto-PRs the mismatch if ever connected). workers.dev URL changes with the name - reprint QR codes. |
| workers.dev subdomain    | **Yes** (change anytime)     | Changing breaks all old `*.workers.dev` URLs at once.                                                                                                                                                                                                |
| Custom domain            | **Freely attach/detach**     | This is the real user-facing identity - swap domains anytime with zero resource changes.                                                                                                                                                             |
| D1 database name         | **Treat as fixed**           | No official rename; low stakes - the app binds by database ID, so the display name is cosmetic. Worst case: export -> create new -> import.                                                                                                          |
| R2 bucket name           | **No** (S3-style, by design) | Rename = new bucket + copy objects. Pick a name-agnostic bucket name now.                                                                                                                                                                            |
| DO class/namespace       | Config-level only            | Renaming the class is a wrangler `renamed_classes` migration, not a dashboard action. Not a concern unless we rename `GameRoomDO` in code.                                                                                                           |

**Practical upshot while the product name is still being workshopped:** nothing is blocked. Give the un-renameable things (R2 bucket, D1) _project-neutral_ names (`jm-media`, `jm-data` or similar) rather than the future product name; Workers can be renamed to match the final brand later, and the identity players actually see lives in the custom domain, which is always swappable.

## 3. First deploy (order matters)

```sh
pnpm install && pnpm test          # never deploy red
pnpm -F realtime run deploy        # 1st: the DO worker must exist...
pnpm -F web run deploy             # 2nd: ...before web's cross-script DO binding can bind to it
```

Both Workers have already had their first deploy (2026-08-13) and now build from `main` through Workers Builds (§3b), so the CLI path above is a fallback rather than the routine. The ordering mattered once: web's cross-script binding cannot resolve until the realtime Worker exists.

Verify: the deploy output prints both `*.workers.dev` URLs; open the web URL and walk §3a. Deploys stay **manual and owner-run** (per the repo's deploy-deny convention in .claude/settings.json) until we deliberately add CI deploys with a scoped token.

### 3a. Smoke test the deployed suite (5 minutes, do it before the event)

The dry-run deploy and the test suite both pass without a network, so the first deploy is the
first time some of this is real. Walk it once, in this order - each step is the cheapest check
for a different failure:

1. **`/api/version`** - reports the commit, the wire protocol version and the registry's own
   health. `registry.status` must be `ok`. `no-table` means §2a has not been applied to this
   environment; `no-binding` means the D1 binding did not reach the deployed Worker.
2. **The front door** lists rooms (or says nobody is hosting - both are fine; an error line is
   not). Make a room: pick **Sample game**, name it, host label, **Public**.
3. **The console opens** with the room's code and QR. That proves the cross-script DO binding:
   creation went through the web Worker and the socket reached the realtime Worker's DO.
4. **Open the game screen** from the console, then scan the QR with a phone on a DIFFERENT
   network (mobile data, not the venue Wi-Fi). The phone should reach the pre-game screen and
   appear on the console's roster within a second or two.
5. **Close the console tab and reopen `/room/<CODE>/host`.** The console must come back with the
   room intact - that is the host-token recovery (M6), and the one failure you cannot recover
   from mid-event if it does not work.
6. **Make a second room with the club night's game** (Which game -> Board Game Club x
   Environmental Law Society). Start it and open a picture clue: the image must render on the
   game screen, not just its caption. That exercises the static-asset path - the event's
   documents and its eight images ship in the web Worker's assets directory
   (`static/games/board-game-club-x-els/`), and the media URLs are built from the origin the
   host loaded, so a custom domain change is worth re-checking here.
7. **Make a third room with a password** and open `/room/<CODE>` in a fresh private window - no
   front door, no stashed password. It must ask for the password and let you in.

Anything that fails here fails the same way at the event, and every one of them is a
five-minute fix beforehand.

## 3b. Continuous deploys via Workers Builds (dashboard-managed - recommended steady state)

Workers Builds connects the GitHub repo to Cloudflare so **every push to the production branch auto-builds and deploys** - no CLI in the loop after setup. Two Workers = connect the same repo twice, one project per Worker:

| Setting           | `jeopardy-realtime` (connect FIRST) | `jeopardy-web`                                 |
| ----------------- | ----------------------------------- | ---------------------------------------------- |
| Repository        | `Phauks/Jeopardy_Machine`           | `Phauks/Jeopardy_Machine`                      |
| Root directory    | `apps/realtime`                     | `apps/web`                                     |
| Build command     | `pnpm install --frozen-lockfile`    | `pnpm install --frozen-lockfile && pnpm build` |
| Deploy command    | `npx wrangler deploy`               | `npx wrangler deploy`                          |
| Production branch | `main`                              | `main`                                         |

Setup: Dashboard -> Workers & Pages -> Create -> **Import a repository** -> authorize the Cloudflare GitHub App for this repo -> fill the table above. Realtime must complete its first deploy before web's first deploy succeeds (cross-script DO binding). If a build can't resolve the pnpm workspace from the app root directory, fall back to root directory `/` with build command `pnpm install --frozen-lockfile && pnpm --filter @jeopardy/web run build` and deploy command `npx wrangler deploy -c apps/web/wrangler.jsonc` (package names are `@jeopardy/web` / `@jeopardy/realtime` - a bare `-F web` does not match).

**Troubleshooting `"The entry-point file at .svelte-kit/cloudflare/_worker.js was not found"`** (first-deploy incident, 2026-08-13): wrangler ran but the SvelteKit build had not produced output - the web project's **build command didn't run or didn't run in `apps/web`**. Verified locally: `pnpm run build` inside `apps/web` creates `.svelte-kit/cloudflare/_worker.js` with no prior workspace build needed (protocol is consumed from TS source). Fix in the web project's dashboard Settings -> Build: Root directory `apps/web`, Build command exactly `pnpm install --frozen-lockfile && pnpm run build`, Deploy command `npx wrangler deploy`. Check the build log's phases: you should see the install, then vite's build output ("built in ...ms", adapter-cloudflare emit), and only then wrangler. If the log jumps straight from clone to wrangler, the build command field is empty.

Branch semantics: pushes to `main` = production deploys; pushes to other branches = **preview versions** (each PR gets preview URLs - useful for reviewing UI work live). This means the deployment flow becomes: work lands on the feature branch -> PR -> merge to `main` -> both Workers redeploy automatically.

**Interim note (while all work still lives on `claude/jeopardy-suite-research-rm1kao`):** either do one manual CLI deploy (§3) to see things live now, or temporarily set the Builds production branch to the feature branch and flip it to `main` at first merge. Flipping later is one dropdown.

## 4. Custom domain (when the name is chosen)

1. Registrar: buy the domain (Cloudflare Dashboard -> Domain Registration), or transfer one in.
2. Attach: `apps/web/wrangler.jsonc` -> `routes = [{ pattern = "<domain>", custom_domain = true }]`; same for a `play.<domain>` or `ws.<domain>` route on the realtime worker if we want a stable WS hostname. Redeploy.
3. Player-facing QR URLs use this domain; keep it short - it gets typed by people holding drinks.

## 5. Optional: let agent sessions provision/deploy

If you want future Claude sessions to run wrangler against the account, add to the Claude Code environment (environment settings -> variables):

- `CLOUDFLARE_ACCOUNT_ID` = your account id
- `CLOUDFLARE_API_TOKEN` = a **custom token**, scoped to exactly: Workers Scripts:Edit, Workers KV Storage:Edit (unused today), D1:Edit, Workers R2 Storage:Edit, Account Settings:Read. No zone/DNS permissions unless/until we automate domains.

Notes: this hands deploy power to agent sessions - the repo's `.claude/settings.json` deploy-denies still gate _unasked_ deploys, but the trust boundary is yours to draw. Rotating the token in the dashboard kills access instantly. Skipping this section entirely is a fine steady state: agents prepare everything, you run the two deploy commands.

## 6. GitHub repo settings (one-time, ~5 min - matters because main now auto-deploys)

Since Workers Builds deploys every push to `main`, GitHub is now the deploy gate. Settings -> in the repo:

**Required:**

1. **Branch protection / ruleset on `main`** (Settings -> Rules -> Rulesets -> New branch ruleset, target `main`):
   - Require a pull request before merging (no direct pushes - this makes "PR merge = deploy" the only path to production).
   - Require status checks to pass: add the CI workflow's check (`ci`) as required, so a red build physically cannot reach main - "never deploy red" becomes enforced, not aspirational.
   - No required reviewers (solo project; the CI gate is the reviewer).
2. **Confirm default branch is `main`** (Settings -> General) - Workers Builds and the PR flow both key off it.

**Recommended:**

3. **Auto-delete head branches** (Settings -> General -> Pull Requests) - merged feature branches clean themselves up.
4. **Merge style**: allow "Create a merge commit" and disable squash/rebase for consistency - the agents' incremental commits are individually verified (gates run before each), so preserving them keeps history bisectable. (Prefer squash if you'd rather read main as one-commit-per-PR - either is fine; pick one and stay with it.)
5. **Dependabot: security alerts ON, version-bump PRs OFF** (Settings -> Code security). Versions are deliberately pinned in the pnpm catalog (prerelease combination is sensitive); automated bump PRs would fight the pins. The planned scheduled "canary" CI job against `@next` covers staying current instead.

**Not needed:** repo secrets (CI doesn't deploy - Cloudflare pulls via the GitHub App you already authorized), issue templates, CODEOWNERS.

## 7. Later phases (do nothing now)

- **Phase 2 auth**: Cloudflare Zero Trust -> Access application in front of `/editor` and `/host` routes (one policy: your email). No code changes - documented when M8 arrives.
- **Observability**: Workers Logs is on by default; consider Logpush only if the suite goes multi-tenant.

## Checklist

- [x] Plan: **Workers Paid**, active on this account (§0)
- [ ] `wrangler login` done locally - only needed for a CLI deploy or to run §2a; Workers Builds does not use it
- [x] workers.dev subdomain claimed (both Workers have deployed under it)
- [x] D1 created (dashboard, 2026-08-13) -> id `c12ef3a9-…74d6` bound in apps/web/wrangler.jsonc as `DB` (confirm the database_name field matches the dashboard name); the same id is bound in apps/realtime/wrangler.jsonc since 2026-08-14
- [ ] D1 migrations applied (§2a) - turns the public lobby on; rooms work without it. **Re-apply after 2026-08-16**: `0001_create_rooms.sql` was rewritten twice (listing axis renamed to public/private, then the spectator columns added) and drops the table it recreates - one re-apply covers both
- [x] R2 bucket `jeopardy-machine-media` created (dashboard, 2026-08-13) -> bound as `MEDIA`
- [x] Both Workers deployed and building from `main` via Workers Builds (2026-08-13; the realtime-before-web ordering mattered for the FIRST deploy only, and both exist now)
- [ ] §3a smoke test walked end to end (version -> room -> phone -> console recovery -> picture clue -> password room)
- [ ] (optional) scoped API token added to agent environment
- [ ] (later) custom domain after the name lands
