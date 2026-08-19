// Where the e2e suites find a browser.
//
// Explicit executable resolution instead of playwright's revision-matched download (the
// postinstall is deliberately blocked): E2E_CHROMIUM wins, then playwright's own install
// location if one exists, then the machine-provided /opt/pw-browsers/chromium. Shared by both
// suites so "no chromium" is one error message rather than two.
import { existsSync } from "node:fs";
import process from "node:process";
import { chromium } from "playwright";

export function chromiumExecutable(): string {
  const candidates = [
    process.env["E2E_CHROMIUM"],
    (() => {
      try {
        return chromium.executablePath();
      } catch {
        return undefined;
      }
    })(),
    "/opt/pw-browsers/chromium",
  ];
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== "" && existsSync(candidate)) return candidate;
  }
  throw new Error("no chromium found - set E2E_CHROMIUM to a chromium executable");
}

/** Sandboxing needs privileges dev containers often lack; these suites render only our app. */
export const chromiumLaunchArgs = ["--no-sandbox", "--disable-dev-shm-usage"];
