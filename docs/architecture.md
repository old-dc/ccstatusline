# ccstatusline 整体设计文档

> 适用版本：v2.2.8（基线分支 `feat/agent-activity-widget`）
> 读者：研发、测试、希望对项目做扩展或贡献的开发者
> 配套阅读：父 issue 中产品总监的「v2.2.8 产品现状梳理」给出了功能与版本演化全景，本文专注**怎么实现的**。

---

## 1. 架构总览

### 1.1 一个二进制三种身份

`src/ccstatusline.ts` 是唯一入口（编译产物 `dist/ccstatusline.js`），同一个二进制在三种触发场景下走完全不同的代码路径：

| 模式 | 触发条件 | 行为 |
|---|---|---|
| **Piped 模式** | `process.stdin.isTTY === false` 且无 `--hook` | 从 stdin 读取 Claude Code 推送的 `StatusJSON`，解析 → 加载配置 → 预渲染 widget → 输出多行状态栏 |
| **Hook 模式** | `process.argv.includes('--hook')` | 从 stdin 读取 Claude Code 的 `PreToolUse` / `PostToolUse` / `UserPromptSubmit` / `SubagentStart` / `SubagentStop` 事件，落盘三类活动日志后回写 `{}` |
| **TUI 模式** | `process.stdin.isTTY === true` 且无 `--hook` | 启动 React/Ink 配置界面，让用户编辑多行 widget、颜色、Powerline、安装到 Claude Code 等 |

入口分流见 `src/ccstatusline.ts:541-588` 的 `main()`：先解析 `--config <path>`（从 argv 中切走），再判断 `--hook`，最后看 stdin 是不是 TTY。

`--config <path>` 由 `parseConfigArg()`（`ccstatusline.ts:282-293`）处理后调用 `initConfigPath()` 切换全局配置文件路径，从而支持「项目级配置」「企业自管配置」等场景。

### 1.2 数据流（piped 模式，主路径）

```
                                   ┌─────────────┐
Claude Code ── stdin (StatusJSON) ─▶│ readStdin() │
                                   └──────┬──────┘
                                          ▼
                              StatusJSONSchema.safeParse  (Zod 校验)
                                          │
                                          ▼
                              ┌── loadSettings() ──┐
                              │  settings.json     │
                              │  + Zod 校验/默认值 │
                              │  + v1→v3 迁移      │
                              │  + legacy 类型升级 │
                              └────────┬───────────┘
                                       ▼
                       chalk.level = settings.colorLevel
                       updateColorMap()
                                       ▼
              ┌────────── 数据采集（按需触发） ──────────┐
              │ getTokenMetrics(transcript_path)        │
              │ getSpeedMetricsCollection(transcript)   │
              │ getSessionDuration(transcript)          │
              │ prefetchUsageDataIfNeeded(lines, data)  │
              │ getSkillsMetrics(session_id)            │
              │ getToolCountMetrics(session_id)         │
              │ getAgentActivityMetrics(session_id)     │
              │ getTodoProgressMetrics(session_id)      │
              └──────────────────┬──────────────────────┘
                                 ▼
                       构造 RenderContext
                                 ▼
                 preRenderAllWidgets(lines, settings, context)
                                 ▼
        calculateMaxWidthsFromPreRendered(preRenderedLines, settings)
                                 ▼
        for each line:
            renderStatusLine(items, settings, lineCtx, preRendered, maxWidths)
            → 普通模式 / Powerline 模式分流
            → ANSI / OSC8 感知截断
            → 替换空格为 NBSP（避免 VSCode 裁切）
            → 前缀 \x1b[0m 重置（覆盖 Claude Code 的 dim）
            → console.log 输出
            → advanceGlobalSeparatorIndex / ThemeIndex（跨行游标）
                                 ▼
                  输出 settings.updatemessage（如有，并自减计数）
```

### 1.3 模块依赖图（顶层）

```
┌──────────────────────────────────────────────────────────────┐
│                    ccstatusline.ts (entry)                    │
└─────┬────────────────────────────────────────────────┬────────┘
      │                                                │
      ▼                                                ▼
┌───────────────┐                              ┌──────────────┐
│ utils/config  │ ◀── types/Settings (Zod)     │   tui/App    │
│  + migrations │                              │  (Ink/React) │
└──────┬────────┘                              └──────┬───────┘
       │ loadSettings/saveSettings                    │
       ▼                                              ▼
┌──────────────────┐  syncWidgetHooks    ┌──────────────────┐
│ utils/claude-    │ ◀──────────────── ──│ utils/hooks      │
│   settings       │                     └──────────────────┘
└──────────────────┘
       ▲ (写入 statusLine + hooks)
       │
┌──────┴───────────────────────────────────────────────────────┐
│  utils/widgets   ◀── widget-manifest ◀── widgets/index.ts    │
│  - widgetRegistry: Map<type, Widget>                         │
│  - getWidget / getAllWidgetTypes / getWidgetCatalog          │
│  - filterWidgetCatalog（模糊+缩写+子序列匹配）               │
│  - upgradeLegacyWidgetTypes（git-pr → git-review）           │
└────────────────────────┬─────────────────────────────────────┘
                         │ getWidget(type).render(...)
                         ▼
┌──────────────────────────────────────────────────────────────┐
│ utils/renderer                                               │
│  - preRenderAllWidgets                                       │
│  - calculateMaxWidthsFromPreRendered                         │
│  - renderStatusLine ── if powerline ──▶ renderPowerline...   │
│  - lineHasMeaningfulContent（hideWhenAlone 抑制）           │
│  - 依赖 utils/ansi（ANSI/OSC8 视宽 + 截断）                  │
│  - 依赖 utils/colors（COLOR_MAP + theme + bgToFg）           │
│  - 依赖 utils/terminal（getTerminalWidth：父进程链 / TTY）   │
│  - 依赖 utils/context-percentage（flex full-until-compact）  │
└──────────────────────────────────────────────────────────────┘

数据采集层（被 ccstatusline.ts 在 renderMultipleLines 中按需调用）：
  utils/jsonl.ts      → re-export 入口
    ├── jsonl-lines     文件读 + 行解析
    ├── jsonl-metrics   token / speed / session-duration
    ├── jsonl-blocks    5 小时 block 起点
    ├── jsonl-cache     block 缓存（按 Claude config dir 哈希）
    └── jsonl-metadata  thinking-effort 等
  utils/usage-prefetch / usage-fetch / usage-windows / usage-types
                       直连 Anthropic Usage API（OAuth token，proxy 支持）
  utils/skills        Hook 落盘的 skill 调用日志读取
  utils/tool-count    Hook 落盘的 tool 调用日志读取
  utils/agent-activity Hook 落盘的 subagent 活动日志读取
  utils/todo-progress  Hook 落盘的 todo 快照读取
```

