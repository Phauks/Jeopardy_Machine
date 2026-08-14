// Proof script for the M3 week-1 risk (docs/decisions/2026-08-13-single-origin-binding.md):
// a WebSocket upgrade passes through the SvelteKit-on-Workers request path and the
// cross-script DO binding. Run against the BUILT web worker under multi-config wrangler dev:
//
//   pnpm -F @jeopardy/web build
//   npx wrangler dev -c apps/web/wrangler.jsonc -c apps/realtime/wrangler.jsonc --port 8788
//   node apps/web/scripts/prove-single-origin.mjs http://localhost:8788
//
// Exit 0 = the passthrough works end to end (create -> upgrade -> join -> welcome -> refusal
// path for uncreated codes). Non-zero = investigate or fall back to the thin custom entry.
const origin = process.argv[2] ?? "http://localhost:8788";
const wsOrigin = origin.replace(/^http/, "ws");

/** @param {string} message */
function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

/** @param {string} url @returns {Promise<WebSocket>} */
function openSocket(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener("open", () => resolve(socket), { once: true });
    socket.addEventListener("error", () => reject(new Error(`could not open ${url}`)), {
      once: true,
    });
  });
}

/** @param {WebSocket} socket @returns {Promise<any>} */
function nextMessage(socket, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for a frame")), timeoutMs);
    socket.addEventListener(
      "message",
      (/** @type {MessageEvent} */ event) => {
        clearTimeout(timer);
        resolve(JSON.parse(String(event.data)));
      },
      { once: true },
    );
  });
}

// 1. Explicit create through the web route + binding.
const createResponse = await fetch(`${origin}/api/rooms`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    game: { kind: "compact", rounds: [{ columns: 3, rows: 3 }] },
    seed: "prove-single-origin",
  }),
});
if (createResponse.status !== 201) fail(`create answered ${createResponse.status}`);
const { code, hostToken } = await createResponse.json();
console.log(`created room ${code}`);

// 2. The upgrade itself - THE risk item: 101 through SvelteKit's endpoint path.
const socket = await openSocket(`${wsOrigin}/room/${code}/ws`);
console.log("upgrade passed through the SvelteKit worker (socket open)");

// 3. The room actually speaks: host join answered with welcome + snapshot.
socket.send(JSON.stringify({ version: 1, type: "join", role: "host", hostToken }));
const welcome = await nextMessage(socket);
if (welcome.type !== "welcome" || welcome.role !== "host") {
  fail(`expected a host welcome, got ${JSON.stringify(welcome)}`);
}
const snapshot = await nextMessage(socket);
if (snapshot.type !== "snapshot" || snapshot.phase !== "lobby") {
  fail(`expected a lobby snapshot, got ${JSON.stringify(snapshot).slice(0, 200)}`);
}
console.log("host joined through the single origin: welcome + lobby snapshot");
socket.close(1000, "proof done");

// 4. Connects never create: an uncreated code is refused through the same path.
const strayCode = code === "ZZZZZ" ? "YYYYY" : "ZZZZZ";
const straySocket = await openSocket(`${wsOrigin}/room/${strayCode}/ws`);
const refusal = await nextMessage(straySocket);
if (refusal.type !== "refused" || refusal.reason !== "no-such-room") {
  fail(`expected no-such-room, got ${JSON.stringify(refusal)}`);
}
console.log("uncreated code refused with no-such-room through the single origin");
straySocket.close();

console.log("PASS: single-origin WebSocket passthrough verified");
process.exit(0);
