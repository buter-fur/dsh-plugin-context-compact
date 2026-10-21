# dsh-plugin-context-compact

在输入框右下角的**上下文用量圆环**（`ui-conversation` 的 `ContextMeter`，显示 `45%` 的那个）上**点右键**，立刻对当前会话执行一次上下文压缩。

| | |
| --- | --- |
| 手势 | 只在指针位于圆环按钮内部时接管 `contextmenu`；其他地方（含输入框、消息区、圆环的明细面板）一律放行浏览器默认菜单 |
| 动作 | `ctx.remote.commands.execute(sessionId, "/compact", [])` |
| 反馈 | 官方 `Toast` 横幅：`正在压缩上下文…` → `上下文已压缩：折叠了 12 条历史（约 8400 tokens）。` / 失败原因 |

## 实测状态（2026-10-09）

| 验证项 | 结论 |
| --- | --- |
| `node selfcheck.mjs` | `all checks passed`（7 组检查，见下文自检输出） |
| 热挂载 | 实时 Slot 树 `conversation.composer.dock` 的 occupants 里出现 `context-compact`（order 20，`active: true`）——未重启应用、未刷新页面 |
| 真机手势 | **通过**：右键圆环 → `正在压缩上下文…` → 完成横幅（含条数与 tokens）→ 对话流出现 `manual-compaction` 节点 |
| 插件页开关 | **通过**：`set_plugin` 关闭后，`conversation.composer.dock` 里的 `context-compact` 占位立刻消失、profile 补丁层写入 `- id: context-compact` / `disabled: true`；重新打开后占位恢复、补丁回到原样（没有留下 `disabled: false` 残渣） |

维护回路：在工作区目录改 `lib/client.js` 保存即热生效（无需重启应用）→ `node selfcheck.mjs` → 在浏览器里重做一次右键。源码只有工作区这一份，profile 通过 `install_bundle` 链接它——**不要再手工往 `~/.dsh` 里放第二份拷贝**。

## 为什么是这条路

DSH 里**没有**给"手动压缩"开 Remote：`compaction` 服务（`compactIfNeeded` / `compactNow` / `compactRegion`）是 Host 内部 seam，而面向人的入口是 `/compact` 命令（`@deepseek-ai/dsh-command-compact`）。所以本插件不改、不包、不复制压缩逻辑，只是把**同一个 `/compact`** 从输入框搬到了圆环上：

- 走的是同一个 `commands.execute` Remote，也就是同一个 Host executor；
- 因此有同样的持久化生命周期（`command/run` … `command/done`）；
- 因此对话流里会出现同样的 `manual-compaction` 节点；
- 因此 `compactNow` 的 `busy` / `cancelled` / `summary` / `commit` 等失败码不需要本插件重新解释——Host 的文案会原样出现在横幅里。

### `/compact` 是 preset 作用域的，不是根作用域的

这点值得单独写下来，因为它会让人在排查时看错地方：桌面 leaf（`@deepseek-ai/dsh-web-app` 的 `cordis.patch.yml`）**主动把根级的 `compaction-basic` 与 `command-compact` 禁掉了**，理由是 token meter 的投影表是进程级的，由 preset 拥有会让这个表变成"挂了哪些 preset"的函数：

```yaml
# dsh-web-app/cordis.patch.yml
- id: compaction-basic
  disabled: true
- id: command-compact
  disabled: true
```

真正挂载它们的是**每个 agent preset**，在一个 `isolate: { compaction: true }` 的会话作用域 group 里（`presets/standard.patch.yml`、`presets/ptc.patch.yml`、`presets/cordis.patch.yml` 都有）：

```yaml
- id: compaction
  name: cordis:group
  group: true
  isolate: { compaction: true, toolResultPruner: true }
  config:
    - id: compaction-basic
      name: '@deepseek-ai/dsh-compaction-basic'
    - id: command-compact
      name: '@deepseek-ai/dsh-command-compact'
```

后果有两个：