依赖方向是单向的：上层（entry / TUI）→ 中层（renderer / widgets / config）→ 下层（jsonl / usage / git / hooks 落盘）。Widget 实现里只通过传入的 `RenderContext + Settings + WidgetItem` 拿数据，自己**不**主动调用文件 IO 或 API；这一约束让预渲染阶段可以一次性把昂贵的 IO 集中在入口完成。

---

## 2. 关键模块设计

### 2.1 配置系统（`utils/config.ts` + `types/Settings.ts` + `utils/migrations.ts`）

#### 路径与文件
- **默认路径**：`~/.config/ccstatusline/settings.json`（`config.ts:23`）
- **覆盖**：CLI `--config <path>` 经 `parseConfigArg` → `initConfigPath`，所有读写都基于全局 `settingsPath`
- **备份**：基名 + `.bak` 同目录落盘（`getSettingsPaths`，`config.ts:45-57`）

#### Zod schema
`SettingsSchema`（`Settings.ts:26-67`）描述当前结构：
- `version`（默认 `CURRENT_VERSION = 3`）
- `lines`：`WidgetItem[][]`，最少 1 行；默认值给出 3 行模板，第 1 行是经典「model | context-length | git-branch | git-changes」
- `flexMode`：`'full' | 'full-minus-40' | 'full-until-compact'`，**默认 `full-minus-40`**
- `compactThreshold`：1–99，仅 `full-until-compact` 用，默认 60
- `colorLevel`：0/1/2/3 对应 none/ansi16/ansi256/truecolor，默认 2
- `defaultSeparator` / `defaultPadding` / `inheritSeparatorColors`
- `overrideForegroundColor` / `overrideBackgroundColor` / `globalBold` / `minimalistMode`
- `powerline`：`PowerlineConfigSchema`（separators / startCaps / endCaps / theme / autoAlign / continueThemeAcrossLines）
- `updatemessage`：升级提示，按 `remaining` 计数滚动消费

`WidgetItemSchema`（`Widget.ts:7-29`）刻意**接受任意 `type` 字符串**（forward compatibility）；额外字段如 `merge: boolean | 'no-padding'`、`hide`、`hideWhenAlone`、`metadata: Record<string,string>`、`character`、`maxWidth`、`preserveColors`、`timeout`、`commandPath`，都在这一层声明。

#### 迁移策略（`migrations.ts`）

```
detectVersion(rawData):
  ├─ 不是对象 → v1
  ├─ 含 version 字段 → 该数字
  └─ 否则 → v1
```

迁移采用**链式执行**（`migrateConfig` 的 while 循环，`migrations.ts:194-213`），每一步是一个 `Migration { fromVersion, toVersion, migrate }`：

- **v1 → v2**：白名单字段 + GUID 重新分配。v1 没有 widget id，需要 `generateGuid()` 给每个 item 补 id；如果 v1 设置了 `defaultSeparator`，旧的 explicit `separator` widget 会被剥离（`migrateV1Lines` 中 `stripSeparators=true`）以避免重复。同时塞入 `updatemessage`（"updated to v2.0.0"，remaining=12，相当于在 12 次状态栏渲染中提示一次性升级文案）
- **v2 → v3**：纯版本号 bump + 新的 `updatemessage`（提示 5 小时 block timer 上线）

加载流程（`loadSettings`，`config.ts:98-153`）：
1. 文件不存在 → 写默认值并返回
2. JSON 解析失败 → `recoverWithDefaults`（备份 `.bak` + 写默认）
3. 没有 version 字段 → 走 v1 路径：先用 `SettingsSchema_v1.safeParse` 验证再迁移；迁移完落盘
4. 有 version 但低于当前 → `migrateConfig` 链式升级；迁移完落盘
5. 最终用 `SettingsSchema.safeParse` 应用默认值
6. 调用 `upgradeLegacyWidgetTypes(lines)`（`widgets.ts:25-30`）把弃用的 type 别名（如 `git-pr` → `git-review`）就地替换

`saveSettings`（`config.ts:155-171`）：写入时强制注入 `version: CURRENT_VERSION`，写完异步触发 `syncWidgetHooks`（见 §2.7）把 widget 声明的 hooks 同步到 Claude Code 的 `settings.json`。

#### 自动备份策略
仅在「读到的配置坏」时做一次 `.bak`（覆盖式）。**不是**每次写都备份，避免无限制扩散。Claude Code `settings.json` 的备份策略不同（见 §2.7）。

---

### 2.2 Widget 体系（`utils/widget-manifest.ts` + `utils/widgets.ts` + `types/Widget.ts` + `widgets/*`）

#### 注册表
`WIDGET_MANIFEST: WidgetManifestEntry[]`（`widget-manifest.ts:19-82`）是所有内容 widget 的**显式注册表**，每条目 `{ type, create }`，`create` 返回新实例。`widgetRegistry: Map<type, Widget>`（`widgets.ts:14-16`）在模块加载时一次性把 manifest 实例化。

为什么用 manifest 而不是 glob 自动注册？
- 显式 manifest 让 type 字符串成为 source of truth，TS 检查谁调谁；
- 控制启动开销（v2.2.8 已有 60+ widget）；
- 测试时可以 mock 单条目而不影响其他。

布局型 widget（`separator`、`flex-separator`）走另一套 `LAYOUT_WIDGET_MANIFEST`（`widget-manifest.ts:84-97`），仅声明类目元数据；它们**不**在 widgetRegistry 里——renderer 在主循环中特判处理。

`getAllWidgetTypes(settings)` 会按当前模式动态决定显示哪些布局型：Powerline 启用时 `separator`/`flex-separator` 都隐藏；非 Powerline 时根据 `defaultSeparator` 是否设置决定要不要在 picker 里露出 `separator`。

#### Widget 接口（`types/Widget.ts:40-53`）

