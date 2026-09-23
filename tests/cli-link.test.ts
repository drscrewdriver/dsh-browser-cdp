import { describe, it, expect } from "vitest";
import {
  CLI_READY_SENTINEL,
  MACOS_APP_BUNDLE_CLI,
  isShapeClassSpawnError,
  makeWhich,
  parseCliStatus,
  preferredShape,
  probeCliLink,
  resolveCliBinary,
  spawnArgvFor,
  type CliLinkIo,
  type CliRunRequest,
  type CliRunResult,
} from "../src/cdp/cli-link.ts";

/** A result, or a function of the request so a test can script argv-sensitively. */
type Scripted = CliRunResult | ((req: CliRunRequest) => CliRunResult);

const OK_STATUS = (running: boolean): CliRunResult => ({
  exitCode: 0, stdout: JSON.stringify({ running, port: 9222 }), stderr: "", latencyMs: 5,
});
const READY: CliRunResult = { exitCode: 0, stdout: `${CLI_READY_SENTINEL}\n`, stderr: "", latencyMs: 7 };

function fakeIo(options: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  files?: string[];
  runs?: Scripted[];
  defaultRun?: Scripted;
} = {}) {
  const files = new Set(options.files ?? []);
  const calls: CliRunRequest[] = [];
  const runs = [...(options.runs ?? [])];
  let ticks = 0;
  const fallback: Scripted = options.defaultRun ?? READY;
  const io: CliLinkIo = {
    platform: options.platform ?? "linux",
    exists: (p) => files.has(p),
    which: makeWhich(options.platform ?? "linux", options.env ?? { PATH: "" }, (p) => files.has(p)),
    now: () => (ticks += 10),
    run: async (request) => {
      calls.push(request);
      const next = runs.length > 0 ? runs.shift()! : fallback;
      return typeof next === "function" ? next(request) : next;
    },
  };
  return { io, calls, files, append: (s: Scripted) => runs.push(s) };
}

describe("R7 resolveCliBinary — four-step chain", () => {
  const bundled = "/plugin/runtime/ego-linux/bin/ego-browser.mjs";

  it("prefers an explicit path that exists", () => {
    const io = fakeIo({ files: ["/custom/cli", bundled] }).io;
    expect(resolveCliBinary({ cliPath: "/custom/cli", bundled }, io)).toMatchObject({ ok: true, origin: "explicit", path: "/custom/cli" });
  });

  it("refuses a missing explicit path instead of silently falling through", () => {
    const io = fakeIo({ env: { PATH: "/usr/local/bin" }, files: ["/usr/local/bin/ego-browser", bundled] }).io;
    const out = resolveCliBinary({ cliPath: "/nope/cli", bundled }, io);
    expect(out.ok).toBe(false);
    expect(out.code).toBe("cli-not-found");
    expect(out.message).toContain("/nope/cli");
  });

  it("takes ego-browser from PATH when nothing explicit is set", () => {
    const io = fakeIo({ env: { PATH: "/usr/local/bin" }, files: ["/usr/local/bin/ego-browser", bundled] }).io;
    const out = resolveCliBinary({ bundled }, io);
    expect(out).toMatchObject({ ok: true, origin: "path", path: "/usr/local/bin/ego-browser" });
  });

  it("falls back to the macOS app-bundle helper on darwin only", () => {
    const darwin = fakeIo({ platform: "darwin", files: [MACOS_APP_BUNDLE_CLI, bundled] }).io;
    expect(resolveCliBinary({ bundled }, darwin)).toMatchObject({ ok: true, origin: "app-bundle", path: MACOS_APP_BUNDLE_CLI });
    const linux = fakeIo({ platform: "linux", files: [MACOS_APP_BUNDLE_CLI, bundled] }).io;
    expect(resolveCliBinary({ bundled }, linux)).toMatchObject({ ok: true, origin: "bundled" });
  });

  it("reports cli-not-found when even the bundled runtime is gone", () => {
    const out = resolveCliBinary({ bundled }, fakeIo().io);
    expect(out.ok).toBe(false);
    expect(out.origin).toBe("");
    expect(out.message).toContain("ego-browser");
  });
});

