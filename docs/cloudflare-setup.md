# Cloudflare Setup Runbook

> One-time account setup for the Jeopardy Machine, written 2026-08-13 (pre-M0-completion). Owner executes this; agent sessions have no Cloudflare credentials by design. Est. 15 minutes.
> The wrangler.jsonc files referenced land with the M0 scaffold; their bindings ship commented-out and get uncommented as each resource is created.

## 0. Account decisions (once)

| Decision | Recommendation | Why |
|---|---|---|
| Plan | **Workers Paid ($5/mo)** | Free plan now runs SQLite-backed Durable Objects, so free *works* - but Paid removes every limit question (DO duration, D1 size, request caps) for less than one JeopardyLabs subscription. Decide by feel; the app runs on free. |
| workers.dev subdomain | Claim one (Dashboard -> Workers & Pages -> your subdomain) | The app is fully usable at `*.workers.dev` URLs while the product name / custom domain is still being workshopped. |
| Custom domain | Defer until the name lands | When ready: buy through Cloudflare Registrar (at-cost) and attach - see §4. |

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

## 3. First deploy (order matters)

```sh
pnpm install && pnpm test          # never deploy red
pnpm -F realtime run deploy        # 1st: the DO worker must exist...
pnpm -F web run deploy             # 2nd: ...before web's cross-script DO binding can bind to it
```

Verify: the deploy output prints both `*.workers.dev` URLs; open the web URL, and the M0 scaffold's dev page should complete its WebSocket echo against the deployed DO. Deploys stay **manual and owner-run** (per the repo's deploy-deny convention in .claude/settings.json) until we deliberately add CI deploys with a scoped token.

## 4. Custom domain (when the name is chosen)

1. Registrar: buy the domain (Cloudflare Dashboard -> Domain Registration), or transfer one in.
2. Attach: `apps/web/wrangler.jsonc` -> `routes = [{ pattern = "<domain>", custom_domain = true }]`; same for a `play.<domain>` or `ws.<domain>` route on the realtime worker if we want a stable WS hostname. Redeploy.
3. Player-facing QR URLs use this domain; keep it short - it gets typed by people holding drinks.

## 5. Optional: let agent sessions provision/deploy

If you want future Claude sessions to run wrangler against the account, add to the Claude Code environment (environment settings -> variables):

- `CLOUDFLARE_ACCOUNT_ID` = your account id
- `CLOUDFLARE_API_TOKEN` = a **custom token**, scoped to exactly: Workers Scripts:Edit, Workers KV Storage:Edit (unused today), D1:Edit, Workers R2 Storage:Edit, Account Settings:Read. No zone/DNS permissions unless/until we automate domains.

Notes: this hands deploy power to agent sessions - the repo's `.claude/settings.json` deploy-denies still gate *unasked* deploys, but the trust boundary is yours to draw. Rotating the token in the dashboard kills access instantly. Skipping this section entirely is a fine steady state: agents prepare everything, you run the two deploy commands.

## 6. Later phases (do nothing now)

- **Phase 2 auth**: Cloudflare Zero Trust -> Access application in front of `/editor` and `/host` routes (one policy: your email). No code changes - documented when M8 arrives.
- **Observability**: Workers Logs is on by default; consider Logpush only if the suite goes multi-tenant.

## Checklist

- [ ] Plan decided (free is fine; $5 removes doubt)
- [ ] `wrangler login` done locally
- [ ] workers.dev subdomain claimed
- [ ] `wrangler d1 create jeopardy-machine` -> id pasted into wrangler.jsonc
- [ ] `wrangler r2 bucket create jeopardy-media` -> binding uncommented
- [ ] realtime deployed, then web; echo page verified
- [ ] (optional) scoped API token added to agent environment
- [ ] (later) custom domain after the name lands
