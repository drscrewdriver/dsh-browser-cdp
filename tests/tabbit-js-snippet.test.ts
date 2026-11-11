import { describe, it, expect } from "vitest";
import { buildJsSnippet } from "../src/cdp/tabbit-cli-link.ts";

// `bcdp_js` 是历史调用量最高的工具（实测 313 次），而 Tabbit 通道此前直接拒绝它。
// 这几条断言守住落地时的三个前提：走 page.evaluate、包成 IIFE、表达式经
// JSON.stringify 转义（转义是防注入的唯一屏障，绝不能用 eval/new Function 去
// "验证"生成代码——那本身就是被禁止的写法）。

describe("tabbit js snippet", () => {
  it("evaluates through page.evaluate and returns the value", () => {
    const js = buildJsSnippet("document.title");
    expect(js).toContain("page.evaluate");
    expect(js).toContain("return { ok: true, result: __v };");
  });

  it("wraps the expression in an IIFE (a bare arrow would serialize as a function)", () => {
    expect(buildJsSnippet("document.title")).toContain("(() => (document.title))()");
  });

  it("escapes the expression through JSON.stringify, never interpolates it raw", () => {
    const expr = 'a + "q" + \'s\'';
    const js = buildJsSnippet(expr);
    expect(js).toContain(JSON.stringify(`(() => (${expr}))()`));
    // 原文里的裸引号不得出现在 snippet 中——出现了就说明逃出了字符串字面量。
    expect(js).not.toContain('a + "q"');
  });

  it("keeps a multi-line expression inside one escaped literal (two output lines)", () => {
    const js = buildJsSnippet("const a = 1;\nconst b = 2;\nreturn a + b;".replace("return ", ""));
    // builder 自己固定产出 2 行；表达式里的换行必须被转义成 \n 字面量。
    expect(js.split("\n").length).toBe(2);
    expect(js).toContain("\\n");
  });

  it("holds the line count steady no matter how many newlines the expression carries", () => {
    for (const expr of ["a\nb", "a\nb\nc\nd", "x = `\n`"]) {
      expect(buildJsSnippet(expr).split("\n").length).toBe(2);
    }
  });
});
