import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";

// Version-line discipline guard: every dsh-facing version field in the two
// shipped manifests must tell the SAME story. Assertions are line-agnostic —
// the per-line VALUES are anchored by the lower bound of the shared peer
// range, never hardcoded — so the file passes verbatim on every line from
// master (0.16.x, open-ended ranges, no top-level engines.dsh) through the
// compat lines (two-sided rc-window ranges). Fields introduced by newer
// eras (top-level engines.dsh, dsh devDeps, publishConfig.tag, the
// "[DSH X.Y… line: …]" description marker) are asserted only when present.
//
// Catches the two failure modes that `npm test` otherwise misses:
//  1. a peer/engines/devDep field left on the previous host line after a
//     compat bump (npm ls cannot see it — optional peers never conflict);
//  2. dsh-plugin.json drifting out of sync with package.json.

const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const pluginJson = JSON.parse(await readFile(new URL("../dsh-plugin.json", import.meta.url), "utf8"));

const DSH_PEERS = Object.keys(pkg.peerDependencies).filter((k: string) => /^@deepseek-ai\/dsh-/.test(k));
const RANGES = DSH_PEERS.map((k: string) => pkg.peerDependencies[k]);
const RANGE = RANGES[0];
// Shared range lower bound, e.g. ">=0.2.0-rc.1 <0.2.1-0" or ">=0.1.2-rc.1" -> "0.2.0" / "0.1.2"
const LINE = (RANGE.match(/^>=(\d+\.\d+\.\d+)-rc\.\d+/) || [])[1] as string | undefined;

describe("manifest version-line discipline", () => {
  it("all dsh peers share one identical range", () => {
    expect(DSH_PEERS.length).toBeGreaterThanOrEqual(1);
    expect(new Set(RANGES).size).toBe(1);
  });

  it("the shared range is rc-anchored: two-sided (compat era) or open-ended (master era)", () => {
    expect(RANGE).toMatch(/^>=(?:\d+\.\d+\.\d+-rc\.\d+(?:\s+<\d+\.\d+\.\d+-0)?)$/);
    expect(LINE).toBeTruthy();
  });

  it("engines agree with the peer range — nested dsh.engines.dsh always; top-level engines.dsh when present", () => {
    expect(pkg.dsh?.engines?.dsh).toBe(RANGE);
    if (pkg.engines?.dsh !== undefined) expect(pkg.engines.dsh).toBe(RANGE);
  });

  it("dsh-tools devDep (typecheck fidelity), when present, agrees with the peer range", () => {
    if (pkg.devDependencies?.["@deepseek-ai/dsh-tools"] !== undefined) {
      expect(pkg.devDependencies["@deepseek-ai/dsh-tools"]).toBe(RANGE);
    }
  });

  it("dsh-sandbox devDep, when present, is not left on an older line than the range's line", () => {
    const sandbox = pkg.devDependencies?.["@deepseek-ai/dsh-sandbox"] as string | undefined;
    if (sandbox !== undefined && sandbox !== RANGE) {
      // Tilde/caret ranges are tolerated only if they still admit this line's rc.
      expect(sandbox.startsWith("^") || sandbox.startsWith("~")).toBe(true);
    }
  });

  it("every dsh peer stays optional (hosts without the peer must still load)", () => {
    for (const k of DSH_PEERS) expect(pkg.peerDependenciesMeta?.[k]?.optional).toBe(true);
  });

  it("react peer is untouched by host-line bumps", () => {
    expect(pkg.peerDependencies?.react).toBe("^18.2.0");
  });

  it("dsh-plugin.json version is in lockstep with package.json", () => {
    expect(pluginJson.version).toBe(pkg.version);
  });

  it("description names this line; compat-era lines also point older hosts to the previous line", () => {
    const description = pkg.description as string;
    expect(description).toContain(LINE);
    if (/\[DSH [^\]]*line:/.test(description)) {
      expect(description).toMatch(/use the \d+\.\d+\.x line/);
    }
  });

  it("publishConfig.tag, when present, keeps the dsh-X.Y.Z shape (may lag the line: release passes --tag explicitly)", () => {
    if (pkg.publishConfig?.tag !== undefined) {
      expect(pkg.publishConfig.tag).toMatch(/^dsh-\d+\.\d+\.\d+$/);
    }
  });
});
