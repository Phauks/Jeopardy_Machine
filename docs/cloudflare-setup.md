# Cloudflare Setup Runbook

> One-time account setup for the Jeopardy Machine, written 2026-08-13 (pre-M0-completion). Owner executes this; agent sessions have no Cloudflare credentials by design. Est. 15 minutes.
> The wrangler.jsonc files referenced land with the M0 scaffold; their bindings ship commented-out and get uncommented as each resource is created.

## 0. Account decisions (once)

| Decision              | Recommendation                                             | Why                                                                                                                                                                                                                               |
| --------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan                  | **Workers Paid ($5/mo)**                                   | Free plan now runs SQLite-backed Durable Objects, so free _works_ - but Paid removes every limit question (DO duration, D1 size, request caps) for less than one JeopardyLabs subscription. Decide by feel; the app runs on free. |
| workers.dev subdomain | Claim one (Dashboard -> Workers & Pages -> your subdomain) | The app is fully usable at `*.workers.dev` URLs while the product name / custom domain is still being workshopped.                                                                                                                |
| Custom domain         | Defer until the name lands                                 | When ready: buy through Cloudflare Registrar (at-cost) and attach - see §4.                                                                                                                                                       |

## 1. Local prerequisites (your machine, not the agent's)

```sh
npm i -g wrangler        # or use the repo's pinned devDependency via pnpm
wrangler login           # opens browser OAuth; grants your CLI your account
wrangler whoami          # verify; note the Account ID (also needed in §5)
```

## 2. Provision resources (run from the repo root, after M0 merges)

```sh
# D1 - saved boards, content packs, results
wrangler d1 create jeopardy-machine
#   -> copy the printed database_id into apps/web/wrangler.jsonc [[d1_databases]]

# R2 - clue media (images/audio), later theme backgrounds + sound packs
wrangler r2 bucket create jeopardy-media
#   -> uncomment [[r2_buckets]] in apps/web/wrangler.jsonc (binding name MEDIA)
```

Durable Objects need **no manual creation** - the `GameRoomDO` namespace is created automatically by the migration block in apps/realtime/wrangler.jsonc on first deploy.

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

Verify: the deploy output prints both `*.workers.dev` URLs; open the web URL, and the M0 scaffold's dev page should complete its WebSocket echo against the deployed DO. Deploys stay **manual and owner-run** (per the repo's deploy-deny convention in .claude/settings.json) until we deliberately add CI deploys with a scoped token.

## 3b. Continuous deploys via Workers Builds (dashboard-managed - recommended steady state)

Workers Builds connects the GitHub repo to Cloudflare so **every push to the production branch auto-builds and deploys** - no CLI in the loop after setup. Two Workers = connect the same repo twice, one project per Worker:

| Setting           | `jeopardy-realtime` (connect FIRST) | `jeopardy-web`                                 |
| ----------------- | ----------------------------------- | ---------------------------------------------- |
| Repository        | `Phauks/Jeopardy_Machine`           | `Phauks/Jeopardy_Machine`                      |
| Root directory    | `apps/realtime`                     | `apps/web`                                     |
| Build command     | `pnpm install --frozen-lockfile`    | `pnpm install --frozen-lockfile && pnpm build` |
| Deploy command    | `npx wrangler deploy`               | `npx wrangler deploy`                          |
| Production branch | `main`                              | `main`                                         |

Setup: Dashboard -> Workers & Pages -> Create -> **Import a repository** -> authorize the Cloudflare GitHub App for this repo -> fill the table above. Realtime must complete its first deploy before web's first deploy succeeds (cross-script DO binding). If a build can't resolve the pnpm workspace from the app root directory, fall back to root directory `/` with build command `pnpm install --frozen-lockfile && pnpm -F <app> build` and deploy command `npx wrangler deploy -c apps/<app>/wrangler.jsonc`.

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

## 6. Later phases (do nothing now)

- **Phase 2 auth**: Cloudflare Zero Trust -> Access application in front of `/editor` and `/host` routes (one policy: your email). No code changes - documented when M8 arrives.
- **Observability**: Workers Logs is on by default; consider Logpush only if the suite goes multi-tenant.

## Checklist

- [ ] Plan decided (free is fine; $5 removes doubt)
- [ ] `wrangler login` done locally
- [ ] workers.dev subdomain claimed
- [x] D1 created (dashboard, 2026-08-13) -> id `c12ef3a9-…74d6` bound in apps/web/wrangler.jsonc as `DB` (confirm the database_name field matches the dashboard name)
- [x] R2 bucket `jeopardy-machine-media` created (dashboard, 2026-08-13) -> bound as `MEDIA`
- [ ] realtime deployed, then web; echo page verified
- [ ] (optional) scoped API token added to agent environment
- [ ] (later) custom domain after the name lands
