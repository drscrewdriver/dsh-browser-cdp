import { describe, it, expect } from "vitest";
import {
  STATUS_FACADE_SCRIPT,
  STATUS_FACADE_SENTINEL,
  parseStatusFacades,
} from "../src/index.ts";

// R2/R3 — the status probe is only as good as this parser: it decides whether
// `available` is true. These tests pin the sentinel contract and the
// "missing facade => 'undefined' string" normalization the criterion relies on.
describe("bcdp_status facade probe (R2/R3)", () => {
  it("parses the facade types from the sentinel line", () => {
    const stdout = `noise\n${STATUS_FACADE_SENTINEL}{"taskSpaces":"object","browser":"object","page":"object"}\n`;
    expect(parseStatusFacades(stdout)).toEqual({
      taskSpaces: "object",
      browser: "object",
      page: "object",
    });
  });

  it("uses the last sentinel line (a stale earlier line must not win)", () => {
    const stdout =
      `${STATUS_FACADE_SENTINEL}{"taskSpaces":"undefined","browser":"undefined","page":"undefined"}\n` +
      `${STATUS_FACADE_SENTINEL}{"taskSpaces":"object","browser":"object","page":"object"}\n`;
    expect(parseStatusFacades(stdout)).toMatchObject({ taskSpaces: "object", browser: "object" });
  });

  it("normalizes missing keys to the string 'undefined'", () => {
    expect(parseStatusFacades(`${STATUS_FACADE_SENTINEL}{"taskSpaces":"object"}`)).toEqual({
      taskSpaces: "object",
      browser: "undefined",
      page: "undefined",
    });
  });

  it("returns undefined when the sentinel or JSON payload is absent/broken", () => {
    expect(parseStatusFacades("just logs\n")).toBeUndefined();
    expect(parseStatusFacades(`${STATUS_FACADE_SENTINEL}not-json\n`)).toBeUndefined();
  });

  it("the script checks all three facades (same condition as real work)", () => {
    for (const name of ["taskSpaces", "browser", "page"]) {
      expect(STATUS_FACADE_SCRIPT).toContain(`typeof ${name}`);
    }
    expect(STATUS_FACADE_SCRIPT).toContain(STATUS_FACADE_SENTINEL);
  });

  // R4 — the Windows CLI emits CRLF; the payload must survive the trailing \r.
  it("tolerates CRLF line endings (Windows CLI)", () => {
    const stdout = `${STATUS_FACADE_SENTINEL}{"taskSpaces":"object","browser":"object","page":"object"}\r\n`;
    expect(parseStatusFacades(stdout)).toMatchObject({ taskSpaces: "object", browser: "object" });
  });
});
