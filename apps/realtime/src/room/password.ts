// Room-password hashing and verification. Pure Web Crypto, no DOM, no partyserver - the DO
// calls it during join (docs/decisions/2026-08-14-room-visibility-and-lobby.md).
//
// ALGORITHM CHOICE - PBKDF2-HMAC-SHA256, 100k iterations, 16-byte random salt, 32-byte key:
// - workerd's SubtleCrypto implements PBKDF2 natively (no dependency, no WASM); scrypt and
//   argon2 are not available there, which settles the question rather than argues it.
// - 100k iterations is ~tens of milliseconds of DO CPU per join. A room password is verified
//   ONCE per connection, so even a 100-phone stampede pays it 100 times across minutes -
//   while an offline attacker who somehow obtained the DO's storage pays it per guess.
// - A plain SHA-256 of salt+password would be defensible for a two-hour shared secret, but it
//   is also free to attack at billions of guesses per second. The iteration count is the only
//   thing that makes the stored value worth anything, and it costs us nothing we can feel.
//
// What this module deliberately does NOT do: compare in variable time (see verifyRoomPassword),
// leak whether a room has a password (that is the registry's has_password, a public fact by
// design), or persist anything itself - the DO owns storage.

export type StoredRoomPassword = {
  // Named so a future migration to another KDF is a data question, not an archaeology one.
  algorithm: "PBKDF2-SHA256";
  iterations: number;
  saltHex: string;
  hashHex: string;
};

const iterations = 100_000;
const saltBytes = 16;
const derivedBits = 256;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function derive(password: string, salt: Uint8Array, rounds: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: rounds },
    key,
    derivedBits,
  );
  return new Uint8Array(bits);
}

export async function hashRoomPassword(password: string): Promise<StoredRoomPassword> {
  const salt = crypto.getRandomValues(new Uint8Array(saltBytes));
  const hash = await derive(password, salt, iterations);
  return {
    algorithm: "PBKDF2-SHA256",
    iterations,
    saltHex: toHex(salt),
    hashHex: toHex(hash),
  };
}

/**
 * Constant-time verification. The comparison walks the FULL digest regardless of where the
 * first difference is: a timing-sensitive `===` on a hex string would hand an attacker a
 * per-byte oracle, which is exactly the shortcut a rate limit cannot cover.
 */
export async function verifyRoomPassword(
  password: string,
  stored: StoredRoomPassword,
): Promise<boolean> {
  const candidate = await derive(password, fromHex(stored.saltHex), stored.iterations);
  const expected = fromHex(stored.hashHex);
  if (candidate.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < candidate.length; index += 1) {
    difference |= (candidate[index] ?? 0) ^ (expected[index] ?? 0);
  }
  return difference === 0;
}