```ts
interface Widget {
  getDefaultColor(): string;
  getDescription(): string;
  getDisplayName(): string;
  getCategory(): string;
  getEditorDisplay(item: WidgetItem): WidgetEditorDisplay;
  render(item: WidgetItem, context: RenderContext, settings: Settings): string | null;
  getCustomKeybinds?(item?: WidgetItem): CustomKeybind[];
  renderEditor?(props: WidgetEditorProps): React.ReactElement | null;
  supportsRawValue(): boolean;
  supportsColors(item: WidgetItem): boolean;
  handleEditorAction?(action: string, item: WidgetItem): WidgetItem | null;
  getNumericValue?(context: RenderContext, item: WidgetItem): number | null;
}
```

四个能力轴：
1. **元信息**（`getDefaultColor` / `getDescription` / `getDisplayName` / `getCategory` / `getEditorDisplay`）—— 给 TUI 的 picker 与编辑器读
2. **渲染**（`render`）—— 唯一被 piped 模式 + TUI Preview 调用的方法；返回 `string` 或 `null`（null/空串 = 隐藏）
3. **TUI 行为**（`getCustomKeybinds` / `renderEditor` / `handleEditorAction`）—— 复杂 widget（如 CustomCommand、Skills、Link）会自带编辑器，简单 widget 留空走默认编辑器
4. **能力声明**（`supportsRawValue` / `supportsColors`）—— 让 TUI 决定哪些操作合法；`getNumericValue` 给可视化（如 ContextBar）提供数值

为什么 `render` 与 `renderEditor` 分两套？
- `render` 在 piped 模式下被调用，**绝不能**触碰 React/Ink，否则会把 piped stdout 污染成 TUI 控制序列；产物是纯字符串，可以叠 chalk。
- `renderEditor` 仅在 TUI 内运行，可以用 React hooks、`useInput`、`<Box>`，是真正交互的来源。
- 两条路径共用同一个 `WidgetItem` 数据结构，由 TUI 的 `StatusLinePreview` 通过 `render` 反向给出实时预览，做到「编辑器和真实输出 1:1」。

#### Widget 分类（`getCategory` 返回值）

由各 widget 自己声明，目前在 picker 里展开成：Layout / Claude / Git / Tokens / Context / Usage / Session / System / Custom / Activity / 等。`getWidgetCatalog`（`widgets.ts:75-95`）把 manifest + layout 都揉成一个 `WidgetCatalogEntry[]` 给 TUI picker 用。

#### 模糊搜索

`filterWidgetCatalog`（`widgets.ts:211-300`）实现 v2.2.8 的「smarter widget picker」：
- 按 9 档优先级排序：name 前缀+缩写 / name 前缀 / name 缩写 / name 子串 / type 子串 / name 模糊 / description 子串 / search 子串 / type 模糊 / search 模糊
- `findInitialismMatch` 把 `displayName` 的「单词首字母」抽出来与 query 比对，支持 `gp` 命中 "Git PR"
- `computeFuzzyScore` 用子序列 + 连续奖励 + 词首奖励算出排序值
- `getMatchSegments`（`widgets.ts:302-375`）把命中的位置拆段返回，给 picker 做高亮

#### Legacy alias

`LEGACY_WIDGET_TYPE_ALIASES`（`widgets.ts:19-30`）记录被改名的 widget 类型字符串。当前只有 `git-pr → git-review`。`upgradeLegacyWidgetTypes` 在 `loadSettings` 末尾跑一遍，老 settings 不需要手动迁移，下次保存时自然被刷新成新名。注意 `WIDGET_MANIFEST` 里仍以**新名**为正。

#### 扩展点总览

每个 widget 文件常见的形态：
- 简单文本类（`Model.ts`、`GitBranch.ts`、`Version.ts` 等）：纯 `.ts`，从 `RenderContext.data`/git 命令拼字符串返回；
- 数据派生类（`ContextLength.ts`、`ContextPercentage.ts`、`InputSpeed.ts` 等）：消费 `tokenMetrics` / `speedMetrics`；
- 反射类（`Skills.tsx`、`ToolCount.tsx`、`AgentActivity.tsx`、`TodoProgress.tsx`）：要么需要 React 编辑器（带 `.tsx`），要么会通过 `getHooks()` 声明自己依赖的 Claude Code 事件，由 `syncWidgetHooks` 自动写到 `~/.claude/settings.json`；
- 用户自定义类（`CustomText.tsx`、`CustomSymbol.tsx`、`CustomCommand.tsx`、`Link.tsx`）：编辑器允许用户自由输入文本/命令/URL。

---

### 2.3 渲染引擎（`utils/renderer.ts`，956 行）

#### 三件套：preRender → maxWidth → render

```
preRenderAllWidgets(lines, settings, context)
  → 对每行每 widget 调用 widget.render(...) 一次
  → 对 separator / flex-separator 占位（content=''）
  → 计算 plainLength（getVisibleWidth：考虑 ANSI、OSC8、emoji、Unicode 双宽）
  → 输出 PreRenderedWidget[][]

calculateMaxWidthsFromPreRendered(preRenderedLines, settings)
  → 跨行按 alignmentPos 求 max(plainLength + 2*paddingLength)
  → merge 串联的 widget 累加宽度，'no-padding' merge 不计中间 padding
  → 输出 maxWidths: number[]（用于 Powerline autoAlign 的列对齐）

renderStatusLine(items, settings, ctx, preRendered, maxWidths) → string
  └─ if powerline.enabled → renderPowerlineStatusLine(...)
```

为什么要预渲染？三个理由：
1. **避免重复 IO**：widget render 里如果直接调 git 命令、读文件，多行重复出现的 widget 会触发 N 次；先 pre-render 一次，再做 max-width 计算和最终拼装，IO 只发生一次。`utils/git.ts` 的 `gitCommandCache: Map<command|cwd, result>` 是这一原则的兜底，但 pre-render 让缓存命中率最大化。
2. **跨行对齐需要全局视野**：Powerline 的 `autoAlign` 必须等所有行都 render 完才知道 maxWidth；pre-render 让宽度计算可以提前于真正的颜色拼装。
3. **`hideWhenAlone` 抑制需要先看全局**：`lineHasMeaningfulContent`（`renderer.ts:493-507`）扫一遍 pre-rendered 列表，如果某行所有非装饰、非分隔的 widget 都没渲染出内容，就连这行装饰 widget 一起整行抑制（避免「空状态栏只剩个 emoji」）。

#### FlexMode 三档（`resolveEffectiveTerminalWidth`，`renderer.ts:34-73`）