describe("R7 spawn shape", () => {
  it("hints node for JS bundles and direct for everything else", () => {
    expect(preferredShape("/x/ego-browser.mjs")).toBe("node");
    expect(preferredShape("/x/dist/out/index.js")).toBe("node");
    expect(preferredShape("/Applications/ego lite.app/…/Helpers/ego-browser")).toBe("direct");
  });

  it("puts the node prefix only on the node shape", () => {
    expect(spawnArgvFor("node", "/x/cli.mjs", ["nodejs"])).toEqual([process.execPath, "/x/cli.mjs", "nodejs"]);
    expect(spawnArgvFor("direct", "/x/cli", ["nodejs"])).toEqual(["/x/cli", "nodejs"]);
  });

  it("treats EACCES / ENOEXEC / ENOENT as shape errors only", () => {
    for (const code of ["EACCES", "ENOEXEC", "ENOENT"]) expect(isShapeClassSpawnError(code)).toBe(true);
    for (const code of ["ETIMEDOUT", "EPIPE", undefined]) expect(isShapeClassSpawnError(code)).toBe(false);
  });
});

describe("R7 parseCliStatus — deliberately loose", () => {
  it("accepts a JSON object carrying a boolean running", () => {
    expect(parseCliStatus('{"running":true,"port":9222}')).toEqual({ ok: true, running: true });
    expect(parseCliStatus('{"running":false}')).toEqual({ ok: true, running: false });
  });

  it("rejects an unknown subcommand, junk and JSON without the boolean", () => {
    expect(parseCliStatus("unknown option '--status'")).toEqual({ ok: false });
    expect(parseCliStatus("{not json")).toEqual({ ok: false });
    expect(parseCliStatus('{"port":9222}')).toEqual({ ok: false });
    expect(parseCliStatus("")).toEqual({ ok: false });
  });
});

