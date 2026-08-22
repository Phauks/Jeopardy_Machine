// The room-control contracts (docs/decisions/2026-08-14-room-controls-and-staging.md). What
// matters here is what the shapes REFUSE: a cap above the operational limit, a patch that
// changes nothing, and - the one that would be a real leak - a settings payload carrying a
// secret to every connected phone and projector. Room passwords were removed on 2026-08-20
// (visibility.ts explains the trade); the leak assertions stay, because the host token is
// still a secret and the schema is still what stops it travelling.
import { describe, expect, it } from "vitest";
import { limits } from "../limits.ts";
import {
  defaultRoomSettings,
  roomSettingsPatchSchema,
  roomSettingsSchema,
  updateRoomSettingsRequestSchema,
} from "./room-settings.ts";

const settings = {
  ...defaultRoomSettings,
  title: "Pub quiz night",
  hostLabel: "Board Game Club",
};

describe("the settings every client is told", () => {
  it("parses a full payload and refuses the retired entry axis", () => {
    expect(roomSettingsSchema.parse(settings)).toEqual(settings);
    // `entry` (open / password) went with the passwords. No alias, no ignored field: a client
    // still sending it is one that has not been updated.
    expect(roomSettingsSchema.safeParse({ ...settings, entry: "open" }).success).toBe(false);
  });

  it("never carries a secret of any kind to the phones and the projector", () => {
    for (const leak of [
      { password: "hunter2!" },
      { passwordHash: "a".repeat(64) },
      { hostToken: "0".repeat(32) },
    ]) {
      expect(roomSettingsSchema.safeParse({ ...settings, ...leak }).success).toBe(false);
    }
  });

  it("defaults to the quiet room: private, spectators welcome, code on screen", () => {
    expect(defaultRoomSettings.listing).toBe("private");
    expect(defaultRoomSettings.spectatorsAllowed).toBe(true);
    expect(defaultRoomSettings.hideJoinCode).toBe(false);
    expect(defaultRoomSettings.maxPlayers).toBe(limits.room.playerSoftCap);
    expect(defaultRoomSettings.maxSpectators).toBe(limits.room.spectatorSoftCap);
  });

  it("bounds both budgets by limits, which a host cannot lift", () => {
    expect(
      roomSettingsSchema.safeParse({ ...settings, maxPlayers: limits.room.playerHardCap }).success,
    ).toBe(true);
    expect(
      roomSettingsSchema.safeParse({ ...settings, maxPlayers: limits.room.playerHardCap + 1 })
        .success,
    ).toBe(false);
    expect(
      roomSettingsSchema.safeParse({
        ...settings,
        maxSpectators: limits.room.spectatorHardCap + 1,
      }).success,
    ).toBe(false);
    // Zero spectators is a legal room (a private rehearsal); zero players is not a room.
    expect(roomSettingsSchema.safeParse({ ...settings, maxSpectators: 0 }).success).toBe(true);
    expect(roomSettingsSchema.safeParse({ ...settings, maxPlayers: 0 }).success).toBe(false);
  });
});

describe("the host's settings patch", () => {
  it("is sparse: one field at a time is the normal case", () => {
    expect(roomSettingsPatchSchema.parse({ hideJoinCode: true })).toEqual({ hideJoinCode: true });
    expect(roomSettingsPatchSchema.parse({ listing: "public" })).toEqual({ listing: "public" });
  });

  it("refuses an empty patch - a change that changes nothing is a client bug", () => {
    expect(roomSettingsPatchSchema.safeParse({}).success).toBe(false);
  });

  it("refuses a password patch - there is no password to set or clear", () => {
    expect(roomSettingsPatchSchema.safeParse({ password: "sequoia-2026" }).success).toBe(false);
    expect(roomSettingsPatchSchema.safeParse({ password: null }).success).toBe(false);
    expect(roomSettingsPatchSchema.safeParse({ entry: "open" }).success).toBe(false);
  });

  it("refuses the retired listing value and anything not on the list", () => {
    expect(roomSettingsPatchSchema.safeParse({ listing: "unlisted" }).success).toBe(false);
    expect(roomSettingsPatchSchema.safeParse({ visibility: "public" }).success).toBe(false);
    expect(roomSettingsPatchSchema.safeParse({ hostToken: "0".repeat(32) }).success).toBe(false);
  });

  it("allows clearing the host byline but never blanking the title", () => {
    expect(roomSettingsPatchSchema.safeParse({ hostLabel: "" }).success).toBe(true);
    expect(roomSettingsPatchSchema.safeParse({ title: "" }).success).toBe(false);
  });

  it("wraps the same patch for the HTTP door, so the two cannot drift", () => {
    expect(updateRoomSettingsRequestSchema.safeParse({ settings: { maxPlayers: 8 } }).success).toBe(
      true,
    );
    expect(updateRoomSettingsRequestSchema.safeParse({ maxPlayers: 8 }).success).toBe(false);
  });
});
