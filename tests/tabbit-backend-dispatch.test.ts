import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { apply } from "../src/index.ts";

/**
 * Tabbit 后端的分派级验证：不真跑浏览器，而是给 `apply()` 喂一个假宿主，
 * 把 `tabbit-cli` 收到的 argv 与 stdin（下发的 Playwright 片段）截获下来，
 * 并用罐头回执驱动 execute 的成功分支。
 *
 * 这一层比 builder 单测更接近真相：它能同时验证「片段内容」「参数拼装」
 * 「拒绝分支」和「返回形状」，而不依赖真浏览器在线。
 */
// cliPath 只要文件存在即可通过 resolveTabbitCli 的显式路径档，不必是真 CLI。
const CLI_STANDIN = fileURLToPath(new URL("../package.json", import.meta.url));

const mountTabbit = (initialPayload: Record<string, unknown> = { ok: true }) => {
  let payload = initialPayload;
  // 非 null 时，CLI 回执改为失败形态（走 parseTabbitReceipt 的 failed 分支）。
  let failure: { code: string; message: string } | null = null;
  // 非 null 时，nodejs 回执改为降级形态，`resource` 按 pages 逐页回。
  let overflow: { resourceId: string; byteLength: number; pages: Array<{ data: string; nextOffset: number; eof: boolean }> } | null = null;
  let overflowPage = 0;
  const handles = new Map<string, any>();
  const calls: Array<{ argv: string[]; stdin: string }> = [];
  const reader = (text: string) => ({ readFrom: () => ({ text, nextOffset: text.length, lossy: false }) });
  const ctx: any = {
    tools: {
      register: (tool: any) => {
        handles.set(tool.name, tool);
        return () => {};
      },
    },
    subprocess: {
      spawn: (req: any) => {
        const argv = (req?.argv ?? []) as string[];
        calls.push({ argv, stdin: (req?.stdio?.stdin?.data ?? "") as string });
        // tabbit-cli 的回执：成功时 {status, result:{value}}；溢出时 result 只有
        // resourceId + byteLength，值要走 `resource` 子命令拿。
        if (argv[1] === "resource") {
          const page = overflow?.pages[overflowPage];
          if (overflow) overflowPage += 1;
          const chunk = page ?? { data: "", nextOffset: 0, eof: false };
          return {
            done: Promise.resolve({ exitCode: 0, signal: null }),
            collected: { stdout: reader(JSON.stringify(chunk)), stderr: reader("") },
          };
        }
        let text: string;
        if (failure !== null) {
          text = JSON.stringify({ ok: false, status: "failed", error: failure });
        } else if (overflow !== null) {
          text = JSON.stringify({ status: "succeeded", result: { resourceId: overflow.resourceId, byteLength: overflow.byteLength, elapsedMs: 1, requestId: "x" } });
        } else {
          text = JSON.stringify({ status: "succeeded", result: { value: payload } });
        }
        const failed = failure !== null;
        return {
          done: Promise.resolve({ exitCode: failed ? 70 : 0, signal: null }),
          collected: { stdout: reader(text), stderr: reader("") },
        };
      },
    },
    on: () => () => {},
    effect: (fn: () => unknown) => {
      try {
        fn();
      } catch {
        /* 替身不为难子模块 */
      }
    },
    logger: { info() {}, warn() {}, error() {} },
  };
  apply(ctx, {
    toolInjection: "always",
    links: [{ id: "tb", kind: "tabbit-cli", label: "Tabbit", enabled: true, cliPath: CLI_STANDIN }],
    activeTargetId: "tb",
  } as never);
  const run = async (name: string, args: Record<string, unknown>) => {
    const before = calls.length;
    const value = await handles.get(name).execute(args, {});
    return { value, call: calls[calls.length - 1], spawned: calls.length > before };
  };
  return { run, handles, calls, setPayload: (p: Record<string, unknown>) => { payload = p }, setFailure: (f: { code: string; message: string } | null) => { failure = f }, setOverflow: (o: typeof overflow) => { overflow = o; overflowPage = 0 } };
};

