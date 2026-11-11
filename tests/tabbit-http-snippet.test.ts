import { describe, it, expect } from "vitest";
import { TABBIT_HTTP_BODY_CHARS, TABBIT_HTTP_CLIP_HINT, buildHttpSnippet } from "../src/cdp/tabbit-cli-link.ts";

// `bcdp_http` 实测的 4 次调用全部是「页面做不到或太贵」的场景：带 cookie 的 XHR
// 接口（12306 余票）与静态资源逆向（BOSS 直聘字体 CSS）。落地通道是 Tabbit 的
// `page.fetch`，它带着浏览器 profile 的 cookie / CORS / CSP。

describe("tabbit http snippet", () => {
  it("routes through page.fetch and returns status + body", () => {
    const js = buildHttpSnippet("https://x.test/api", { method: "GET" });
    expect(js).toContain("page.fetch");
    expect(js).toContain("status: __r.status");
    // page.fetch 返回 HTTP 元数据对象，文本在 .text 属性上，不是 Response.text()。
    expect(js).toContain("typeof __r.text");
    expect(js).not.toContain("__r.text()");
  });

  it("asks for text explicitly and passes ok through (4xx/5xx return ok:false, never throws)", () => {
    const js = buildHttpSnippet("https://x.test/api", { method: "GET" });
    expect(js).toContain(JSON.stringify({ method: "GET", as: "text" }));
    expect(js).toContain("ok: __r.ok !== false");
    expect(js).not.toContain("ok: true, status");
  });

  it("embeds the url and the init object via JSON.stringify", () => {
    const url = "https://x.test/api?t=1";
    const init = { method: "GET", headers: { Referer: "https://x.test/" } };
    const js = buildHttpSnippet(url, init);
    expect(js).toContain(JSON.stringify(url));
    expect(js).toContain(JSON.stringify({ ...init, as: "text" }));
  });

  it("escapes a url carrying quotes instead of interpolating it raw", () => {
    const url = 'https://x.test/a?q="1"';
    const js = buildHttpSnippet(url, {});
    expect(js).toContain(JSON.stringify(url));
    expect(js).not.toContain(`"${url}"`);
  });

  it("truncates the body at the shared budget and flags it", () => {
    const js = buildHttpSnippet("https://x.test/a", {});
    expect(js).toContain(`slice(0, ${TABBIT_HTTP_BODY_CHARS})`);
    expect(js).toContain("truncated: __clip");
  });

  it("gives a way out when the body gets clipped, not just a flag", () => {
    // 实测用例里有整份 CSS（找 @font-face）——那种响应远超上限，
    // 只报 truncated 会让模型拿残缺正文反复重试。
    const js = buildHttpSnippet("https://x.test/app.css", {});
    expect(js).toContain("__clip ? { hint:");
    expect(js).toContain(JSON.stringify(TABBIT_HTTP_CLIP_HINT));
    expect(TABBIT_HTTP_CLIP_HINT).toContain('as: "file"');
  });

  it("keeps only the init keys the caller supplied, plus as:text", () => {
    const js = buildHttpSnippet("https://x.test/a", { method: "POST", body: "b=1" });
    expect(js).toContain(JSON.stringify({ method: "POST", body: "b=1", as: "text" }));
    expect(js).not.toContain("headers");
  });
});