- `cordis_inspect_query` 的 Config 目录里，`include:command-compact` 显示 `inactive`（`entry.fiber === undefined || fiber.uid === null || entry.disabled` 三者取或）。**这不代表功能没挂**——同一份目录里 `include:tool-bash`、`include:tool-fs`、`include:tool-todo` 同样是 `inactive`，而这些工具在你手上正常工作：它们的行由 preset 在会话作用域里实例化，根作用域的 Config 投影看不到那个 fiber。
- 若某个 preset 没有这个 `compaction` group，`/compact` 就不会注册。此时右键不会静默失败：`commands.execute` 对未知命令返回 `undefined`，横幅会显示 `压缩请求未被识别，可能缺少 /compact 命令。`（`outcomeOf` 的第 10 个用例覆盖了这条分支）。


## 怎么找到那个圆环

`ContextMeter` 是 composer 骨架**直接渲染**的，不是 Slot，所以插件拿不到它的 ref，也不能替换它。`ui-conversation` 的渲染代码是：

```jsx
<div className={InputBar.dock}>
  {variant === "composer" && input !== undefined && sessionId !== undefined
    ? renderSlot("conversation.composer.dock", {})
    : null}
  {activity ? null : <ContextMeter useProjection={useProjection} t={t} />}
</div>
```

于是本插件：

1. 往 `conversation.composer.dock` 注册**一个 `display:none` 的 marker**（不占位、不参与 dock 的 `gap`，布局逐像素不变），只为拿到 `sessionId` 这个标准 Slot prop；
2. 由 marker 向上找到 `[data-slot="conversation.composer.dock"]` 的**父元素**，那就是 dock 行——也就是圆环所在的那个 flex 容器；
3. 在 dock 上挂 `contextmenu`，命中条件为「指针在圆环按钮内部」。

**识别圆环不看类名。** 官方 CSS Module 的类名带构建哈希（`y0jqnG_trigger`），每次发版都可能变；这里只用结构特征，全部来自 `ContextMeter` 的源码：

| 特征 | 值 | 来源 |
| --- | --- | --- |
| 元素 | `BUTTON` | `<button type="button" className={…trigger}>` |
| `aria-haspopup` | `"dialog"` | 明细面板是 `role="dialog"` |
| 环形 SVG | `viewBox="0 0 14 14"` 且恰好 2 个 `<circle>` | `RADIUS = 5.5`，track + fill |
| 文本内容 | 整体形如 `45%` | `<span>{reading}</span>`，`reading = `${percent}%`` |

任何一个特征不满足就**不认**：宁可漏掉一次右键（退化成浏览器菜单），也不会误判成"压缩某个按钮"。

**多会话是隔离的。** 侧边栏 chat 标签会挂第二个 Conversation（第二个圆环），但每个 cell 的 dock 是从它自己的 marker 走上去得到的，因此各自只绑自己的圆环，不会串台、不会重复触发。

## 目录

| 文件 | 作用 |
| --- | --- |
| `package.json` | 包清单：`dsh.bundle.patch`（bundle 声明）、`dsh.client`（浏览器半边）、`exports`（含 `./locale/*.json`、`./icon`） |
| `cordis.patch.yml` | bundle 补丁：插入 `context-compact` 这一行——也就是插件页里可开关的那一行 |
| `lib/index.js` | Host 半边：**空占位**，只为让 Loader 有一行，从而把浏览器半边带进 Web boot graph |
| `lib/client.js` | 浏览器半边：marker + 右键识别 + `/compact` 调用 + 横幅 |
| `locale/zh.json`、`locale/en.json` | 插件页的 `meta.title` / `meta.description`（**不激活插件也会被读取**） |
| `icon.svg` | 插件行图标：64×64 自绘，圆环 + 向内收拢的箭头 |
| `selfcheck.mjs` | 自检脚本（见下） |
| `LICENSE` | MIT |