describe("bcdp_js on the tabbit backend", () => {
  it("runs the expression through tabbit-cli nodejs and returns result", async () => {
    const { run } = mountTabbit({ ok: true, result: "Hello" });
    const { value, call, spawned } = await run("bcdp_js", { expression: "document.title" });
    expect(spawned).toBe(true);
    // argv[0] 是 launcher 路径，命令字从 argv[1] 起。
    expect(call.argv[0]).toBe(CLI_STANDIN);
    expect(call.argv.slice(1, 3)).toEqual(["nodejs", "--task"]);
    expect(call.stdin).toContain("page.evaluate");
    expect(call.stdin).toContain("(() => (document.title))()");
    expect(value).toMatchObject({ ok: true, result: "Hello", backend: "tabbit-playwright" });
  });

  it("refuses an empty expression without touching the CLI", async () => {
    const { run } = mountTabbit();
    const { value, spawned } = await run("bcdp_js", { expression: "" });
    expect(spawned).toBe(false);
    expect(value).toMatchObject({ ok: false, text: "bcdp_js: expression is required" });
  });

  it("returns the CLI error message when the evaluation itself fails", async () => {
    // 真机典型形态：页面导航未完成、选择器报 ReferenceError 等。
    const m = mountTabbit();
    m.setFailure({ code: "EXECUTION_FAILED", message: "ReferenceError: __x is not defined" });
    const { value } = await m.run("bcdp_js", { expression: "__x" });
    expect(value).toMatchObject({ ok: false, backend: "tabbit-playwright" });
    expect(String(value.text)).toContain("__x is not defined");
  });
});

describe("bcdp_http on the tabbit backend", () => {
  it("sends mode=browser through page.fetch (carries the profile's cookies)", async () => {
    const { run } = mountTabbit({ ok: true, status: 200, body: "[]", truncated: false });
    const { value, call } = await run("bcdp_http", {
      url: "https://kyfw.12306.cn/otn/leftTicket/queryZ",
      headers: { Referer: "https://kyfw.12306.cn/otn/leftTicket/init" },
    });
    expect(call.stdin).toContain("page.fetch");
    expect(call.stdin).toContain(JSON.stringify({ method: "GET", headers: { Referer: "https://kyfw.12306.cn/otn/leftTicket/init" }, as: "text" }));
    expect(value).toMatchObject({ ok: true, status: 200, body: "[]", backend: "tabbit-playwright" });
  });

  it("lets an HTTP-level failure surface as ok:false instead of swallowing it", async () => {
    // page.fetch 对 4xx/5xx 返回 ok:false 而不抛——必须透传给模型。
    const { run } = mountTabbit({ ok: false, status: 404, body: "", truncated: false });
    const { value } = await run("bcdp_http", { url: "https://x.test/gone" });
    expect(value).toMatchObject({ ok: false, status: 404 });
  });

  it("explains CORS when a cross-origin page.fetch gets refused", async () => {
    // 真机实测：页面已导航到另一域名后抓原域接口，浏览器只报 Failed to fetch。
    const m = mountTabbit();
    m.setFailure({ code: 'EXECUTION_FAILED', message: 'page.evaluate: TypeError: Failed to fetch' });
    const { value } = await m.run("bcdp_http", { url: "https://other.example/api" });
    expect(value).toMatchObject({ ok: false });
    expect(String(value.text)).toContain('Failed to fetch');
    expect(String(value.text)).toContain('CORS/CSP');
  });

  it("refuses mode=server instead of silently downgrading it", async () => {
    const { run } = mountTabbit();
    const { value, spawned } = await run("bcdp_http", { url: "https://x.test/a", mode: "server" });
    expect(spawned).toBe(false);
    expect(String(value.text)).toContain("mode=server is unavailable");
    expect(String(value.text)).toContain("mode=browser");
  });

  it("refuses an empty url without touching the CLI", async () => {
    const { run } = mountTabbit();
    const { value, spawned } = await run("bcdp_http", { url: "" });
    expect(spawned).toBe(false);
    expect(value).toMatchObject({ ok: false, text: "bcdp_http: url is required" });
  });
});

