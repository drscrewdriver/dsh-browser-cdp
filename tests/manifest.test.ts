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
// Exact-rc-enumeration strategy (双清单同串精确枚举纪律): the shared range is a
// `||`-joined list of explicit `X.Y.Z-rc.N` terms rather than a `>=…<…` window.
const ENUM_TERMS = RANGE.split("||").map((t: string) => t.trim());
const EXACT_ENUM =
  ENUM_TERMS.length > 1 &&
  ENUM_TERMS.every((t: string) => /^\d+\.\d+\.\d+(?:-rc\.\d+)?$/.test(t));
// Shared range lower bound, e.g. ">=0.2.0-rc.1 <0.2.1-0", ">=0.1.2-rc.1",
// ">=0.1.0-0 <0.3.0-0" or the first enum term "0.1.7-rc.1 || …"
// -> "0.2.0" / "0.1.2" / "0.1.0" / "0.1.7".
const LINE = (RANGE.match(/^>=(\d+\.\d+\.\d+)/) || RANGE.match(/^(\d+\.\d+\.\d+)/) || [])[1] as string | undefined;
// Detected range strategy. Segment/master ranges anchor to ONE host rc line;
// the unified strategy (branch unified/15rc) deliberately spans every line with a
// wide window so a single build serves them all -- there is no single "this line"
// to name in the description, so the line-naming assertion is strategy-aware.
const UNIFIED = /^>=\d+\.\d+\.\d+-0 <\d+\.\d+\.\d+-0$/.test(RANGE);

describe("manifest version-line discipline", () => {
  it("all dsh peers share one identical range", () => {
    expect(DSH_PEERS.length).toBeGreaterThanOrEqual(1);
    expect(new Set(RANGES).size).toBe(1);
  });

  it("the shared range is anchored: exact rc enumeration, rc-window (segment era), open-ended (master era) or unified cross-line window", () => {
    if (EXACT_ENUM) {
      expect(ENUM_TERMS.every((t: string) => /^\d+\.\d+\.\d+-rc\.\d+$/.test(t))).toBe(true);
    } else {
      expect(RANGE).toMatch(/^>=(?:\d+\.\d+\.\d+-rc\.\d+(?:\s+<\d+\.\d+\.\d+-0)?|\d+\.\d+\.\d+-0\s+<\d+\.\d+\.\d+-0)$/);
    }
    expect(LINE).toBeTruthy();
  });

  it("engines agree with the peer range — nested dsh.engines.dsh always; top-level engines.dsh when present", () => {
    expect(pkg.dsh?.engines?.dsh).toBe(RANGE);
    if (pkg.engines?.dsh !== undefined) expect(pkg.engines.dsh).toBe(RANGE);
  });

  it("dsh-tools devDep (typecheck fidelity), when present, agrees with the peer range", () => {
    if (pkg.devDependencies?.["@deepseek-ai/dsh-tools"] !== undefined) {
      const dev = pkg.devDependencies["@deepseek-ai/dsh-tools"] as string;
      // unified era: devDeps stay on the newest line (typecheck fidelity only);
      // segment era: devDep must equal the shared range verbatim;
      // exact-enum era: a single-term pin on one of the enumerated rc is fidelity.
      expect(dev === RANGE || ENUM_TERMS.includes(dev) || /^>=0\.2\.0-rc\.\d+ <0\.2\.1-0$/.test(dev)).toBe(true);
    }
  });

  it("dsh-sandbox devDep, when present, is not left on an older line than the range's line", () => {
    const sandbox = pkg.devDependencies?.["@deepseek-ai/dsh-sandbox"] as string | undefined;
    if (sandbox !== undefined && sandbox !== RANGE) {
      // Tilde/caret ranges are tolerated only if they still admit this line's rc;
      // exact-enum era: a single-term pin onto an enumerated rc is equally current.
      expect(sandbox.startsWith("^") || sandbox.startsWith("~") || ENUM_TERMS.includes(sandbox) || /^>=0\.2\.0-rc\.\d+ <0\.2\.1-0$/.test(sandbox)).toBe(true);
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
    if (UNIFIED) {
      // Unified range serves every host line at once: no single line to name, so
      // the description instead declares the DSH coverage strategy.
      expect(description).toMatch(/DSH/);
      return;
    }
    expect(description).toContain(LINE);
    if (/\[DSH [^\]]*\bline\b/.test(description)) {
      expect(description).toMatch(/use the \d+\.\d+\.x line/);
    }
  });

  it("publishConfig.tag, when present, keeps the dsh-X.Y.Z shape (may lag the line: release passes --tag explicitly)", () => {
    if (pkg.publishConfig?.tag !== undefined) {
      expect(pkg.publishConfig.tag).toMatch(/^dsh-\d+\.\d+\.\d+$/);
    }
  });
});
