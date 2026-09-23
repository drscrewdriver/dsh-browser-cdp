/**
 * src/help.ts — tool index copy (EGO_HELP_INDEX).
 *
 * Pure data module: the `topic` lookup table for the bcdp_help tool. When you
 * add/change a tool, remember to sync an entry here or bcdp_help won't find it.
 */
export const EGO_HELP_INDEX: Record<string, string> = {
  overview:
    'CDP 浏览器代理：结构化浏览器工具。导航/交互/观察/表单/网络/等待/键鼠皆有专项工具，另提供 bcdp_help(本索引)、bcdp_doctor(体检)、bcdp_cli/bcdp_script(自由脚本逃生舱)。连接与激活见 topic=links。' +
    '分类见: tools / navigate / observe / input / keyboard-mouse / form / wait / network / login / script / doctor。用 `topic` 查询，或直接给工具名。',
  tools:
    '工具清单: bcdp_status, bcdp_space_open, bcdp_space_close, bcdp_snapshot, bcdp_navigate, bcdp_click(+double), bcdp_fill, bcdp_js, bcdp_cdp, bcdp_screenshot(+selector), bcdp_page_info, bcdp_wait, bcdp_wait_for_selector, bcdp_wait_for_url, bcdp_wait_for_response, bcdp_key(+text/type), bcdp_hover, bcdp_read_element, bcdp_select, bcdp_drag, bcdp_scroll, bcdp_upload, bcdp_check, bcdp_dialog, bcdp_download, bcdp_http, bcdp_captcha, bcdp_auth_flush, bcdp_login_import, bcdp_help, bcdp_doctor, bcdp_cli, bcdp_script, bcdp_jev_status, bcdp_jev_frame, bcdp_jev_ask, bcdp_jev_run。',
  links:
    '连接序列（设置面板）：有序列表，顺序即优先级，被激活的一项驱动每一次 bcdp_* 调用。两种类型——' +
    'CDP 端点（注入 EGO_LINUX_CDP_URL，指向已开调试端口的浏览器）与 本机 ego CLI（不注入端点，由本机 ego CLI 直接驱动 ego-lite 浏览器；' +
    '仅限本机，全局至多一条）。cdpMode: auto=按激活项；remote=仅接受 CDP 端点；local=受管本地启动器。' +
    'cdpMode=remote 与「本机 ego CLI」组合会显式报 mode-kind-mismatch。remoteEnabled 只管远端 CDP，不影响本机 CLI 连接。',
  navigate: 'bcdp_navigate: 打开URL或切tab(同任务复用当前tab)。bcdp_wait_for_url: 等跳转(登录/分页)。',
  observe:
    'bcdp_snapshot: 整页语义树(带[ref]/loc供点击); bcdp_page_info: url/标题/视口/滚动/对话框/人机验证; bcdp_read_element: 读单元素文本/HTML/值/属性/可见性/计数; bcdp_screenshot(+selector): 整页或元素截图。',
  input: 'bcdp_click(selector/坐标, double双击); bcdp_fill(填框); bcdp_key(press组合键 或 text连续键入); bcdp_check(勾选/取消); bcdp_select(下拉); bcdp_upload(文件上传); bcdp_dialog(接受/取消JS对话框)。',
  'keyboard-mouse':
    'bcdp_key: 键盘(press/text); bcdp_hover: 悬停; bcdp_drag: 拖拽(元素或坐标); bcdp_scroll: 滚轮/滚到元素; bcdp_click: 点击/双击。',
  form: 'bcdp_fill 填输入框; bcdp_select 下拉; bcdp_check checkbox/radio; bcdp_upload 文件; bcdp_key 回车/Tab导航; bcdp_dialog 处理提交弹窗。',
  wait: 'bcdp_wait(固定毫秒); bcdp_wait_for_selector(等元素出现/消失); bcdp_wait_for_url(等跳转); bcdp_wait_for_response(等网络响应并可读body)。',
  network:
    'bcdp_http: 发HTTP请求(默认浏览器上下文 fetch.browser, mode=server走Node fetch.server); bcdp_wait_for_response: 等并读接口响应。',
  download: 'bcdp_download: 等下载事件并落到指定路径(triggerSelector/triggerScript + 可选 savePath)。',
  captcha: 'bcdp_captcha: 检测页面人机验证(CAPTCHA)并返回{detected,kind}; 检测到请让用户去 ego 浏览器完成; bcdp_page_info 也附带 humanCheck。',
  login: 'bcdp_auth_flush: 把登录cookie落盘到ego profile; 观察窗登录引导条+『已登录,保存』按钮触发同一动作。bcdp_login_import: 从系统浏览器(Chrome/Edge/Brave)按域名导入登录cookie(source/domains/dryRun; 先dryRun看可导入项; ego浏览器须已在运行)。',
  script: 'bcdp_cli / bcdp_script: 原样运行任意内置运行时 heredoc 脚本(page/browser/taskSpaces/site/fetch/cdp预载)。bcdp_script额外返回 duration/timedOut。',
  doctor: 'bcdp_doctor: 体检环境(浏览器候选、vendored runtime、状态目录、CDP端口、任务空间)。',
  judge:
    'JEV/Laya 判定（阶段 10）：把「截图 + 编号 DOM + 意图」组装成判定请求；判定器只能回传编号，绝不给选择器（幻觉选择器在结构上不可能）。' +
    '四件套：bcdp_jev_status（先跑这个：判定链可用性 + 配置体检，不发任何请求）/ bcdp_jev_frame（采一帧，看判定器会看到什么）/' +
    'bcdp_jev_ask（组装请求体；dryRun 默认 true，先看清楚再发）/ bcdp_jev_run（跑循环，返回逐步 trace）。' +
    '降级链 jev -> laya -> rule -> refuse：不可用的跳**跳过不调用**，每一跳的跳过与失败都记进 trace，绝不静默回落；refuse 是结果不是异常。' +
    'laya-api 强制鉴权且无匿名分支 —— 缺 key 时该跳直接跳过，而不是发出去收 401。' +
    '阈值一律用选中项概率 top（不是 confidence：后者是归一化熵，2 选 1 与 20 选 1 不可比），并按候选数分桶。' +
    '设置面板键：jevUrl/jevKey/jevModel、layaUrl/layaKey/layaModel（laya 端口 8000，不是 7789）、judgePrefer、jevChunkSize、jevMaxImageBytes、jevHistoryLimit、jevArchiveImage、jevStepBudget、jevWallMs。',
}
