# 恢复

## 工具突然全没了

正常。`lazy` 模式下闲置回收会把注入面收回成只剩 `bcdp_help`。再调一次 `bcdp_help` 就重新铺开——这不是插件坏了，也不要改设置。

## 连不上浏览器

```
bcdp_status {refresh:true}     → 重新探测并刷新状态
bcdp_doctor                    → 看连接列表、激活项、解析到的路径
```

`bcdp_doctor` 首行会写当前注入面（`mode=lazy browse=open ... live N / sealed M`）。看不到工具时先读这一行，别猜。

## 后端不对

设置面板里的连接列表是**有序**的，**被激活的那一项驱动每一次 `bcdp_*` 调用**。顺序即优先级。

- 切了后端之后，先 `bcdp_status` 确认 `backend:` 再干活；
- 激活 `tabbit-cli` 时插件会硬拒内置运行时启动（防止"以为在 Tabbit 里做、实际驱动了另一个浏览器"）；
- 同机不要同时用另一个 Tabbit 驱动（会抢同一个任务槽）。

## 人机验证 / 登录墙

```
bcdp_captcha                        → 检测并提示用户去窗口里手动完成
bcdp_wait_for_human {reason:'...'}  → 显式让权，等用户做完再继续
```

铁律：不猜密码、不绕验证、不重复提交。用户那边完成后，`bcdp_space {op:'takeover'}` 拿回控制权。

## Windows 上前台反复被抢

在 Windows 上频繁 `bcdp_tab {op:'switch'}` / `op:'new'` 可能把浏览器窗口反复提到最前，打断用户。

对策：把同一轮操作聚在一次调用里完成，减少切 tab 次数；需要长时间后台跑时先跟用户说一声。

## 选择器失效

- `@N` / `ref=N` 每次快照重新编号，**跨调用不可靠**；
- 重新 `bcdp_snapshot` 拿新的，或者从一开始就用 `loc=...`；
- 页面用 shadow DOM 时，`loc=` 也可能取不到，改用 `bcdp_script` 里 `page.locator()` 的深度穿透写法。

## 超时之后

1. **先核实状态**（`bcdp_snapshot` 看页面当前长什么样）；
2. 只有当确认"没生效"才重试；有副作用的操作（提交、支付、删除）尤其不能盲跑；
3. 需要更长预算时，`bcdp_script` 有 `timeoutMs`；`tabbit-cli` 的 CLI 级 `--timeout-ms` 被夹在 60000–180000，写小了会被抬上去。

## tabbit 通道专属

- `request-id` 是幂等的：同一个 id 重放返回原回执，不会重跑；
- 任务被 finish 后重建，会重置该任务的配额与 `globalThis` 状态；
- 没有 `Browser.*` / `Target.*` 域：标签枚举、窗口关闭、Overlay 点选、下载事件都不可用；
- 不支持 `verbatim`：`bcdp_script` 在 tabbit 线会拒绝该参数。

## 空间与并发

- 每个会话默认用**自己的**空间（`dsh-agent-<会话 id 前 8 位>`），并发会话互不干扰；
- **不要手动建 `#4`/`#5` 这类编号空间**；
- 确实要跨会话共享一个槽时才显式传 `space:'default'`；
- 登录态在磁盘 Profile 里跨重启保留（除非开了 `isolateSpaces` 内存沙盒）。