| flexMode | 行为 | 设计意图 |
|---|---|---|
| `full` | 终端宽度 - 6 | 顶满，仅留 6 字符防换行；ANSI 截断兜底 |
| `full-minus-40` ✅ 默认 | 终端宽度 - 40 | **预留 40 字符给 Claude Code 的 auto-compact 提示**（如 "Context low - try /compact"）；不抢用户的关键提示位 |
| `full-until-compact` | `contextPct < threshold` ⇒ 终端 - 6；否则 终端 - 40 | 上下文压力小时占满，压力大时退让；`compactThreshold` 默认 60% |

预览模式（`context.isPreview`，TUI 内）固定按「full / minus-40 / 减 6」展示，不读 contextPct，让用户直观看到 layout。

#### Flex separator 与右对齐

`flex-separator` 是个特殊 widget：renderer 把它替换成字面量 `"FLEX"` 占位（`renderer.ts:759-762`），最后阶段再按数量平分剩余宽度（`renderer.ts:892-931`）。例：`[A] [FLEX] [B]` ⇒ `[A]              [B]`，是右对齐的实现基础。当 `terminalWidth` 检测失败时回退成普通灰色 `' | '` 分隔（`renderer.ts:934-936`），保证不至于挤成一团。

#### 截断：ANSI / OSC8 感知

`utils/ansi.ts` 的 `truncateStyledText` / `getVisibleWidth` / `stripSgrCodes` 是关键依赖：
- 区分 SGR（颜色）控制序列与 OSC 8（超链接）序列，保留嵌套结构；
- 用 `string-width` 计算 emoji、CJK 双宽字符的真实显示宽度；
- 处理变体选择符、ZWJ 序列、regional indicator pair，保证 emoji cluster 不会被劈开；
- 截断时智能补 `…` 并关闭还没闭合的 SGR/OSC8 状态。

renderer 在两处主动调用截断：
- `renderPowerlineStatusLine` 末尾（`renderer.ts:454-459`）：如果 powerline 行超长，按 `terminalWidth` 截断；
- `renderStatusLine` 主路径末尾（`renderer.ts:945-953`）：用 `terminalWidth ?? detectedWidth` 截断。

#### Powerline 列对齐

`renderPowerlineStatusLine` 中 `autoAlign` 分支（`renderer.ts:230-273`）：把每个 widget（按 alignment 槽位）填充到 `preCalculatedMaxWidths[pos]`，多行 Powerline 看起来就像表格。merge 串联的 widget 共享一个 alignment 槽位（颜色不递增，宽度合并）。

#### 输出后处理

最终输出之前，`ccstatusline.ts:236-247` 做了几件事：
- `getVisibleText(line).trim()` 检查可见内容；空行直接丢弃
- `line.replace(/ /g, ' ')` —— 空格 → 不间断空格，**防止 VSCode 终端把行尾空白裁掉**
- 前缀 `\x1b[0m` 重置 —— 抵消 Claude Code 默认的 dim 设置
- 渲染完一行后，调 `advanceGlobalSeparatorIndex` / `advanceGlobalPowerlineThemeIndex`，让分隔符和 Powerline 主题颜色的「全局游标」跨行延续

---

### 2.4 Powerline（`utils/powerline.ts` + 配套）

#### Nerd Font 检测

`checkPowerlineFonts`（`powerline.ts:17-102`）走两步：
1. 按 OS 列出本地字体目录（macOS 三处、Linux 三处、Windows 两处）；
2. 用一组 9 个正则（`powerline/`、`nerd font/`、`for powerline/`、`meslo lg/`、`source code pro powerline/`、`dejavu powerline/`、`ubuntu mono powerline/`、`cascadia code pl/`、`fira code nerd/`）扫文件名。

`checkPowerlineFontsAsync` 在 quick check 失败后再 fallback 调 `fc-list | grep -i powerline`（仅 macOS/Linux）。`DEBUG_FONT_INSTALL=1` 环境变量给 TUI 测试用：永远报告未安装，直到本会话内真的执行了安装动作。

#### 字体安装

`installPowerlineFonts`（`powerline.ts:156-325`）的策略：
- macOS / Linux：`git clone --depth=1 https://github.com/powerline/fonts.git` 到 tmp，然后跑仓库自带的 `install.sh`；Linux 额外 `fc-cache -f -v`。
- Windows：递归找 `.ttf`/`.otf`，仅挑路径含 "powerline" 的，复制进 `%LOCALAPPDATA%\Microsoft\Windows\Fonts`。
- 兜底友好提示：缺 git 时提示「请先装 Git」；其他失败把错误带回去 + 给手动安装链接。

为什么不发布字体而是 clone？许可证差异 + 字体大；让 powerline/fonts 仓库当 source of truth，避免 ccstatusline 包体爆炸。

#### Cap & Arrow 渲染

Powerline 不走「分隔符 widget」，而是在 `renderPowerlineStatusLine` 内部依次：
1. 起始 `startCap`（如 ）：按第 0 个 widget 的 bg 反推 fg 色
2. 每两个 widget 之间插箭头分隔符：fg = 上一个 widget 的 bg 转 fg；bg = 下一个 widget 的 bg。`separatorInvertBackground[i]=true` 则上下颠倒
3. 末尾 `endCap`（如 ）：与起始 cap 对称
4. 颜色用裸 ANSI 拼（`getColorAnsiCode`），**不**走 chalk wrapping —— 避免 chalk 的 reset 把下个 widget 的背景色冲掉
5. 同色背景的相邻 widget 特判（`sameBackground`，`renderer.ts:360`）：分隔符的 fg 改用 widget 自身的 fg（避免「分隔符消失」）

`startCaps` / `endCaps` 是数组，按 `lineIndex % length` 循环 —— 多行 Powerline 可以每行不同的起止帽。

#### 跨行主题继承

设置 `powerline.continueThemeAcrossLines=true` 时，`globalPowerlineThemeIndex` 在每行渲染完成后由 `advanceGlobalPowerlineThemeIndex(prevIndex, preRenderedWidgets)` 推进（`powerline-theme-index.ts:8-29`）。计数规则：跳过 separator / 空内容 / 与前一个 widget merge 的 widget。这样多行状态栏的颜色像「一片连续的 Powerline」延伸下去，而不是每行重新从主题色第 0 位开始。

为什么这样做？逐行配置颜色对用户太繁琐；Powerline 主题的核心价值是「一片渐变」。`countPowerlineThemeSlots` 让跨行的颜色推进与单行内的颜色推进遵循同一规则，视觉一致。

---

### 2.5 数据采集

#### Transcript JSONL 解析（`utils/jsonl-*.ts`）

