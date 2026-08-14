# 2026-08-14 - Why the host's laptop is not the server

## Question

Owner: "instead of a DO, why don't we host on the host computer? pros and cons?"

Real question, and the honest answer is not "cost" - Durable Objects for our scale are pennies either way. The blockers are browser security rules and venue networks.

## What host-hosting would actually mean

Three shapes, all worse than they sound:

**1. Host runs a local server; phones hit its LAN IP** (`http://192.168.1.42:3000`)

- **Secure-context wall.** Wake Lock and Vibration are secure-context-only APIs. `localhost` counts as secure; **a LAN IP over plain HTTP does not**. Phones would lose screen-wake and haptics - two things the buzzer UX depends on - and the PWA/service worker would not register either. Fixing it needs HTTPS with a cert for an IP address, which means a self-signed cert and a full-page security warning on **every phone** before anyone can play. The 15-second join becomes a 90-second argument with the browser.
- **AP client isolation.** Universities, bars, conference centers and most guest Wi-Fi block client-to-client traffic by default. When it is on, phones cannot reach the laptop at all, and nothing the app does can fix it. This is exactly the kind of venue our first event is in.
- The QR must encode an IP that changes per network, so codes cannot be printed ahead, and the friendly room code disappears.

**2. Host runs a tunnel** (cloudflared/ngrok to their local server)

Solves HTTPS and isolation - by routing through the cloud anyway, with worse reliability, a URL that changes per session, and software the host must install and run. Strictly worse than what we have.

**3. Host's browser IS the server** (WebRTC data channels, star topology)

The most interesting version, and still not the default:

- Still needs a signaling server (cloud) and STUN/TURN for anything but a permissive LAN.
- Same AP-isolation problem for local candidates; TURN relay means cloud again.
- One browser tab terminating ~100 peer connections is a real CPU/memory load, and browsers are not generous about it.

## The disqualifier that applies to all three

**The host's laptop becomes a single point of failure with no recovery.** Today, room state lives in the DO: the host's laptop can die mid-game and they reopen the console URL on any device and resume (docs/design/user-flows.md C6). With host-hosting, a closed lid, a sleep, a crashed tab or a dead battery ends the game for 60 people with nothing to restore from. That is the opposite of the guarantee we designed for.

Two more, lesser but real: the product stops being "a website" (a host would have to install and run something, breaking the creator flow entirely), and remote players/spectators become impossible.

## What host-hosting genuinely wins

Stated fairly, because these are true:

- **No internet required** (LAN only) - the one scenario where it beats us outright.
- Marginally lower latency (a local hop vs an edge round trip - realistically 10-30 ms, and the DO's single-threaded ordering already makes buzz adjudication fair regardless).
- Data never leaves the room.
- No dependency on our deployment being up.

## Decision

**Durable Objects stay the architecture.** The secure-context wall alone is decisive: we would trade wake lock, haptics, and the PWA for a benefit our venue's Wi-Fi probably blocks anyway.

The offline worry that motivates the question is answered better elsewhere and is already shipped: **manual mode** (host awards points, no phones - the total-Wi-Fi-failure fallback, docs/research/00-user-directives.md), the PWA's cached shell, and the rule that the game never blocks on an absent phone.

## The door we left open (worth knowing)

If a venue ever forces the issue, **the M4 store seam makes a LAN transport a swap, not a rewrite**. `apps/web/src/lib/room/` already has two implementations of one interface - the local-sim store (engine in the browser) and the ws store (M3 protocol). A third, WebRTC-backed implementation would slot in beside them, with `packages/engine` running in the host's tab exactly as it does in the hotseat page today. The pure-engine/transport split was designed for this: the engine has never known what carries its actions.

So: not now, not by default, and never at the cost of secure-context APIs - but architecturally reachable if a real event ever demands it.