describe("R7 probeCliLink", () => {
  const bundled = "/plugin/ego-browser.mjs";

  it("probes the bundled JS port through node and reports ready", async () => {
    const f = fakeIo({
      files: [bundled],
      defaultRun: (req) => (req.argv.includes("--status") ? OK_STATUS(true) : READY),
    });
    const out = await probeCliLink({ bundled }, f.io);
    expect(out).toMatchObject({ ok: true, code: "", origin: "bundled", shape: "node", running: true });
    // exactly two processes: the --status round-trip (shape + state), then the
    // authoritative heredoc. The status read must NOT be a third spawn.
    expect(f.calls).toHaveLength(2);
    expect(f.calls[0]!.argv).toEqual([process.execPath, bundled, "--status"]);
    expect(f.calls[1]!.argv).toEqual([process.execPath, bundled, "nodejs"]);
    expect(f.calls[1]!.stdin).toContain(CLI_READY_SENTINEL);
  });

  it("drives a real executable directly, without a node prefix", async () => {
    const f = fakeIo({
      platform: "darwin",
      files: [MACOS_APP_BUNDLE_CLI],
      defaultRun: (req) => (req.stdin === "" ? OK_STATUS(false) : READY),
    });
    const out = await probeCliLink({ bundled: "", }, f.io);
    expect(out).toMatchObject({ ok: true, origin: "app-bundle", shape: "direct", running: false });
    expect(f.calls.every((c) => c.argv[0] === MACOS_APP_BUNDLE_CLI)).toBe(true);
  });

  it("flips the shape when the hint is wrong (JS file with no +x bit)", async () => {
    const cli = "/opt/ego-browser"; // no extension → hints direct, but it is a JS file
    const f = fakeIo({
      files: [cli],
      defaultRun: (req) => (req.argv[0] === process.execPath ? READY : { exitCode: null, stdout: "", stderr: "", spawnErrorCode: "EACCES", latencyMs: 1 }),
    });
    const out = await probeCliLink({ cliPath: cli, bundled: "" }, f.io);
    expect(out).toMatchObject({ ok: true, shape: "node" });
  });

  it("reports cli-not-executable when neither shape can start it", async () => {
    const cli = "/opt/broken";
    const f = fakeIo({ files: [cli], defaultRun: { exitCode: null, stdout: "", stderr: "nope", spawnErrorCode: "EACCES", latencyMs: 1 } });
    const out = await probeCliLink({ cliPath: cli, bundled: "" }, f.io);
    expect(out).toMatchObject({ ok: false, code: "cli-not-executable", shape: "" });
    expect(out.message).toContain("could not be started");
  });

  it("reports cli-not-found before touching a process", async () => {
    const f = fakeIo();
    const out = await probeCliLink({ cliPath: "/missing", bundled: "" }, f.io);
    expect(out).toMatchObject({ ok: false, code: "cli-not-found" });
    expect(f.calls).toHaveLength(0);
  });

  it("reports cli-probe-failed when the heredoc exits non-zero", async () => {
    const f = fakeIo({ files: [bundled], defaultRun: { exitCode: 1, stdout: "", stderr: "task space exploded", latencyMs: 3 } });
    const out = await probeCliLink({ bundled }, f.io);
    expect(out).toMatchObject({ ok: false, code: "cli-probe-failed" });
    expect(out.message).toContain("task space exploded");
  });

  it("reports cli-probe-timeout", async () => {
    const f = fakeIo({ files: [bundled], defaultRun: { exitCode: null, stdout: "", stderr: "", timedOut: true, latencyMs: 99 } });
    const out = await probeCliLink({ bundled }, f.io);
    expect(out).toMatchObject({ ok: false, code: "cli-probe-timeout" });
  });

  // A25 — `--status` is documented as a Linux-port command, so a CLI that has
  // never heard of it must still come out READY.
  it("degrades silently when --status is not supported (A25)", async () => {
    const f = fakeIo({
      files: [bundled],
      defaultRun: (req) =>
        req.argv.includes("--status")
          ? { exitCode: 2, stdout: "", stderr: "unknown option '--status'", latencyMs: 2 }
          : READY,
    });
    const out = await probeCliLink({ bundled }, f.io);
    expect(out).toMatchObject({ ok: true, code: "" });
    expect(out.running).toBeUndefined();
  });

  // A26 — `--sdk-path` is a capability, not a requirement: report it, drop it,
  // retry once, and still succeed.
  it("drops --sdk-path and retries once when the CLI refuses the flag (A26)", async () => {
    const f = fakeIo({
      files: [bundled],
      defaultRun: (req) => {
        if (req.argv.includes("--status")) return OK_STATUS(true);
        if (req.argv.includes("--sdk-path")) {
          return { exitCode: 2, stdout: "", stderr: "unknown option '--sdk-path'", latencyMs: 2 };
        }
        return READY;
      },
    });
    const out = await probeCliLink({ bundled, useSdkPath: true, sdkPath: "/plugin/harness.js" }, f.io);
    expect(out).toMatchObject({ ok: true, code: "" });
    expect(out.warning).toContain("--sdk-path");
    const heredocs = f.calls.filter((c) => c.stdin !== "");
    expect(heredocs).toHaveLength(2);
    expect(heredocs[0]!.argv).toContain("--sdk-path");
    expect(heredocs[1]!.argv).not.toContain("--sdk-path");
  });

  it("passes --sdk-path through when the CLI accepts it", async () => {
    const f = fakeIo({ files: [bundled], defaultRun: (req) => (req.argv.includes("--status") ? OK_STATUS(true) : READY) });
    const out = await probeCliLink({ bundled, useSdkPath: true, sdkPath: "/plugin/harness.js" }, f.io);
    expect(out.warning).toBeUndefined();
    expect(f.calls.filter((c) => c.stdin !== "")[0]!.argv).toEqual([process.execPath, bundled, "nodejs", "--sdk-path", "/plugin/harness.js"]);
  });
});