- `jsonl-lines.ts`：`readJsonlLines(path)` 异步读全文按行 split；`parseJsonlLine` 是带 try/catch 的 `JSON.parse`，单行坏不影响整体。
- `jsonl-metrics.ts`（571 行，最大）：
  - `getTokenMetrics(transcript)`：累加 `inputTokens` / `outputTokens` / `cachedTokens` / `totalTokens` / `contextLength`
  - `getSpeedMetricsCollection(transcript, { includeSubagents, windowSeconds[] })`：
    - 收集每个 assistant turn 的 `interval { startMs, endMs }` 与 token 数
    - **subagent-aware**：递归扫 JSONL 找 `agentId` 字段，把这些 subagent 的 transcript 一并纳入计算（`collectAgentIds`）
    - 对每个请求的 `windowSeconds` 切窗：如 `windowSeconds=[0, 30, 60]`，则同时计算「整段 session 平均」和「最近 30s / 60s 滚动窗口」
    - 速度单位：tokens / second
  - `getSessionDuration(transcript)`：第一条 timestamp ↔ 最后一条 timestamp 差，格式化成 `1hr 23m`
- `jsonl-blocks.ts`：从 transcript 计算「当前所在的 5 小时 block 起点」
- `jsonl-cache.ts`：

#### 5 小时 block 缓存（`utils/jsonl-cache.ts`）

```
~/.cache/ccstatusline/block-cache-<sha256(claudeConfigDir)[:16]>.json
内容: { startTime: ISO8601, configDir: 绝对路径 }
```

`getCachedBlockMetrics(durationHours=5)`：
1. 读缓存，如果 `now - startTime <= 5 hr`，直接返回缓存的 startTime + `now` 作为 lastActivity
2. 否则调 `getBlockMetrics()`（全量扫 transcript）重算并写回

为什么按 Claude config dir 哈希分隔？多账号 / 多企业租户会同时使用不同的 `CLAUDE_CONFIG_DIR`，他们的 5 小时 block 计费是独立的；用同一个缓存会串台导致 block timer 显示错误。

为什么用「上次 startTime + 当前时间作为 lastActivity」而不是真实 lastActivity？block timer 只关心剩余时间（5 小时减去当前与 startTime 的差），lastActivity 不影响展示，省一次 transcript 扫描。

#### Anthropic Usage API（`utils/usage-fetch.ts` 558 行 + 配套）

- `usage-prefetch.ts:prefetchUsageDataIfNeeded(lines, data)`：先扫 lines 看有没有 `session-usage` / `weekly-usage` / `reset-timer` / `weekly-reset-timer` 等 widget，**没有就根本不联网**；有才调 `usage-fetch`
- 内存缓存 + 文件缓存（`~/.cache/ccstatusline/usage.json` + `usage.lock`）：
  - `CACHE_MAX_AGE = 180s`：成功响应缓存 3 分钟
  - `LOCK_MAX_AGE = 30s`：失败 / rate limit 后 30 秒内不再重试（限频自我保护）
  - `DEFAULT_RATE_LIMIT_BACKOFF = 300s`：API 返回 429 时缓存错误 5 分钟
- OAuth token 来源（`getUsageToken`）：
  - macOS 优先 Keychain（`security find-generic-password -s 'Claude Code-credentials'`），失败则扫 `security dump-keychain` 找所有以 `Claude Code-credentials` 开头的备选服务（按 mdat 时间排序），最后才回落 `~/.claude/.credentials.json`
  - 其他平台直接读 `getClaudeConfigDir() + '/.credentials.json'`
- 代理：`process.env.HTTPS_PROXY` 触发 `HttpsProxyAgent` 注入 `https.request`（`usage-fetch.ts:397`）

为什么 macOS 要扫 dump-keychain？v2.2.5 修复：用户在多 Claude 账号切换后 Keychain 可能存在 `Claude Code-credentials-1`、`Claude Code-credentials-2` 等并存条目，老逻辑只看主名会拿到过期 token。

#### Claude Code 集成（`utils/claude-settings.ts`）

- `getClaudeConfigDir()`：先 `CLAUDE_CONFIG_DIR` 再 `~/.claude`，做了「目录是否存在 + 是否是 dir」的轻校验
- `installStatusLine(useBunx, supportsRefreshInterval)`：
  - 写入前先 `backupClaudeSettings('.orig')` —— 第一次 install 时拿一份原始备份，固定后缀 `.orig`
  - 普通保存通过 `saveClaudeSettings` 走 `.bak`（覆盖式）
  - `settings.statusLine = { type: 'command', command: <npm 或 bunx>, padding: 0 }`
  - 当 Claude Code ≥ 2.1.97 时同时写 `refreshInterval`（`isClaudeCodeVersionAtLeast`）
  - 命令构造：`buildCommand(baseCommand)` 在使用 `--config` 时会自动把 path 引号化（路径含特殊字符时）
- `uninstallStatusLine`：删 `statusLine` + 调 `removeManagedHooks` 清理本工具写的 hook
- `isInstalled()`：检测 `command` 是否匹配 `CCSTATUSLINE_COMMANDS`（npm / bunx / 自管），且 `padding` 是 0/未设置

#### Hook 子系统（`utils/hooks.ts` + `ccstatusline.ts:325-539` 的 `handleHook`）

设计目标：让 widget 自己声明依赖哪些 Claude Code 事件，工具自动把对应的 hook 命令写进 `~/.claude/settings.json`，避免用户手工配置。

##### 写入侧：`syncWidgetHooks`（`hooks.ts:55-86`）

```
for each widget in settings.lines:
    if widget.getHooks?: → 收集 { event, matcher? }（去重）
strip 所有带 `_tag: 'ccstatusline-managed'` 的旧条目
for each needed hook:
    push { _tag: 'ccstatusline-managed', matcher?, hooks: [{ type:'command', command: '<statusLine.command> --hook' }] }
保存 Claude settings
```

`_tag` 是关键：每次 sync 先清掉自己写的，再补当前所需。用户手工写的 hook 完全不动。`saveSettings` 末尾会自动触发 sync，意味着用户在 TUI 里加/删 widget 后无需手动 install hook。

##### 读取侧：`handleHook`（`ccstatusline.ts:325-539`）

`--hook` 模式下，从 stdin 接 Claude Code 推过来的 JSON（`PreToolUse` / `PostToolUse` / `UserPromptSubmit` / `SubagentStart` / `SubagentStop`），按 `hook_event_name` 分发，最终落盘到三个 jsonl：