describe("bcdp_script on the tabbit backend", () => {
  it("wraps the body so console.log still yields stdout", async () => {
    const { run } = mountTabbit({ stdout: '{"a":1}', result: { a: 1 } });
    const { value, call } = await run("bcdp_script", { script: "console.log(JSON.stringify({a:1}));" });
    expect(call.stdin).toContain("__lines.push");
    expect(call.stdin).toContain("console.log(JSON.stringify({a:1}));");
    expect(value).toMatchObject({ ok: true, stdout: '{"a":1}', result: { a: 1 }, backend: "tabbit-playwright" });
  });

  it("refuses verbatim:true, which only means something on the ego heredoc runtime", async () => {
    const { run } = mountTabbit();
    const { value, spawned } = await run("bcdp_script", { script: "return 1;", verbatim: true });
    expect(spawned).toBe(false);
    expect(String(value.text)).toContain("verbatim:true is ego-only");
  });

  it("names the ego SDK globals when a script reaches for them", async () => {
    const { run } = mountTabbit({ error: "taskSpaces is not defined" });
    const { value } = await run("bcdp_script", { script: "await taskSpaces.useOrCreate('x');" });
    expect(value).toMatchObject({ ok: false });
    // 输出 schema 是 strict 的：走 error/stdout，不能自创 text、也不能缺 required 的 stdout。
    expect(String(value.error)).toContain("taskSpaces is not defined");
    expect(String(value.error)).toContain("browser Playwright runtime");
    expect(value.stdout).toBe("");
    expect(value).toHaveProperty("result");
  });
});

describe("tabbit output contract conformance", () => {
  // bcdp_status 与 bcdp_script 用各自的严格 schema（additionalProperties:false）。
  // 这两个曾因为返回 `backend`/`raw`/`text` 这类未声明 key、或漏掉 required 的 stdout
  // 而被宿主拒成「输出不可用」——这里按分支逐一对着声明表核，新增 key 必须先登记。
  const DECLARED: Record<string, string[]> = {
    bcdp_status: ["ok", "available", "path", "exitCode", "backend", "raw", "backendKind", "toolFace", "guidance", "facades", "error"],
    bcdp_script: ["ok", "stdout", "stderr", "output", "result", "durationMs", "timedOut", "error", "backend", "resultTruncated", "hint"],
  };

  const check = (tool: string, label: string, value: any) => {
    const declared = new Set(DECLARED[tool]);
    expect(Object.keys(value).filter((k) => !declared.has(k)), `${label} 发了未声明的 key`).toEqual([]);
    if (tool === "bcdp_script") {
      expect(value.stdout, `${label} 的 required stdout`).toBeTypeOf("string");
      expect(value, `${label} 缺 result`).toHaveProperty("result");
    }
  };

  it("bcdp_status stays in contract on the tabbit diagnose path", async () => {
    const { run } = mountTabbit();
    const { value } = await run("bcdp_status", {});
    check("bcdp_status", "diagnose path", value);
  });

  it("bcdp_script stays in contract on every branch", async () => {
    const inline = mountTabbit({ stdout: "a", result: { marker: 1 } });
    check("bcdp_script", "inline success", (await inline.run("bcdp_script", { script: "x" })).value);

    const overflow = mountTabbit();
    overflow.setOverflow({
      resourceId: "r-1",
      byteLength: 900000,
      pages: [{ data: JSON.stringify({ stdout: "p", result: {} }), nextOffset: 40, eof: false }],
    });
    const overflowValue = (await overflow.run("bcdp_script", { script: "x" })).value;
    expect(overflowValue.resultTruncated, "溢出分支应上报截断").toBe(true);
    check("bcdp_script", "overflow success", overflowValue);

    const evalErr = mountTabbit({ error: "boom" });
    check("bcdp_script", "evaluation error", (await evalErr.run("bcdp_script", { script: "x" })).value);

    const cliFail = mountTabbit();
    cliFail.setFailure({ code: "TIMEOUT", message: "hard deadline" });
    const failValue = (await cliFail.run("bcdp_script", { script: "x" })).value;
    expect(failValue.ok, "CLI 失败应报 ok:false").toBe(false);
    check("bcdp_script", "cli failure", failValue);
  });
});

