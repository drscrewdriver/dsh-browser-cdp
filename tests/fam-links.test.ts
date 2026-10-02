import { describe, it, expect } from "vitest";
import {
  addRow,
  applyProbe,
  buildCdpRow,
  buildCliRow,
  hasCliLink,
  isFull,
  isValidEndpoint,
  MAX_LINKS,
  moveRow,
  newLinkId,
  removeRow,
  updateRow,
  type FamLinkRow,
} from "../src/client/fam-links";
import * as dictionaries from "../src/client/locales";

function cdpRow(id: string, endpoint = "http://127.0.0.1:9222"): FamLinkRow {
  return {
    kind: "cdp", id, label: id, endpoint, enabled: true, note: "",
    probeStatus: "unknown", probeLatencyMs: 0, probeError: "", probeCode: "", probeAt: 0,
  };
}

function cliRow(id: string): FamLinkRow {
  return {
    kind: "ego-cli", id, label: id, cliPath: "", useSdkPath: false, enabled: true, note: "",
    probeStatus: "unknown", probeLatencyMs: 0, probeError: "", probeCode: "", probeAt: 0,
  };
}

describe("fam-links: builders write full-field rows", () => {
  it("buildCdpRow fills the probe five-piece so the settings write passes the union", () => {
    const row = buildCdpRow({ endpoint: " http://127.0.0.1:9222 " });
    expect(row.kind).toBe("cdp");
    expect(row.endpoint).toBe("http://127.0.0.1:9222");
    expect(row.label).toBe("http://127.0.0.1:9222"); // label falls back to the endpoint
    expect(row).toMatchObject({
      enabled: true, note: "",
      probeStatus: "unknown", probeLatencyMs: 0, probeError: "", probeCode: "", probeAt: 0,
    });
    expect(typeof row.id).toBe("string");
    expect(row.id!.length).toBeGreaterThan(0);
  });

  it("buildCdpRow keeps an explicit label", () => {
    expect(buildCdpRow({ label: " 台机 ", endpoint: "http://a:1" }).label).toBe("台机");
  });

  it("buildCliRow defaults useSdkPath=false and the label mirrors the host EGO_CLI_LABEL", () => {
    const row = buildCliRow({});
    expect(row.kind).toBe("ego-cli");
    expect(row.cliPath).toBe("");
    expect(row.useSdkPath).toBe(false);
    expect(row.label).toBe("本机 ego CLI");
  });

  it("ids never collide", () => {
    expect(newLinkId()).not.toBe(newLinkId());
  });
});

describe("fam-links: addRow mirrors the host upsert rejections", () => {
  it("appends a valid row without mutating the input array", () => {
    const links = [cdpRow("a")];
    const res = addRow(links, cdpRow("b"));
    expect(res.code).toBeUndefined();
    expect(res.links).toHaveLength(2);
    expect(res.links[1].id).toBe("b");
    expect(links).toHaveLength(1);
  });

  it("rejects a second ego-cli — the whole-array write bypasses upsertLink, this is the only guard", () => {
    const links = [cdpRow("a"), cliRow("cli1")];
    expect(hasCliLink(links)).toBe(true);
    const res = addRow(links, cliRow("cli2"));
    expect(res.code).toBe("ego-cli-already-exists");
    expect(res.links).toBe(links);
  });

  it("rejects at the host cap (MAX_LINKS mirrors MAX_TARGETS = 32)", () => {
    const links: FamLinkRow[] = Array.from({ length: MAX_LINKS }, (_, i) => cdpRow("r" + i));
    expect(isFull(links)).toBe(true);
    expect(addRow(links, cdpRow("x")).code).toBe("link-limit-reached");
    expect(isFull(links.slice(0, -1))).toBe(false);
  });

  it("refuses unusable cdp endpoints — they would pass the write and vanish on the next host resolve", () => {
    for (const bad of ["", "   ", "127.0.0.1:9222", "ftp://x"]) {
      expect(addRow([], buildCdpRow({ endpoint: bad })).code).toBe("unusable-row");
    }
    expect(addRow([], buildCdpRow({ endpoint: "ws://127.0.0.1:9222" })).code).toBeUndefined();
  });
});