Host 半边**不 import 任何东西**，这是硬约束：插件装在 dsh 安装目录之外，Node 从引用文件所在目录往上找 `node_modules`，插件目录这一路没有，所以任何裸包名都会 `MODULE_NOT_FOUND`，后果是 **Host + 浏览器两半一起加载失败**。Host 半边确实也不需要什么，一切都通过 `ctx` 拿。浏览器半边不受此限：客户端模块系统按平台表解析 `react` / `react/jsx-runtime` / `@deepseek-ai/dsh-client-ui-primitives`。

## 安装与开关

本包是标准 bundle：`package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`，补丁插入一行 `context-compact`。安装走 `plugin_manager`，它自己完成登记与链接——**不要手写 profile 的 `package.json` 或 `cordis.patch.yml`**：

```text
plugin_manager  action=install_bundle  target=/绝对路径/dsh-plugin-context-compact
```

这一步做三件事：把包名登记进 `dsh.profile.bundles`、写入 profile 的 `dependencies`、把目录链接进 profile 的 `node_modules`。装好后：

- 该行出现在**插件设置页**，标题/描述来自 `locale/*.json` 的 `meta.*`，图标来自 `icon.svg`——这三样在插件**未被激活**时就会被读取，所以改文案不必先启用；
- **开关**就是 `plugin_manager set_plugin`（即设置页里那个开关）：它把 `disabled` 写进 profile 补丁层，**热生效**。关掉后浏览器半边被移出 `clientModules` 图，右键手势随之消失；再打开即恢复。两种状态都不需要重启应用。

**不要再手工加 `- insert:` 行。** 那会让同一行有两个来源（profile 补丁 + bundle 补丁）：设置页开关写的是 profile 那层，而你手写的那行仍把它挂起来，于是"关了还在"。旧版正是这么装的，升级见最后的卸载一节。

### 开发回路

```bash
node selfcheck.mjs                    # 8 组检查，含 bundle 清单与显示资源
```

- 改 `lib/client.js`：浏览器半边走 HMR 热更新，保存即生效；Host 半边没有逻辑，不必动。
- 改 `package.json` 或 `cordis.patch.yml`：对同一个目录重新 `install_bundle`。**替换已安装的包需要重启**才能载入新的 JS 模块世代——这一点 HMR 覆盖不了。

## 自检

```bash
cd dsh-plugin-context-compact && node selfcheck.mjs
```

输出（实测）：

```text
dependency surface ok (no bare specifiers in either half)
host half ok (name=context-compact, inject=[])
client half ok (id=dsh-plugin-context-compact, 8 dictionary keys)
meter discrimination ok (7 negatives, ring recognized, dock search)
anchor walk ok (slot anchor first, marker parent as fallback)
outcome mapping ok (13 cases, every key localized)
mount ok (slot=conversation.composer.dock, id=context-compact, order=20)
bundle manifest ok (patch=./cordis.patch.yml, 2 locales, icon 582 B)

all checks passed
```

它覆盖的都是"装上去之后肉眼看不出来、但错了就白做"的部分：

- **依赖面**：两半都不许出现裸包名；
- **圆环识别**：拿真实的 `ContextMeter` 结构（dialog + 14×14 双 circle + `45%`）当正例，拿**模型选择器**（同样是 `aria-haspopup="dialog"`，但是 16×16 单 path、文本是模型名）、菜单触发器、单 circle 环、文本不是百分比、非 button、`null` 共 7 个当反例；
- **锚点回溯**：有 Slot anchor 时取 anchor 的父元素，没有时回退 marker 的父元素，`closest` 缺失或 marker 为 `null` 都不抛错；
- **结果映射**：13 个 `commands.execute` 响应 → 横幅文案，包含 `Compacted 12 history items (~8400 tokens).` 的数字提取、`1,024` 千分位、退化为无数字句子，以及**区分"压缩了"和"没有可压缩的历史"**——后者不靠匹配英文句子，而是靠 `sourceEventSeq` 是否存在（`compactNow` 返回 `null` 时 handler 不带这个字段）。每个产出 key 都必须同时存在于中英词典；
- **挂载**：`inject` 恰好是 `["slots","locale","remote","remote.commands"]`，`apply` 恰好注册一个 cell 到 `conversation.composer.dock`；
- **清单**：`exports` 里每个非通配目标都必须真实存在；`cordis.patch.yml` 必须插入 `context-compact` 这一行且 `name` 指向本包；两份 locale 都要有非空 `meta.title` / `meta.description` 且彼此不同（挡住"把英文抄进 zh 文件"这种模板残留）；`icon.svg` 必须是完整的、小于 256 KiB 的 SVG。

