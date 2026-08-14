// The words a broken registry says. Tested because they are the fix instructions: the owner
// spent an evening with an empty lobby and no way to learn that a migration was missing.
import { describe, expect, it } from "vitest";
import { describeRegistryStatus, summarizeRegistryStatus } from "./registry-status.ts";

describe("describing the registry status", () => {
  it("stays quiet-toned and reassuring when the registry works", () => {
    const notice = describeRegistryStatus({ status: "ok" });
    expect(notice.tone).toBe("ok");
    expect(notice.fix).toBeNull();
  });

  it("names the exact migration command for the missing-table case", () => {
    const notice = describeRegistryStatus({ status: "unavailable", reason: "no-table" });
    expect(notice.tone).toBe("warning");
    expect(notice.fix).toContain("d1 migrations apply");
    // Rooms keep working without the lobby - saying so is what stops a false alarm.
    expect(notice.hint).toContain("joined by code");
  });

  it("explains that no binding means no rooms at all, not just no listing", () => {
    const notice = describeRegistryStatus({ status: "unavailable", reason: "no-binding" });
    expect(notice.hint).toContain("vite dev");
  });

  it("carries the raw D1 message as a tail, never as the headline", () => {
    const notice = describeRegistryStatus({
      status: "unavailable",
      reason: "error",
      detail: "D1_ERROR: database is locked",
    });
    expect(notice.detail).toBe("D1_ERROR: database is locked");
    expect(notice.headline).not.toContain("D1_ERROR");
  });
});

describe("the one-line form", () => {
  it("is loggable and includes the reason", () => {
    expect(summarizeRegistryStatus({ status: "ok" })).toBe("registry: ok");
    expect(
      summarizeRegistryStatus({ status: "unavailable", reason: "no-table", detail: "boom" }),
    ).toBe("registry: no-table - boom");
  });
});