| 文件路径 | 事件来源 | 用途 |
|---|---|---|
| `~/.cache/ccstatusline/skills/skills-<sessionId>.jsonl` | `PreToolUse` 触发 Skill / `UserPromptSubmit` 起手是 `/<name>` | Skills widget |
| `~/.cache/ccstatusline/tool-count/tool-count-<sessionId>.jsonl` | `PreToolUse` start + `PostToolUse` end（带 `tool_use_id` 配对） | ToolCount widget（builtin / mcp 分类） |
| `~/.cache/ccstatusline/agent-activity/agent-activity-<sessionId>.jsonl` | `PreToolUse:Agent` start / `SubagentStart` 配对 / `SubagentStop` end | AgentActivity widget |
| `~/.cache/ccstatusline/agent-activity/...` 同上 | `UserPromptSubmit` 写一行 `event: 'turn'` | 「turn 边界」标记 |
| `~/.cache/ccstatusline/...todo-progress...jsonl` | `PostToolUse:TodoWrite` / `TaskCreate` / `TaskUpdate` | TodoProgress widget |

设计要点：
- **agent_id vs tool_use_id** 双键 FIFO 配对：`PreToolUse:Agent` 只有 `tool_use_id`；`SubagentStart` 只有 `agent_id`（不同语义键）。`handleHook` 把 `SubagentStart` 落一条「pairing 行」，读取侧 (`getAgentActivityMetrics`) 用 FIFO 配对它们；之后的 `SubagentStop` 通过 `agent_id` 即可解析回原始 agent 条目。**为什么不用 PostToolUse?** PostToolUse 对 `run_in_background` 子代理在「启动那一刻」就触发，无法表达真实结束；改用 `SubagentStop` 才能区分前台 / 后台的 running/done。
- **turn 边界**：每次 `UserPromptSubmit` 都给 agent-activity 和 todo-progress jsonl 追加一行 `event: 'turn'`。读取侧据此清掉「上一个 turn 已完成的 agent / 已结束的 todo 快照」，但 still-running 的 agent 永远保留（跨 turn）
- **TodoWrite vs TaskCreate/TaskUpdate**：旧 TodoWrite 整组写入；新 TaskCreate / TaskUpdate 是增量。`applyTodoEvent(prev, event)` 读取上一份完整快照，应用增量后写一份新的完整快照。这样**读取侧（getTodoProgressMetrics）保持不变**，只读最后一条即可
- **Skill 不二次计入 ToolCount**：`PreToolUse` 的 skill 调用先以 `event_name === 'PreToolUse' && isSkillTool(tool_name)` 的优先分支落到 skills.jsonl，然后 ToolCount 分支用 `!isSkillTool(...)` 跳过——同一个事件不双计数
- 失败兜底：所有 fs 操作都 try/catch；`handleHook` 末尾无论如何 `console.log('{}')` 给 Claude Code，避免阻塞用户的工具调用

---

### 2.6 端到端的样例时序（一次 Claude Code 状态栏刷新）

```
Claude Code: spawn `npx -y ccstatusline@latest --config ~/x.json`，stdin 喂 StatusJSON
ccstatusline:
  main → parseConfigArg → initConfigPath('/Users/x/x.json')
  → 不是 hook → stdin 不是 TTY → ensureWindowsUtf8CodePage（仅 win32）
  → readStdin → StatusJSONSchema.safeParse → renderMultipleLines
  → loadSettings → 读文件 → 没 version？v1 迁移 → 落盘 → 解析 → upgradeLegacyWidgetTypes
  → chalk.level=2 → updateColorMap
  → 扫 lines 看是否含 session-clock / speed / tool-count / agent-activity / todo-progress
  → getTokenMetrics（如果有 transcript_path）
  → prefetchUsageDataIfNeeded（如果有 usage 类 widget）
  → 拼 RenderContext
  → preRenderAllWidgets：每个 widget.render(item, ctx, settings) 一次
  → calculateMaxWidthsFromPreRendered
  → for each line:
       renderStatusLine → if powerline → renderPowerlineStatusLine
       getVisibleText.trim → lineHasMeaningfulContent
       空格→NBSP → 前缀 \x1b[0m → console.log
       advanceGlobalSeparatorIndex / ThemeIndex
  → updatemessage 计数 -1，必要时 saveSettings
  → 进程退出
```

---

## 3. 跨平台适配

### 3.1 macOS

- **`ink@6.2.0` patch**（`patches/ink@6.2.0.patch`）：把 `parse-keypress.js:161-166` 中的 `key.name = 'delete'` 改为 `key.name = 'backspace'`。原因：macOS 终端的 backspace 键发 `\x7f`，ink 上游误判为 delete，导致 TUI 编辑器删字符不工作。`bun install` 通过 `package.json` 的 `patchedDependencies` 自动应用。
- **Keychain token**：见 §2.5「Anthropic Usage API」段落，多备选服务排序解决多账号场景。

### 3.2 Windows

- **UTF-8 代码页**：`ensureWindowsUtf8CodePage`（`ccstatusline.ts:110-121`）在 piped 模式启动时调 `chcp.com 65001`，否则 cmd.exe 的默认 GBK/CP-1252 会把 emoji、Powerline 字符显示成乱码。仅在 `process.platform === 'win32'` 时执行；失败被忽略以兼容受限 shell。
- **路径分隔符**：claude-settings 的 `needsQuoting` / `quotePathIfNeeded`（`claude-settings.ts:38-57`）按平台采取不同字符集判断与引号策略（cmd.exe 用 `"..."`，POSIX shell 用 `'...'`）。
- **Powerline 字体**：`installPowerlineFonts` 的 Windows 分支（`powerline.ts:248-292`）走「递归找 ttf/otf 后复制到用户字体目录」的脚本流，不依赖 install.sh。
- **终端宽度检测**：`probeTerminalWidth`（`terminal.ts:35-78`）在 Windows 上**直接返回 null**——历史行为，避免 Unix 风格的 `2>/dev/null`、`tput cols`、`ps -o ppid=` 在 Windows 上做奇怪的兜底。配合 renderer 的 fallback：`hasFlexSeparator && !terminalWidth` 时 flex 退化成普通灰色 `' | '`，仍能正确输出，只是不再做右对齐。
- **Git Review 缓存**：用 `~/.cache/ccstatusline/git-review/<branch hash>.json`；目录用 `os.homedir()`，跨平台一致。

### 3.3 WSL / Linux