## 已知边界

- **圆环不在时手势不存在**。没有 provider 同时报出 pressure 与 route capacity 时 `ContextMeter` 直接 `return null`；composer 正在显示活动动作时这个座位也被 `activity` 占了。这两种情况下页面里没有圆环，自然没有右键可点——而这也正好是"没什么可压"或"正忙"的时候。
- **`/compact` 跟着 preset 走**。见上文：命令由 agent preset 在会话作用域挂载。换到没有 `compaction` group 的 preset，右键会明确回报"命令未被识别"，而不是悄悄没反应。
- **失败文案可能中英混排**。压缩失败时横幅显示 `压缩未完成：<Host 原文>`，Host 的 `dsh-command-compact` 只发英文文案。这里刻意**不**去匹配英文句子来翻译，因为文案会随版本变；key 与句式仍是本地化的。唯一的例外是成功文案里的数字（条数、tokens），那是**尽力**提取：正则失配就退化成不带数字的整句，不会错报。
- **不做二次确认**（按需求选定"直接压缩"）。防误触靠两点：命中判定很窄（必须正好落在圆环按钮内），以及本地重入闸门（一次压缩在飞时再右键直接忽略，不会把 `busy` 丢给用户）。误触也不会丢数据：压缩只是把较早历史折成检查点，原始会话日志仍在，对话流里也会留下 `manual-compaction` 节点。
- **不认类名，因此也不保证未来版本仍然认得出**。识别完全依赖 `ui-conversation` 当前的结构特征（`aria-haspopup="dialog"` + 14×14 双圆环 + 百分比文本）。已核对：整个 Web 端 73 个 client bundle 里，`viewBox="0 0 14 14"` 只出现 4 处，其中另外 3 处（`ui-schedule` 日历图标、`ui-settings-account` 两处图形、`ui-shortcuts` 搜索图标）都是 `path`／`rect` 画的，**只有 `ContextMeter` 是双 `<circle>`**。若官方改了这个几何，识别会变成"永远认不出"（右键退化为浏览器菜单），而不会变成误判——这是刻意选的失效方向。


## 停用、卸载与升级

**临时停用**：插件设置页里关掉那个开关（等价于 `plugin_manager set_plugin` 把 `disabled: true` 写进 profile 补丁层）。包还装着、源码不动，随时能再打开；热生效。

**彻底卸载**：

```text
plugin_manager  action=remove_bundle  target=dsh-plugin-context-compact
```

它把包从 `dsh.profile.bundles` 和 profile 的 `node_modules` 里摘掉。源码目录（工作区那份）留不留由你决定，摘掉之后它不再被加载。

**从旧版（手写 profile 补丁）升级**：先删掉 `~/.dsh/profiles/desktop/cordis.patch.yml` 里的 `- id: context-compact` 那两行，以及 `package.json` 里对应的 `dependencies` 条目，然后再 `install_bundle`。**先删后装**——否则同一行被两层同时挂载，设置页开关看起来会失灵。

## 从 GitHub 安装

```bash
git clone git@github.com:buter-fur/dsh-plugin-context-compact.git
```

再对 clone 下来的目录执行 `install_bundle`（参数是绝对路径）。不需要构建，也没有 npm 包：`lib/` 就是可运行的 JS，`react`、`react/jsx-runtime` 与 `@deepseek-ai/*` 由 dsh 的客户端模块系统按平台表解析。

装好之后用 `node selfcheck.mjs` 自检；它只依赖 Node 内建模块，不需要装依赖。
