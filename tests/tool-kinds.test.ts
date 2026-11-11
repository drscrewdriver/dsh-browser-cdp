import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import {
  KIND_TOOL_SUPPORT,
  TABBIT_CLI_SUPPORTED,
  backendKindOf,
  kindSupportsTool,
} from "../src/toolKinds.ts";
import { TIER_MEMBERS } from "../src/toolTiers.ts";
import { EGO_CLI_KIND, TABBIT_CLI_KIND, LP_KIND } from "../src/cdp-targets.ts";

/** src/index.ts 里 tryTabbitExecute 实际 case 的工具名（通道能力真值）。 */
const tabbitCaseNames = async (): Promise<string[]> => {
  const src = await readFile(new URL("../src/index.ts", import.meta.url), "utf8");
  const start = src.indexOf("async function tryTabbitExecute");
  expect(start).toBeGreaterThan(-1);
  const tail = src.slice(start);
  const end = tail.indexOf("\nfunction defineEgoTool");
  const body = end === -1 ? tail : tail.slice(0, end);
  return [...new Set([...body.matchAll(/case '(bcdp_[a-z0-9_]+)'/g)].map((m) => m[1]))];
};

const ALL_TIER_TOOLS = Object.values(TIER_MEMBERS).flat();

describe("kind table coverage", () => {
  it("keys cover every link kind constant", () => {
    const keys = Object.keys(KIND_TOOL_SUPPORT).sort();
    expect(keys).toEqual(["cdp", "ego-cli", "lightpanda", "none", "tabbit-cli"].sort());
    // 运行期常量与字面量保持一致（本模块刻意不 import cdp-targets）。
    expect(keys).toContain(EGO_CLI_KIND);
    expect(keys).toContain(TABBIT_CLI_KIND);
    expect(keys).toContain(LP_KIND);
  });

  it("cdp / ego-cli / lightpanda / none stay 'all' (zero behaviour change)", () => {
    for (const kind of ["cdp", "ego-cli", "lightpanda", "none"] as const) {
      expect(KIND_TOOL_SUPPORT[kind]).toBe("all");
    }
  });

  it("every tabbit-cli entry exists in the tier table (no typos)", () => {
    for (const name of TABBIT_CLI_SUPPORTED) {
      expect(ALL_TIER_TOOLS).toContain(name);
    }
    expect(TABBIT_CLI_SUPPORTED.length).toBe(13);
  });

  it("the tabbit-cli table never outgrows the tools index.ts actually handles", async () => {
    const cases = await tabbitCaseNames();
    // case 集合是子集上界：登记了 tool 但没接 case → 会被注入却必失败。
    for (const name of cases) {
      expect(TABBIT_CLI_SUPPORTED).toContain(name);
    }
  });

  it("tools that cannot work on tabbit-cli are excluded", () => {
    for (const name of [
      "bcdp_cdp",
      "bcdp_captcha",
      "bcdp_wait",
      "bcdp_wait_for_human",
      "bcdp_download",
      "bcdp_upload",
      "bcdp_dialog",
      "bcdp_key",
      "bcdp_scroll",
      "bcdp_auth_flush",
      "bcdp_login_import",
      "bcdp_jev_status",
      "bcdp_jev_ask",
      "bcdp_jev_frame",
      "bcdp_jev_run",
      "bcdp_jev_attempt",
    ]) {
      expect(kindSupportsTool(name, "tabbit-cli")).toBe(false);
    }
  });
});

describe("kindSupportsTool", () => {
  it("'all' kinds accept everything", () => {
    for (const kind of ["cdp", "ego-cli", "lightpanda", "none"] as const) {
      expect(kindSupportsTool("bcdp_jev_run", kind)).toBe(true);
      expect(kindSupportsTool("bcdp_cdp", kind)).toBe(true);
    }
  });

  it("tabbit-cli accepts exactly its supported set", () => {
    expect(kindSupportsTool("bcdp_js", "tabbit-cli")).toBe(true);
    expect(kindSupportsTool("bcdp_http", "tabbit-cli")).toBe(true);
    expect(kindSupportsTool("bcdp_script", "tabbit-cli")).toBe(true);
    expect(kindSupportsTool("bcdp_status", "tabbit-cli")).toBe(true);
    expect(kindSupportsTool("bcdp_jev_run", "tabbit-cli")).toBe(false);
  });
});

describe("backendKindOf", () => {
  it("maps known link kinds", () => {
    expect(backendKindOf("cdp")).toBe("cdp");
    expect(backendKindOf("ego-cli")).toBe("ego-cli");
    expect(backendKindOf("tabbit-cli")).toBe("tabbit-cli");
    expect(backendKindOf("lightpanda")).toBe("lightpanda");
  });

  it("treats missing activation as 'none' (all open)", () => {
    expect(backendKindOf(undefined)).toBe("none");
    expect(backendKindOf(null)).toBe("none");
    expect(backendKindOf("")).toBe("none");
  });

  it("falls back to 'cdp' for unknown kinds (never over-seal)", () => {
    expect(backendKindOf("something-new")).toBe("cdp");
  });
});