- WSL 走 Linux 路径，`/usr/share/fonts` + `~/.local/share/fonts` 的扫描都覆盖；`fc-cache` 可用时自动刷新字体缓存。
- 终端宽度检测的「父进程链 + TTY」策略（`terminal.ts:43-78`）专门处理「Claude Code 把 ccstatusline 拉起，本进程没有控制 TTY」的情况：从自身向上爬最多 8 级 PPID，找到首个有真 TTY 的祖先（一般是 shell），再 `stty size < /dev/<tty>` 取宽度。Windows 不走这套（无 `/dev/<tty>` 概念）。

---

## 4. 测试与构建

### 4.1 测试

- **框架**：Vitest（通过 Bun 运行）
- **配置**：`vitest.config.ts` 仅一行：`{ test: { include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] } }`
- **组织**：所有测试在 `src/**/__tests__/` 下，文件名 `<被测>.test.ts(x)`
  - `src/utils/__tests__/`：~40+ 个文件，覆盖 config / migrations / model-context / context-percentage / jsonl 全家 / git / git-remote / git-review-cache / hooks / hyperlink / open-url / powerline-* / renderer-{ansi,flex-width,line-hide,powerline-theme,separator-suppression} / separator-index / skills / speed-metrics / speed-window / terminal / todo-progress / tool-count / tool-names / usage-* / widgets
  - `src/widgets/__tests__/`：每个有逻辑分支的 widget 都有专属用例，外加 `GitWidgetSharedBehavior.test.ts` 抽出共性
  - `src/types/__tests__/StatusJSON.test.ts`：StatusJSON Zod schema 边界值
- **覆盖路径**：
  - 模型上下文窗口推断（`[1m]` / `(1M)` / `1M context` 等格式）
  - Context % 计算（含 200k / 1M 双窗）
  - JSONL 解析、token 累加、speed 滑窗
  - Widget 渲染（hideWhenEmpty、raw mode、自定义颜色）
  - Renderer 边界（ANSI 截断、flex 宽度、行抑制、Powerline 主题、分隔符压制）

### 4.2 三件套：`bun run lint` / `bun test` / `bun run build`

| 命令 | 实际执行 | 期望 |
|---|---|---|
| `bun run lint` | `bun tsc --noEmit && eslint . --config eslint.config.js --max-warnings=0` | 0 warning，0 error |
| `bun test` | Vitest 全量 | 全过 |
| `bun run build` | `rm -rf dist/* ; bun build src/ccstatusline.ts --target=node --outfile=dist/ccstatusline.js --target-version=14` | 产出 `dist/ccstatusline.js` |
| `postbuild`（自动跟在 build 之后） | `bun run scripts/replace-version.ts` | 把 `dist/ccstatusline.js` 内的 `__PACKAGE_VERSION__` 占位符替换为 `package.json` 的 version |

ESLint 用 flat config（`eslint.config.js`），插件含 `@typescript-eslint`、`@stylistic`、`eslint-plugin-react`、`eslint-plugin-react-hooks`、`eslint-plugin-import-x`、`eslint-plugin-import-newlines`。仓库铁律：**永远不允许 `// eslint-disable-...` 行内禁用**，唯一例外是必须保留旧行为（如 `tool-count.ts:43` 处理 mac 路径的特殊处理）经审阅入库的少数。

绝不允许：`--no-verify`、`// @ts-ignore`、删测试 / `.skip`。

### 4.3 发布产物

- `package.json#files = ["dist/"]`，npm 包**只发 `dist/`**
- `bun build --packages=external` 在内部把所有 runtime 依赖 bundle 进单文件 → 用户 `npx -y ccstatusline@latest` 直接拿到一个独立的 JS（依赖打包，启动快）
- `bin: { ccstatusline: 'dist/ccstatusline.js' }` 暴露 CLI
- Node 14+ 兼容（`--target-version=14`），Bun 通用；首行 `#!/usr/bin/env node`

---

## 5. 关键设计决策与权衡

### 5.1 为什么 `flexMode` 默认 `full-minus-40`？

Claude Code 在临近 context 上限时会主动在状态栏右侧贴一个 auto-compact 提示文案（约 40 字符）。如果状态栏顶满终端宽度，这个提示会被挤掉或换行覆盖；预留 40 字符让 ccstatusline 与 Claude Code 的提示**和平共处**。`full-until-compact` 是个折中：上下文使用率低时占满，越界时退让，把 40 字符让给提示。

### 5.2 为什么 Widget 接口同时暴露 `render` 和 `renderEditor`？

Piped 模式的 stdout 是「Claude Code 读取的状态栏字符串」，不能掺杂任何 React/Ink 控制序列；TUI 模式的输出是「真实的交互界面」。两条管道的输出格式完全不一样，但**配置数据是同一份 `WidgetItem`**。把 render 和编辑分两个方法，让同一个 widget 类同时承担「在状态栏里渲染什么」「在 TUI 里如何配置」，并保证 TUI 的 `StatusLinePreview` 能直接调 `render` 得到所见即所得。如果合并成一个方法，要么牺牲 piped 模式的纯净（chalk 字符串里掺 React tree），要么牺牲 TUI 的可交互性（编辑器只能预设几种 widget 类型），都不可接受。

### 5.3 为什么 block 缓存按 Claude 配置目录哈希分隔？

5 小时 block 是 Anthropic 的计费单位，**与账号强绑定**。一台机器上跑多个 `CLAUDE_CONFIG_DIR`（多账号、多企业租户、本地 + remote）是真实场景。共享一份 block 缓存会导致后启动的账号读到前一个账号的 block 起点，BlockTimer 显示完全错误。哈希前缀 16 字节（`sha256(absolutePath).slice(0,16)`）已远超碰撞概率需要，文件名仍可读。

### 5.4 为什么 Powerline 主题做跨行继承而不是逐行配置？

Powerline 主题是色阶（如 4-8 个渐变色），核心视觉价值在「一片连续的渐变」。如果每行从主题第 0 位重新开始，3 行状态栏会出现 3 段同样的渐变色块，看起来像复制粘贴。跨行游标（`globalPowerlineThemeIndex`）让色阶从第 1 行末尾继续到第 2 行开头，整个状态栏像「一条被换行折叠的 Powerline」——这才是 Powerline 在 IDE / shell 主题里的标准外观。同时保留逐行配置的能力：`startCaps` / `endCaps` 是数组，按 `lineIndex % length` 循环，用户仍可让每行有不同的起止帽。

### 5.5 为什么 hook 用 `_tag` 标识自己写的条目？