describe("bcdp_snapshot on the tabbit backend", () => {
  it("lifts the text out of observe's snapshot field (not String(object))", async () => {
    // docs.mjs 契约：observe 返回对象，文本在 snapshot。旧写法会得到 [object Object]。
    const { run } = mountTabbit({ snapshot: '- heading "Hi"\n- button "Save"', truncated: false });
    const { value, call } = await run("bcdp_snapshot", {});
    expect(call.stdin).toContain('typeof __o.snapshot === "string"');
    expect(value).toMatchObject({ ok: true, text: '- heading "Hi"\n- button "Save"', backend: 'tabbit-playwright' });
    expect(String(value.text)).not.toContain("[object Object]");
    expect(value.truncated).toBeUndefined();
  });

  it("carries the truncation flag when the snapshot was clipped", async () => {
    const { run } = mountTabbit({ snapshot: "partial", truncated: true });
    const { value } = await run("bcdp_snapshot", { maxChars: 120 });
    expect(value).toMatchObject({ ok: true, text: "partial", truncated: true });
  });

  it("clamps maxChars into the vendor-accepted range and echoes the effective value", async () => {
    // 真机原错：observe maxChars must be an integer from 256 through 20000。
    const hi = await mountTabbit({ snapshot: "s", truncated: false });
    const big = await hi.run("bcdp_snapshot", { maxChars: 999999 });
    expect(big.call.stdin).toContain("maxChars: 20000");
    expect(big.value).toMatchObject({ ok: true, maxCharsUsed: 20000 });

    const lo = await mountTabbit({ snapshot: "s", truncated: false });
    const small = await lo.run("bcdp_snapshot", { maxChars: 3 });
    expect(small.call.stdin).toContain("maxChars: 256");
    expect(small.value).toMatchObject({ ok: true, maxCharsUsed: 256 });

    // 区间内不加噪：不回显 maxCharsUsed。
    const mid = await mountTabbit({ snapshot: "s", truncated: false });
    const ok = await mid.run("bcdp_snapshot", { maxChars: 8000 });
    expect(ok.call.stdin).toContain("maxChars: 8000");
    expect(ok.value.maxCharsUsed).toBeUndefined();
  });

  it("surfaces the read-back cap instead of an empty body when the result overflowed", async () => {
    const m = mountTabbit();
    // 降级回执：没有 value，只有 resourceId + byteLength（真实形状）；
    // 只给一页且 eof:false 后接空块 → 读回不完整 → 必须显式上报截断。
    m.setOverflow({
      resourceId: "result-x",
      byteLength: 900000,
      pages: [{ data: JSON.stringify({ snapshot: "s", truncated: false }), nextOffset: 40, eof: false }],
    });
    const { value } = await m.run("bcdp_snapshot", {});
    expect(value).toMatchObject({ ok: true, text: "s", resultTruncated: true });
    expect(String(value.hint)).toContain("artifactPath");
  });
});

describe("snapshot refs on the tabbit backend", () => {
  it("clicks a snapshot ref via aria-ref + normalize", async () => {
    const { run } = mountTabbit({ clicked: true, normalized: true });
    const { value, call } = await run("bcdp_click", { selector: "@e3" });
    expect(call.stdin).toContain('page.locator("aria-ref=e3")');
    expect(call.stdin).toContain(".normalize()");
    expect(call.stdin).toContain("await el.click();");
    expect(value).toMatchObject({ ok: true, clicked: true, normalized: true });
  });

  it("fills a role locator without normalize", async () => {
    const { run } = mountTabbit({ filled: true, normalized: false });
    // 工具面的必填名是 text（不是 value）。
    const { value, call } = await run("bcdp_fill", { selector: 'loc=role:textbox[name="City"]', text: "HZ" });
    expect(call.stdin).toContain('page.getByRole("textbox", {name: "City", exact: true})');
    expect(call.stdin).not.toContain(".normalize()");
    expect(call.stdin).toContain('await el.fill("HZ");');
    expect(value).toMatchObject({ ok: true, filled: true });
  });

  it("explains the accepted selector formats when a ref cannot be resolved", async () => {
    const { run } = mountTabbit();
    const { value, spawned } = await run("bcdp_click", { selector: "@weird" });
    expect(spawned).toBe(false);
    expect(String(value.text)).toContain("loc=role:");
    expect(String(value.text)).toContain("@e3");
  });
});