describe("fam-links: edit/remove/move are pure and spread-safe", () => {
  it("updateRow spreads the original row — probe state survives a label edit", () => {
    const row: FamLinkRow = { ...cdpRow("a"), probeStatus: "ok", probeLatencyMs: 42 };
    const next = updateRow([row], "a", { label: "renamed" });
    expect(next[0].label).toBe("renamed");
    expect(next[0].probeStatus).toBe("ok");
    expect(next[0].probeLatencyMs).toBe(42);
    expect(next[0].endpoint).toBe("http://127.0.0.1:9222");
    expect(row.label).toBe("a"); // original untouched
  });

  it("updateRow with an unknown id changes nothing", () => {
    const links = [cdpRow("a")];
    expect(updateRow(links, "ghost", { label: "x" })).toEqual(links);
  });

  it("removeRow returns the removed row so the caller can clear the activation", () => {
    const links = [cdpRow("a"), cliRow("b")];
    const res = removeRow(links, "a");
    expect(res.links.map((r) => r.id)).toEqual(["b"]);
    expect(res.removed && res.removed.id).toBe("a");
    expect(removeRow(links, "ghost").removed).toBeUndefined();
  });

  it("moveRow swaps ±1 neighbours and is boundary-safe", () => {
    const links = [cdpRow("a"), cdpRow("b"), cdpRow("c")];
    expect(moveRow(links, "b", -1).map((r) => r.id)).toEqual(["b", "a", "c"]);
    expect(moveRow(links, "b", 1).map((r) => r.id)).toEqual(["a", "c", "b"]);
    expect(moveRow(links, "a", -1).map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(moveRow(links, "c", 1).map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(moveRow(links, "ghost", 1)).toBe(links);
  });
});

describe("fam-links: applyProbe writes the outcome back spread-safe", () => {
  it("failure records code/message/at and keeps the rest of the row; success clears the failure", () => {
    const links = [cdpRow("a")];
    const failed = applyProbe(links, "a", { ok: false, code: "econnrefused", message: "ECONNREFUSED" }, 1234);
    expect(failed[0]).toMatchObject({
      probeStatus: "error", probeCode: "econnrefused", probeError: "ECONNREFUSED", probeAt: 1234,
      label: "a", endpoint: "http://127.0.0.1:9222", enabled: true,
    });
    const okAgain = applyProbe(failed, "a", { ok: true, latencyMs: 7 }, 5678);
    expect(okAgain[0]).toMatchObject({
      probeStatus: "ok", probeLatencyMs: 7, probeError: "", probeCode: "", probeAt: 5678,
    });
  });
});

describe("isValidEndpoint: the card-side gate against silent row loss", () => {
  it("accepts http/https/ws/wss with an explicit scheme, case-insensitive, trimmed", () => {
    for (const good of ["http://127.0.0.1:9222", "HTTPS://x", "ws://127.0.0.1:9222", "wss://x/y", " http://a "]) {
      expect(isValidEndpoint(good)).toBe(true);
    }
  });
  it("rejects empty, scheme-less, foreign schemes and non-strings", () => {
    for (const bad of ["", "   ", "127.0.0.1:9222", "ftp://x", null, 42]) {
      expect(isValidEndpoint(bad)).toBe(false);
    }
  });
});

describe("locales: nine dictionaries share one key set (runtime parity alongside the compile gate)", () => {
  const names = ["zh", "en", "ja", "ko", "fr", "de", "it", "ru", "es"] as const;
  const dictOf = (name: (typeof names)[number]): Record<string, string> =>
    (dictionaries as unknown as Record<string, Record<string, string>>)[name];
  const zhKeys = Object.keys(dictOf("zh")).sort();

  it("every language exposes exactly the zh key set", () => {
    for (const name of names) {
      expect(Object.keys(dictOf(name)).sort()).toEqual(zhKeys);
    }
  });

  it("the links editor keys exist and keep their placeholders", () => {
    for (const name of names) {
      expect(dictOf(name)["linksLimitReached"]).toContain("{n}");
    }
  });
});