Claude Code 的 `~/.claude/settings.json` 通常是用户手写或别的工具一起写。ccstatusline 必须能「干净地接管自己负责的那部分，不动别人的」。`_tag: 'ccstatusline-managed'` 是软删除/软更新标记 —— `syncWidgetHooks` 每次先 strip 所有自己 tag 的条目，再按当前 widget 集合补回。这比「记录上次写过哪些」更稳健（即使 ccstatusline 中途崩了 / settings 被外部编辑，下次同步仍能 self-heal），也比「比 diff 后增量改」更简单。

### 5.6 为什么 `WidgetItemSchema` 的 `type` 是任意 `string`？

Forward compatibility。当用户从新版 ccstatusline 下载了配置（含尚未存在的 widget type），降级到老版本运行时，老版本不会因为 Zod 校验失败丢掉整个 settings —— 它会把未知 type 在 `preRenderAllWidgets` 阶段 silently skip（`renderer.ts:532-536`），剩余 widget 继续工作。结合 `LEGACY_WIDGET_TYPE_ALIASES` 的「老 type 自动升级」，整体形成「向前向后都不脆断」的策略。代价：拿不到 TS 级别的 type 字面量穷举检查，由 `isKnownWidgetType` 与 widgetRegistry 在运行时兜底。

---

## 6. 扩展指引

### 6.1 新增一个内容 widget

**最小步骤**（以 `FooBar` widget 为例）：

1. **建文件**：`src/widgets/FooBar.ts`（或 `.tsx`，如果需要 React 编辑器）
   ```ts
   import type { Widget, WidgetItem, WidgetEditorDisplay } from '../types/Widget';
   import type { RenderContext } from '../types/RenderContext';
   import type { Settings } from '../types/Settings';

   export class FooBarWidget implements Widget {
       getDefaultColor() { return 'cyan'; }
       getDescription() { return 'Shows foo bar status'; }
       getDisplayName() { return 'Foo Bar'; }
       getCategory() { return 'System'; }
       getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
           return { displayText: 'Foo Bar' };
       }
       render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
           // 拿 context.data / tokenMetrics 等组装字符串；hideWhenEmpty 可返回 null
           return 'foo: bar';
       }
       supportsRawValue() { return true; }
       supportsColors(_item: WidgetItem) { return true; }
   }
   ```

2. **导出**：在 `src/widgets/index.ts` 新增 `export { FooBarWidget } from './FooBar';`
3. **注册**：在 `src/utils/widget-manifest.ts` 的 `WIDGET_MANIFEST` 数组里加一条
   ```ts
   { type: 'foo-bar', create: () => new widgets.FooBarWidget() },
   ```
   注意 `type` 字符串使用 `kebab-case`，必须全局唯一；这是 settings.json 里持久化的 key。
4. **可选：自定义快捷键**：如果 widget 在 ItemsEditor 里需要专属按键（如 `f` 切换格式），实现 `getCustomKeybinds(item)` 返回 `[{ key: 'f', label: 'Toggle format', action: 'toggle-format' }]`，并实现 `handleEditorAction('toggle-format', item)` 返回新的 `WidgetItem`。
5. **可选：自定义编辑器**：复杂参数（如 CustomCommand 的多输入框）实现 `renderEditor` 返回一个 React 组件；同时把文件改成 `.tsx`。
6. **可选：声明 hook 依赖**：如果 widget 的数据来自 hook 落盘（Skills/ToolCount/AgentActivity 模式），实现 `getHooks(): WidgetHookDef[]`，例如：
   ```ts
   getHooks(): WidgetHookDef[] {
       return [{ event: 'PreToolUse', matcher: 'Foo' }, { event: 'PostToolUse', matcher: 'Foo' }];
   }
   ```
   `syncWidgetHooks` 会自动把它们加进 `~/.claude/settings.json`。同时在 `handleHook`（`src/ccstatusline.ts`）里加分支落盘到 `~/.cache/ccstatusline/<feature>/...jsonl`，再写一个 reader（如 `utils/foo.ts`）供 widget 在 `render` 里调用。
7. **测试**：在 `src/widgets/__tests__/FooBar.test.ts` 写至少 3 类用例：默认渲染 / hideWhenEmpty 路径 / 自定义参数路径。
8. **运行三件套**：`bun run lint && bun test && bun run build`。

### 6.2 新增一个配置项 + 写迁移

新增字段必须经历**两步**：

1. **改 schema**：在 `src/types/Settings.ts` 的 `SettingsSchema` 加字段，**必须给 `.default(...)`**（否则旧 settings 加载会失败）。例：
   ```ts
   newField: z.boolean().default(false),
   ```
   如果是结构化字段，建议另开 schema 文件（参考 `PowerlineConfig.ts`）。

2. **bump 版本号 + 写迁移**：在 `src/types/Settings.ts` 把 `CURRENT_VERSION` 加 1（如 `4`）；在 `src/utils/migrations.ts` 的 `migrations` 数组追加：
   ```ts
   {
       fromVersion: 3,
       toVersion: 4,
       description: 'Migrate from v3 to v4: add newField',
       migrate: (data) => {
           const migrated: Record<string, unknown> = { ...data };
           migrated.version = 4;
           // 如果只是新增字段，让 Zod default 接管即可，这里什么都不用做
           // 如果需要从老字段推导新字段，在这里写转换逻辑
           // 如果想给用户提示，加 updatemessage：
           // migrated.updatemessage = { message: 'updated to v2.x.y, ...', remaining: 12 };
           return migrated;
       }
   }
   ```

3. **更新 v1 schema（仅在跨大版本时）**：`SettingsSchema_v1` 是 v1 → v2 迁移的输入 schema，**不要随意改**；只在迁移逻辑确实需要 v1 的某个新字段时扩展。

4. **若改了 widget 的 type 字符串**（重命名）：在 `src/utils/widgets.ts` 的 `LEGACY_WIDGET_TYPE_ALIASES` 加一条 `oldType: 'newType'`，老 settings 自动平滑升级，不需要写迁移。

5. **测试**：
   - `src/utils/__tests__/migrations.test.ts` 加 v3→v4 的 round-trip 用例
   - `src/utils/__tests__/config.test.ts` 加加载老格式 + 落盘新格式的用例

6. **TUI 暴露**：在合适的菜单（`MainMenu` / `GlobalOverridesMenu` / `TerminalOptionsMenu` 等）加一行让用户切换；保存时调 `saveSettings`，自动触发 hook 同步。

7. **运行三件套**：`bun run lint && bun test && bun run build`。