describe("tools the tabbit channel cannot translate", () => {
  // kind 闸的本职：翻译不了的工具根本不进注入面——比「注入了、一调就报错」更好，
  // 模型不会看到一条它永远走不通的入口。
  it("bcdp_cdp is not even registered while tabbit is the activated channel", () => {
    const { handles } = mountTabbit();
    expect(handles.get("bcdp_cdp")).toBeUndefined();
  });

  it("bcdp_download and bcdp_wait are not registered either", () => {
    const { handles } = mountTabbit();
    expect(handles.get("bcdp_download")).toBeUndefined();
    expect(handles.get("bcdp_wait")).toBeUndefined();
  });

  it("the tools that ARE registered on tabbit all answer on the tabbit channel", async () => {
    // 防漂移：注册了的工具必须真的走 tabbit 分派（返回体里带 backend 标记），
    // 否则就是「kind 表说支持、代码其实还在跑 ego」的静默错配。
    const { run } = mountTabbit({ ok: true, result: 1 });
    for (const [name, args] of [
      ["bcdp_navigate", { url: "https://example.com" }],
      ["bcdp_snapshot", {}],
      ["bcdp_click", { selector: "@e3" }],
      ["bcdp_js", { expression: "1+1" }],
      ["bcdp_script", { script: "return 1;" }],
    ] as Array<[string, Record<string, unknown>]>) {
      const { value } = await run(name, args);
      expect(String(value.backend), name).toContain("tabbit");
    }
  });
});

describe("bcdp_help / bcdp_doctor reachability on tabbit", () => {
  // 这两个工具是宿主侧 defineTool 注册的，不经过 tabbit 分派闸——它们的通道
  // 感知由自己的路径提供。这里把该边界显式钉住：kind 收窄的说明必须能在
  // topic=injection 里读到（否则工具消失后模型无从解释）。
  it("bcdp_help topic=injection explains the channel (kind) gate", async () => {
    const { run } = mountTabbit();
    const { value } = await run("bcdp_help", { topic: "injection" });
    expect(String(value.text)).toContain("ACTIVATED CHANNEL");
    expect(String(value.text)).toContain("bcdp_js");
    expect(String(value.text)).toContain("not narrowed by kind");
  });

  it("bcdp_doctor stays usable on tabbit and reports the injection face", async () => {
    const { run } = mountTabbit();
    const { value } = await run("bcdp_doctor", {});
    expect(value.ok).toBe(true);
    expect(String(value.report)).toContain("tool injection");
  });
});

describe("bcdp_status reports the channel and the injection face", () => {
  it("carries backendKind, toolFace and the sealed-tool guidance on tabbit", async () => {
    const { run } = mountTabbit();
    const { value } = await run("bcdp_status", {});
    expect(value).toMatchObject({ backendKind: "tabbit-cli" });
    expect(typeof value.toolFace.live).toBe("number");
    expect(typeof value.toolFace.sealed).toBe("number");
    // 工具「不在列表」时唯一的解释渠道：说明哪些被 kind 收窄了、怎么兜底。
    expect(String(value.guidance)).toContain("sealed (not broken)");
    expect(String(value.guidance)).toContain("bcdp_js");
  });

  it("answers availability from tabbit-cli diagnose, not from the ego facade probe", async () => {
    // 真机跑时发现：tabbit 激活时 status 若走内置运行时探针，available 答的
    // 是一条根本没被驱动的通道。现在它必须走 diagnose。
    const { run, calls } = mountTabbit();
    const { value } = await run("bcdp_status", {});
    const diagCall = calls.find((c) => c.argv.includes("diagnose"));
    expect(diagCall, "expected a tabbit-cli diagnose call").toBeDefined();
    expect(value).toMatchObject({ backend: "tabbit-cli", available: true });
    expect(value).not.toHaveProperty("facades");
  });

  it("toolFace matches the tools actually registered on the host", async () => {
    // 两个不变量：live 就是真实注册面；live+sealed 等于全量工具表。
    // （kind 闸生效后 tabbit 上只会注册支持面内的工具，这正是收窄的直证。）
    const { run, handles } = mountTabbit();
    const { value } = await run("bcdp_status", {});
    expect(handles.size).toBe(value.toolFace.live);
    expect(value.toolFace.live + value.toolFace.sealed).toBe(35);
    expect(handles.has("bcdp_cdp")).toBe(false);
    expect(handles.has("bcdp_download")).toBe(false);
  });
});
