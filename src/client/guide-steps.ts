/**
 * dsh-browser-cdp 的首次使用引导文案（3 步；结构与措辞走 guide-kit 的统一契约）。
 *
 * 为什么单独一个文件：`guide.tsx` 是 `_tools/guide-kit/` 的**生成副本**（会被同步覆盖），
 * 本插件专属文案不能放在里面，否则下一次 sync 就没了。
 *
 * 术语来源（不在本文件自造译名）：
 * - 分组名 `工具封印 / 基础 / 截图与推流 / 评审`：`FAM_FIELD_GROUPS` 的 `zh/en`；
 * - `bcdp_status` / 懒注入 / 扩展能力：`src/client/index.ts` 的 `toolInjection`、`toolExtended` 字段组。
 */
import type { GuideLocale, GuideStep } from './guide.tsx'

export const BROWSER_CDP_GUIDE_STEPS: Partial<Record<GuideLocale, readonly GuideStep[]>> = {
  zh: [
    {
      title: '先连上一个浏览器',
      body: '「工具封印」下面的连接目标决定每一次 bcdp_* 调用打谁，顺序即优先级。ego / Tabbit / 本机 Chrome / 远端 CDP 任选其一，先探测再激活；列表为空时点「新建」填端点。',
    },
    {
      title: '工具是懒注入的，不要以为没装上',
      body: '默认只常驻 bcdp_status（它是解锁入口），其余工具在你第一次调用 bcdp_* 之后才铺开；闲置回收后又收起。想一挂载就全给，把「工具注入模式」改成 always。',
    },
    {
      title: 'agent 在动页面时你能看见',
      body: '右侧浮窗逐个页面显示网址、标题和实时截图；被驱动页面的右上角还会出现淡出角标。看到「检测到人机验证」就转人工处理，别硬刷。',
    },
  ],
  en: [
    {
      title: 'Attach a browser first',
      body: 'Under "Tool sealing", the connection targets decide who every bcdp_* call hits; order is priority. Pick ego / Tabbit / local Chrome / remote CDP, probe then activate; an empty list means "New" with an endpoint.',
    },
    {
      title: 'Tools are lazily injected, not missing',
      body: 'Only bcdp_status stays resident by default (it is the unlock entry); the rest arrive after your first bcdp_* call and are sealed back on idle reaping. Want everything at mount? Set "Injection mode" to always.',
    },
    {
      title: 'You can watch the agent drive pages',
      body: 'The right-hand bubble lists every live page with URL, title and a live thumbnail; the driven page also shows a fading corner badge. If you see "captcha detected", hand it back to a human instead of retrying.',
    },
  ],
}
