# dsh-plugin-context-compact

右键输入框右下角的**上下文用量圆环**，立刻压缩当前会话的上下文。

等同于在该会话里输入 `/compact`，只是把入口搬到了圆环上。装好后可在「设置 → 插件」里随时开关。

已在 DeepSeek Harness 桌面端实测：右键 → 横幅提示 → 对话流出现 `manual-compaction` 节点；开关启停均为热生效。

## 安装

无需构建、无第三方依赖，`lib/` 就是可运行的 JS。

```bash
git clone git@github.com:buter-fur/dsh-plugin-context-compact.git
```

然后在 DSH 里执行（`target` 用 clone 下来的**绝对路径**）：

```text
plugin_manager  action=install_bundle  target=/绝对路径/dsh-plugin-context-compact
```

装好后「设置 → 插件」里出现「右键压缩上下文」，右侧开关可随时启停，不用重启应用。

> 不要手工改 profile 的 `package.json` 或 `cordis.patch.yml`——`install_bundle` 会自己完成登记与链接。手工加 `- insert:` 会让同一行有两个来源，开关就会"关了还在"。

## 使用

在圆环上点右键即可：

- 只在圆环按钮内部接管右键，输入框、消息区、圆环明细面板仍是浏览器菜单；
- 顶部横幅先显示「正在压缩上下文…」，完成后显示折叠了多少条历史（约多少 tokens）；
- 压缩进行中再次右键会被忽略；没有可压缩的历史时会明确提示，不会假装成功；
- 误触不会丢数据：压缩只是把较早历史折成检查点，原始会话日志仍在。

## 停用与卸载

| 目的 | 做法 |
| --- | --- |
| 临时停用 | 设置 → 插件里关掉开关（或 `plugin_manager set_plugin`），包和源码都保留 |
| 彻底卸载 | `plugin_manager` 的 `remove_bundle`，`target` 为 `dsh-plugin-context-compact` |

## 工作原理

DSH 没有给手动压缩开 Remote（`compaction` 服务是 Host 内部 seam），面向人的入口是 `/compact` 命令。所以本插件不复制压缩逻辑，只调 `commands.execute(sessionId, "/compact", [])`——和手敲 `/compact` 走同一条路，生命周期与失败码完全一致。

圆环 `ContextMeter` 是 composer 骨架直接渲染的，不是 Slot，拿不到它的 ref。插件往 composer dock 注册一个 `display:none` 的 marker 取 `sessionId`，再在 dock 上监听 `contextmenu`。识别圆环**不看类名**（官方类名带构建哈希），只用结构：`BUTTON` + `aria-haspopup="dialog"` + 14×14 且正好两个 `<circle>` + 文本整体形如 `45%`。少一个特征就不认——失效方向是"右键退回浏览器菜单"，绝不会误压别的按钮。

## 已知限制

- 圆环不在时没有右键入口：没有用量数据，或 composer 正在显示活动动作，`ContextMeter` 本身就不渲染。
- `/compact` 由 agent preset 在会话作用域挂载；在没有 compaction group 的 preset 里会提示"命令未被识别"，不会静默无反应。
- 失败横幅里的原因来自 Host，是英文；成功横幅的条数/tokens 是尽力提取，提取不到就退化成整句。
- 识别依赖 `ui-conversation` 当前的结构特征。官方改了几何会变成"认不出"，而不会误判。

## 开发

```bash
node selfcheck.mjs    # 8 组检查，all checks passed
```

- 改 `lib/client.js` 保存即热生效；改 `package.json` 或 `cordis.patch.yml` 需重装 bundle 并重启。
- `lib/client.js` 是全部逻辑；`lib/index.js` 是空占位（让 Loader 有一行才能带出浏览器半边，**不许 import 任何裸包名**，否则两半一起挂）；`locale/` + `icon.svg` 是设置页的标题、描述与图标。

MIT
