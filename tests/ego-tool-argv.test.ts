import { describe, it, expect } from "vitest";
import { buildEgoToolArgv } from "../src/index.ts";

// R1 — the P0 regression guard. The probe and every tool run must build argv
// through this one function; if the `--sdk-path` injection is ever dropped from
// it again, every `ego-cli` + `useSdkPath` call crashes on line 1.
describe("buildEgoToolArgv (R1)", () => {
  it("injects --sdk-path for an ego-cli link that recorded one", () => {
    expect(buildEgoToolArgv(["/usr/local/bin/ego-browser"], { linkKind: "ego-cli", sdkPath: "/plugin/harness.js" }, ""))
      .toEqual(["/usr/local/bin/ego-browser", "nodejs", "--sdk-path", "/plugin/harness.js"]);
  });

  it("does not inject when the link has no sdkPath (vendored runtime or R-1 fallback)", () => {
    expect(buildEgoToolArgv([process.execPath, "/p/ego.mjs"], {}, ""))
      .toEqual([process.execPath, "/p/ego.mjs", "nodejs"]);
    expect(buildEgoToolArgv(["/usr/local/bin/ego-browser"], { linkKind: "ego-cli", sdkPath: "" }, ""))
      .toEqual(["/usr/local/bin/ego-browser", "nodejs"]);
  });

  it("keeps --sdk-path before user runtimeArgs and filters blocklisted control flags", () => {
    expect(buildEgoToolArgv(["/cli"], { linkKind: "ego-cli", sdkPath: "/p/h.js" }, "--status --foo=1 --bar"))
      .toEqual(["/cli", "nodejs", "--sdk-path", "/p/h.js", "--foo=1", "--bar"]);
  });
});
