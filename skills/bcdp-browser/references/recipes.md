# 配方

按需读。每个配方都是"一次调用只做一件事"的排布，不要合并。

## 填一份表单

```
1. bcdp_navigate {url, wait:true}
2. bcdp_snapshot                        → 找候选字段的 loc=
3. bcdp_fill {selector:'loc=...', text:'...'}   （逐个字段，一次一个）
4. bcdp_check {selector:'loc=...', checked:true} / bcdp_select {selector, value}
5. bcdp_click {selector:'loc=...'}      → 点提交（单独一次）
6. bcdp_wait {op:'url', pattern:'success'} 或 {op:'response', pattern:'/api/submit'}
7. bcdp_snapshot 或 bcdp_page_info      → 确认真的成功了
```

要点：提交前确认每个字段都写进去了（回读一次成对字段），提交后**必须有一步验证**，不要凭 click 返回成功就报告完成。

## 多标签页

```
bcdp_tab {op:'list'}                    → 看现有标签
bcdp_tab {op:'new', url:'...'}          → 打开（会复用同 URL 的标签）
bcdp_tab {op:'current'}                 → 确认 agent 当前在哪个页
bcdp_tab {op:'switch', target:'...'}    → target 可传 targetId 或 URL 子串
bcdp_tab {op:'close', target:'...'}     → 不会关闭最后一个标签
```

注意：`tabbit-cli` 后端**没有标签枚举和窗口关闭**，`op=list/close` 会失败。这种活要换 CDP 端点或 ego 线。

## 上传 / 下载

- 上传：`bcdp_upload` 指定本地文件路径，不要用 `bcdp_js` 伪造 file input（伪造的往往被前端校验拦掉）。
- 下载：`bcdp_download`。`tabbit-cli` 后端**收不到下载事件**，需要真下载就换后端。
- 先确认触发动作（点击）与上传/下载的顺序，别把两者塞进同一次调用。

## iframe 内部

`bcdp_snapshot` 不保证覆盖跨域 iframe。优先：

1. 先 `bcdp_page_info` 看页面结构；
2. 覆盖不到就用 `bcdp_script`，在脚本里用 `page.frames()` 定位（**仅 ego 线可用**；tabbit 线没有 `taskSpaces` / `cdp()` / `fetch.*`，`page.frames()` 之外的 SDK 面也不全）。

## 分页取数

```
1. bcdp_js {expression:'...'}           → 抓当前页条目（只返回结构化数组 + 计数）
2. bcdp_click / bcdp_wait               → 翻页，一次一步
3. 重复，直到 计数不再增长 或 出现结束标记
```

要点：
- 每次只返回**本轮新增**的条目，不要每轮把累计结果整体回传（上下文会被自己撑爆）。
- 报"共 N 条"之前，必须有一次"最后一页为空/总数对得上"的验证。没验证就说"已翻到第 k 页，累计 N 条，未确认是否到底"。

## 视觉确认

- `bcdp_screenshot {selector:'loc=...'}` 只截局部，默认别截整页；
- 需要判断"长得对不对"时，截完直接看图，不要用 `bcdp_js` 读计算样式去猜。
