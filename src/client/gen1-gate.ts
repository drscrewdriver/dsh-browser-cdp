// src/client/gen1-gate.ts — Gen-1（0.1.0/0.1.1）设置齿轮的代际门控谓词
//
// 背景（three-generation-settings-waist §0/§4，farm 实测 0.1.0-rc.8/0.1.1-rc.2）：
// Gen-1 宿主壳虽 compose 了 ui-settings* 模块，但无可达的原生设置页入口——
// 插件配置只能经 profile patch，或插件自带 UI。§4 的既有做法是挂 `shell.overlay`
// 浮窗齿轮承载整卡（free-search「老线由 shell.overlay 浮窗补位」同式）。
//
// 门控纪律：禁读宿主版本号，纯能力探测。齿轮只应出现在「无原生可达设置页」的线上：
//   - 0.1.7+/0.2.x：宿主有 `configForms` 服务（声明式设置页）→ 隐藏
//   - 0.1.2/0.1.5：宿主暴露 `settings/openSettingsDocument` remote（0.1.2-rc.1 起，
//     0.1.1-rc.2 源码无此 RPC）→ 隐藏（有可达设置页，Phase-2 的 settings.plugin.item 卡已覆盖）
//   - 两者皆缺 = 0.1.0/0.1.1 → 显示齿轮
// 抽出为纯函数以便单测覆盖三个真值组合，且「不确定即隐藏」（两信号任一存在即不显示），
// 宁可少挂也不与原生设置页重复。

/**
 * @param hasConfigForms 宿主是否提供 configForms 服务（0.1.7+ 声明式设置页标志）。
 * @param hasOpenSettingsDocument 宿主是否暴露 settings/openSettingsDocument remote（0.1.2+ 可达设置页标志）。
 * @returns 是否应挂 Gen-1 设置齿轮。仅在两信号都缺失（0.1.0/0.1.1）时为 true。
 */
export function shouldShowGen1SettingsGear(
  hasConfigForms: boolean,
  hasOpenSettingsDocument: boolean,
): boolean {
  return !hasConfigForms && !hasOpenSettingsDocument
}
