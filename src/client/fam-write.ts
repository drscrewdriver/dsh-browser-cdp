// src/client/fam-write.ts — 设置写入的乐观锁 + 重试（两条数据轨共用一个提交口）
//
// 背景：设置卡有两条写轨。原生轨（`configForms.get(ns)`）内部有串行写队列、从快照
// 取 revision、失败时自己做一次恢复读；桥轨（≤0.1.5 无 configForms → 自家
// webServer 的 describe/mutate）把 revision 随 mutate 发出去，失败时先把 describe
// 等到底再报 false。两条轨的 `set()` 都返回 `Promise<boolean>`，且**返回 false 之前
// scope 手里的 revision 已经是新的**——这正是重试能成立的前提。
//
// 为什么重试是安全的：宿主 settings 的 `mutate(ns, ops, expectedRevision)` 在
// revision 不匹配时拒写而不是覆盖（见宿主 packages/settings/settings/src/index.ts
// 的 write 路径）。所以重放的是「我自己这一次改动」，而不会踩掉别人的写入；
// 若冲突是因为字段真被别人改了，第二次尝试会带着新 revision 覆盖那个字段的值——
// 这是用户点开关的本意（我要这个值），不是丢更新。
//
// 预算用尽返回 false，由调用方回滚乐观态并亮提示；绝不静默失败。

/** 提交口最小面：`set` 返回宿主是否接受（两条轨同签名）。 */
export interface WriteScope {
  set(field: string, value: unknown): Promise<boolean> | boolean
}

export interface CommitOptions {
  /** 总尝试次数上限（含首次）。默认 3。 */
  attempts?: number
  /** 两次尝试之间的等待（毫秒）。默认 300——给桥轨的恢复读留出落地时间。 */
  retryMs?: number
  /** 注入计时器，测试里换成同步实现。 */
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise<void>((resolve) => { setTimeout(resolve, ms) })

/**
 * 提交一个字段写入，被拒（revision 冲突 / 瞬态故障）时有限次重试。
 * @param scope - 任一条数据轨的 scope（`set` 同签名）。
 * @param field - 顶层字段名。
 * @param value - 要落的值。
 * @param options - 预算与计时注入点。
 * @returns 宿主最终是否接受了这次写入。
 */
export function commitField(
  scope: WriteScope,
  field: string,
  value: unknown,
  options: CommitOptions = {},
): Promise<boolean> {
  const budget = Math.max(1, options.attempts ?? 3)
  const retryMs = options.retryMs ?? 300
  const sleep = options.sleep ?? defaultSleep
  let attempt = 0

  const again = (): Promise<boolean> => {
    attempt += 1
    if (attempt >= budget) return Promise.resolve(false)
    return sleep(retryMs).then(once)
  }

  const once = (): Promise<boolean> =>
    // scope.set 可能同步抛（桥轨 fetch 前的参数校验）、也可能 reject：两条都算
    // 一次失败尝试，绝不把异常漏到 React 事件回调里变成未处理拒绝。
    Promise.resolve()
      .then(() => scope.set(field, value))
      .then((ok) => (ok === true ? true : again()), again)

  return once()
}
