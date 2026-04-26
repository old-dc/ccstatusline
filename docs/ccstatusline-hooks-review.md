# ccstatusline Hooks 使用情况评估

本文对照 [`docs/claude-code-hooks.md`](./claude-code-hooks.md) 检查 ccstatusline 当前对 Claude Code hook 机制的使用，给出正确性评估和改进建议。

## 评估范围

- 仓库分支：`feat/agent-activity-widget`，commit `b2ca949`（2026-04-26 调研时）
- 关键文件：
  - `src/utils/hooks.ts`：写入侧（widget 声明的 hook 注入到 `~/.claude/settings.json`）
  - `src/ccstatusline.ts:295-539`（`HookInput` + `handleHook`）：读取侧（`--hook` 模式下处理 stdin payload）
  - `src/widgets/Skills.tsx`、`src/widgets/ToolCount.tsx`、`src/widgets/AgentActivity.tsx`、`src/widgets/TodoProgress.tsx`：声明各自依赖的 hook
  - `src/utils/claude-settings.ts`：包装 `installStatusLine` / `uninstallStatusLine` / `syncWidgetHooks`
  - `src/utils/tool-names.ts`：集中维护工具名常量
  - `docs/architecture.md` §2.7：现有架构总览

---

## 1. 现状盘点

### 1.1 总体设计

ccstatusline 把 hook 当作「widget 声明依赖、工具自动安装」：

1. 实现了 hook 依赖的 widget 暴露 `getHooks(): WidgetHookDef[]`。
2. `syncWidgetHooks(settings)`（`src/utils/hooks.ts:55-86`）：
   - 收集 widget 们声明的 `(event, matcher?)` 集合并去重；
   - 清掉 Claude `settings.json` 里所有带 `_tag: 'ccstatusline-managed'` 的旧条目（不动用户自写的 hook）；
   - 为每条新增条目写入 `{ type: "command", command: "<statusLine.command> --hook" }`。
3. `saveSettings`（`src/utils/config.ts:155-171`）每次保存配置后自动触发 `syncWidgetHooks`，让 hook 注册和 widget 集合保持一致。
4. 安装 / 卸载（`installStatusLine` / `uninstallStatusLine`）也会顺带 sync / clean。
5. 运行期：Claude Code 触发 hook → 起 `<command> --hook` 子进程 → 进入 `handleHook`（`src/ccstatusline.ts:325-539`）→ 按 `hook_event_name` 落盘到三类 jsonl，最后 `console.log('{}')` 退出 0。

### 1.2 各 widget 声明的 hook

| Widget | 文件 | `getHooks()` 返回 |
|---|---|---|
| Skills | `src/widgets/Skills.tsx:73-78` | `[{event:'PreToolUse'}, {event:'UserPromptSubmit'}]`（PreToolUse 故意无 matcher，与 ToolCount 共享） |
| ToolCount | `src/widgets/ToolCount.tsx:92-97` | `[{event:'PreToolUse'}, {event:'PostToolUse'}]`（无 matcher） |
| AgentActivity | `src/widgets/AgentActivity.tsx:155-165` | `SUBAGENT_TOOLS.map(t => {event:'PreToolUse', matcher:t})` + `[{event:'SubagentStart'}, {event:'SubagentStop'}, {event:'UserPromptSubmit'}]`（`SUBAGENT_TOOLS = ['Agent']`） |
| TodoProgress | `src/widgets/TodoProgress.tsx:128-135` | `[{event:'PostToolUse', matcher:'TaskCreate'}, {event:'PostToolUse', matcher:'TaskUpdate'}, {event:'PostToolUse', matcher:'TodoWrite'}, {event:'UserPromptSubmit'}]` |

**去重后实际写入 `~/.claude/settings.json` 的事件集**（当四个 widget 都启用时）：

| Event | Matcher | 触发来源 |
|---|---|---|
| `PreToolUse` | （空） | Skills + ToolCount |
| `PreToolUse` | `Agent` | AgentActivity |
| `PostToolUse` | （空） | ToolCount |
| `PostToolUse` | `TaskCreate` | TodoProgress |
| `PostToolUse` | `TaskUpdate` | TodoProgress |
| `PostToolUse` | `TodoWrite` | TodoProgress |
| `UserPromptSubmit` | （空） | Skills + AgentActivity + TodoProgress |
| `SubagentStart` | （空） | AgentActivity |
| `SubagentStop` | （空） | AgentActivity |

### 1.3 `handleHook` 分发逻辑（`src/ccstatusline.ts:325-539`）

按 `hook_event_name` 分支：

| 分支条件 | 落盘 | 备注 |
|---|---|---|
| `PreToolUse` 且 `tool_name === 'Skill'` → 取 `tool_input.skill` | `~/.cache/ccstatusline/skills/<session_id>.jsonl` | Skills widget 数据源 |
| `UserPromptSubmit` 且 prompt 以 `/<name>` 开头 → 提取 name | 同上 | Skills 把 slash 命令也算技能 |
| `UserPromptSubmit`（无前置过滤） | 给 agent-activity 与 todo-progress jsonl 各追加 `event: 'turn'` | 仅当文件已存在时追加 |
| `PreToolUse` 且 `!isSkillTool(tool_name)` | tool-count jsonl `event: 'start'` | Skill 已在专用分支落盘，不二次计 |
| `PostToolUse` 且 `!isSkillTool(tool_name)` 且 `tool_use_id` 非空 | tool-count jsonl `event: 'end'` | 与 start 通过 tool_use_id 配对 |
| `PreToolUse` 且 `isSubagentTool(tool_name)` | agent-activity jsonl `event: 'start'` | 写 `tool_use_id` |
| `SubagentStart` 且有 `agent_id` | agent-activity jsonl `event: 'subagent_start'` | 仅写 `agent_id`（Reader 用 FIFO 与上一条 start 配对） |
| `SubagentStop` 且有 `agent_id` | agent-activity jsonl `event: 'end'` | 写 `agent_id` |
| `PostToolUse` 且 `isTodoTool(tool_name)` | todo-progress jsonl，整快照 | TodoWrite 整体写；TaskCreate/TaskUpdate 走 `applyTodoEvent` 增量合并 |

最终统一 `console.log('{}')` 退出 0，从不阻断。

### 1.4 ccstatusline 没用到的 hook 事件

对照官方文档全表，未注册：

`SessionStart`、`SessionEnd`、`UserPromptExpansion`、`PostToolUseFailure`、`PostToolBatch`、`PermissionRequest`、`PermissionDenied`、`Notification`、`TaskCreated`、`TaskCompleted`、`Stop`、`StopFailure`、`TeammateIdle`、`InstructionsLoaded`、`ConfigChange`、`CwdChanged`、`FileChanged`、`PreCompact`、`PostCompact`、`WorktreeCreate`、`WorktreeRemove`、`Elicitation`、`ElicitationResult`。

---

## 2. 正确性评估

整体结论：**hook 的接入方式与官方语义一致，没有破坏性 bug**。下面按事件 / 设计点逐项评估，标注 ✅（正确）/ ⚠️（值得关注）/ 🐛（轻微问题）。

### 2.1 输入 schema 解析

✅ `HookInput`（`ccstatusline.ts:295-323`）覆盖了实际用到的字段：`session_id`、`hook_event_name`、`tool_name`、`tool_use_id`、`tool_input.{skill, subagent_type, model, description, todos, taskId, status, activeForm, subject, command, ...}`、`tool_response`、`prompt`、`agent_id`、`agent_type`。和官方文档 §8.5 / §8.6 / §8.12 标注的字段一致。
✅ 用 `data.hook_event_name` 分发，没有写死字符串。
✅ 解析失败 catch 后仍正常 `console.log('{}')` 退出，避免污染 Claude。

### 2.2 输出 / 退出码

✅ 始终退出 0，不阻断任何工具调用 — 符合「statusline 只观测、不干预」的产品定位。
⚠️ `console.log('{}')` 是**可省略**的：exit 0 + 空 stdout 在所有事件上都等价。当前写法不会出错（`{}` 解析为空对象，没有任何决策字段），但属于无效负载。
⚠️ `UserPromptSubmit` 写 `{}` 也不会向 Claude context 注入额外内容（因为 stdout 是 `{}` 而不是文本）。这本是预期行为，但如果未来 Claude Code 改为更严格地校验 `additionalContext` schema，需要复测。

### 2.3 Matcher 选择

✅ `PostToolUse:TaskCreate / TaskUpdate / TodoWrite`：用精确字面量，匹配官方「字母数字 `_` `|` 视为字面量」的语义。
✅ `PreToolUse:Agent`：当下 `SUBAGENT_TOOLS = ['Agent']`，正确。`tool-names.ts` 注释提到将来若工具改名（Task → Agent），仅需改这里。
⚠️ `PreToolUse` / `PostToolUse` **空 matcher** 是有意为之（让 Skills / ToolCount 共享条目，靠 `handleHook` 内按 `tool_name` 路由），代码注释里也写了原因。后果：每次工具调用都会触发 hook 子进程。
  - **影响**：Claude Code 单 prompt 内常常发生数十次 tool call，每次都会 spawn `npx ccstatusline --hook`。冷启动单次约 100–300ms，但因为 hook 是与下游模型调用并行执行（官方文档明确 hooks 并行），通常不会成为路径上的 critical path 阻塞，主要成本是 CPU + 文件 IO + 用户机器电力。
  - **替代**：用 `if: "Bash(*)"` 之类的 v2.1.85+ 字段限定到具体工具集，但与现有 widget 自治的设计目标不符。
⚠️ `SubagentStart` / `SubagentStop` 没填 matcher。官方文档说这两个事件的 matcher 是 `agent_type`（`Bash` / `Explore` / `Plan` 或自定义）。当前实现确实需要捕获**所有**子代理（不限类型），所以「不写 matcher」是正确的，只是日后若要按 agent type 区别统计，可以加 matcher 过滤。

### 2.4 PreToolUse / PostToolUse 配对

✅ 用 `tool_use_id` 配对 `start` / `end`：与官方 schema 一致（PreToolUse 与对应的 PostToolUse 共享同一 `tool_use_id`）。
✅ skill 工具被 `!isSkillTool(...)` 跳过 ToolCount 分支，避免和 Skills 双计数 — 与代码注释一致。
🐛 **`PostToolUse` 只在工具成功时触发**（官方 §8.6）。失败由 `PostToolUseFailure` 兜底，但 ccstatusline 没注册 `PostToolUseFailure`，导致：
  - tool-count jsonl 里的 `event: 'end'` 与 `event: 'start'` 数量在工具失败时不匹配；
  - ToolCount 的 `activity` 模式会把失败的工具一直显示成「running」，直到下一次 turn 边界才被回收。
  - 这是当前代码里**最值得跟进的语义偏差**，但影响面集中在 activity 视图、且能被 turn marker 兜住，所以归为 🐛 而非高危。

### 2.5 SubagentStart / SubagentStop 配对

✅ Reader 端（`utils/agent-activity`）用 FIFO 把 `PreToolUse:Agent`（带 `tool_use_id`）和后到的 `subagent_start`（带 `agent_id`）配起来，再用 `SubagentStop`（带 `agent_id`）找到对应 entry 标完成。这是因为：
  - `PreToolUse:Agent` 只有 `tool_use_id`，没有 `agent_id`；
  - `SubagentStart` 只有 `agent_id`，没有 `tool_use_id`；
  - 两者按时间先后 FIFO 配对是当前唯一可行的 join 方式。

✅ 选择 `SubagentStop` 而不是 `PostToolUse:Agent` 作为「结束信号」是正确的：官方语义里，`PostToolUse` 在 `run_in_background` 子代理「启动成功」时就触发，而 `SubagentStop` 才是真正完成。代码注释里也讲清了这个原因。

### 2.6 UserPromptSubmit 作为 turn 边界

✅ 给 agent-activity / todo-progress jsonl 追加 `event: 'turn'` 标记是合理的事件抽象。reader 据此清理「上一 turn 已完成」的 entries，跨 turn 仍 running 的 agent 会保留，符合 product expectation。
✅ 仅当目标文件存在时才追加（避免空文件只放 turn marker），思路严谨。

### 2.7 Skill 触发的两条来源

✅ Skills widget 同时监听 `PreToolUse:Skill`（工具方式调用）与 `UserPromptSubmit` 中的 `/<slash>` 命名（手动斜杠展开）。目前 `UserPromptExpansion` 事件还未启用 — 见 §3 建议。

### 2.8 安装 / 卸载流程

✅ `installStatusLine` 写完 statusLine 后会调用 `syncWidgetHooks`。
✅ `uninstallStatusLine` 删 statusLine + `removeManagedHooks`，干净退出。
✅ 用 `_tag: 'ccstatusline-managed'` namespacing 自己写的 hook，不会破坏用户手工添加的同事件 hook（`hooks.test.ts:43-78` 显式覆盖了这个场景）。
⚠️ `removeManagedHooks` / `syncWidgetHooks` 都通过 `loadClaudeSettings` 做 read-modify-write。当用户在外部编辑器同时改 settings.json，可能因竞态丢更新。`saveClaudeSettings` 有 `.bak` 备份，但没有真锁。低概率，可接受。

### 2.9 `--hook` 路由

✅ `parseConfigArg` 先于 `--hook` 检查执行，`--config` 在两种模式下都能正确生效。
✅ `--hook` 模式既不读配置也不渲染，只做 IO，与正常 piped 渲染路径完全隔离。
⚠️ 命令构造 `<statusLine.command> --hook`：如果用户改用了别名或 wrapper，hook 子进程的命令仍然是 statusLine 配置的字符串原样追加 `--hook`。这是简单可控的策略，但要注意 wrapper 必须把额外的 `--hook` 透传下去。一般情况都满足。

### 2.10 错误兜底

✅ 所有 `fs.appendFileSync` / `fs.mkdirSync` 都在 `try { ... } catch {}` 中，`handleHook` 末尾保证 `console.log('{}')`。即使 hook 内部异常，不会卡住 Claude 工具调用。

### 2.11 与 `tool-names.ts` 的一致性

🐛 `TODO_TOOLS = ['TaskCreate', 'TaskUpdate', 'TaskList']`，`isTodoTool` 据此返回 true，但 `TodoProgress.getHooks()` 只注册 `TaskCreate` / `TaskUpdate`（外加 legacy `TodoWrite`），没注册 `TaskList`。结果：
  - 实际不会有 `TaskList` 的 PostToolUse 事件触达 `handleHook`；
  - `isTodoTool('TaskList') === true` 在 ToolCount 分支不会被跳过 — 但它本来就不在 SKILL_TOOL 列表里，正常按普通工具计数。
  - 所以**没有真 bug**，只是**集合不一致**，未来谁加分支时可能误判。建议 `isTodoTool` 注释加一句「只有 TaskCreate / TaskUpdate 会走 todo-progress 分支」，或把 TaskList 从集合里移除。

### 2.12 和官方推荐用法的差异

| 官方推荐 | ccstatusline 现状 | 评价 |
|---|---|---|
| `Notification` 事件用于「Claude 等待输入」提示 | 未启用 | 缺一个 widget 用 |
| `PostToolUseFailure` 用于失败计数 | 未启用 | 见 §2.4 🐛 |
| `SessionEnd` 用于资源清理 | 未启用 | jsonl 缓存无 GC |
| `SessionStart:compact` 用于压缩后补回上下文 | 未启用 | 与 ccstatusline 职责无直接关系，可不做 |
| `if` 字段（v2.1.85+）做工具参数过滤 | 未使用 | 当前 matcher 已能去重，不必引入 |

---

## 3. 补充建议（哪些没用上的 hook 值得加）

只列「能给 ccstatusline 带来明确产品价值」的事件。每条都给具体场景，避免泛泛。

### 3.1 `PostToolUseFailure`：补齐 ToolCount 的失败语义

- **价值**：今天 PostToolUse 仅在工具成功后触发，ToolCount 的 `activity` 模式会把失败工具长时间显示为 running，直到下一个 turn marker 才被回收。注册 `PostToolUseFailure` 后可以写入 `event: 'fail'` 的 end 标记，让 activity 视图准确区分「正在跑 / 已完成 / 已失败」。
- **配套读取侧改动**：`utils/tool-count` 增加 `fail` 状态识别；可选地在 widget 渲染时把失败 tool 染成红色或带 `✗`。

### 3.2 `Notification`：「Claude 在等你」widget

- **价值**：当前 statusline 是定时刷新的（`refreshInterval`，默认 10s）。当 Claude 弹出权限框 / idle 等待时，用户得切回终端才能看见。新增一个 `NeedsAttention` widget，注册 `Notification` 事件 + matcher `permission_prompt|idle_prompt`，把通知时间戳写进 `~/.cache/ccstatusline/notification/<session_id>.jsonl`，widget 读取最近 N 秒内的通知就显示 `⚠ awaiting`。
- **副作用**：可能与系统通知重复，但终端用户多窗口时的「不抢焦点提醒」场景明确。

### 3.3 `SessionEnd`：jsonl 缓存 GC

- **价值**：`~/.cache/ccstatusline/{skills,tool-count,agent-activity,todo-progress}/<session_id>.jsonl` 当前永远不删，长期会膨胀。注册 `SessionEnd`（matcher `clear|logout|other`），在 `handleHook` 里扫描自己的 cache 目录，按 mtime 删 N 天前的 session 文件即可。
- **谨慎点**：删错文件代价虽然不高（最多丢一个 session 的统计），但建议保留 `--keep-days` 默认 30 天的策略。
- **替代方案**：不挂 hook，改成在 `loadSettings` 时机做异步 GC。优点是不依赖 Claude Code 触发；缺点是冷启动慢一点。

### 3.4 `WorktreeCreate` / `WorktreeRemove`：Worktree 联动

- **价值**：现有 Git Worktree widget 是从 git 命令推断的。如果直接订阅 `WorktreeCreate` / `WorktreeRemove`，可以更早感知 worktree 变化，减少 git 命令开销。
- **但**：当前 widget 设计已经能满足需求（git 命令 ~10ms），引入 hook 收益有限。归 P2。

### 3.5 `PreCompact` / `PostCompact`：压缩动画

- **价值**：用户经常在 compaction 期间不知道发生了什么。注册 `PreCompact` 写「正在压缩」标记，`PostCompact` 写完成。Widget 读最新标记，5s 内显示 `🗜 compact: 800k → 240k`。趣味性大于刚需。归 P2。

### 3.6 `UserPromptExpansion`：与 Skills 配合更精确

- **价值**：今天 Skills 是用 `UserPromptSubmit` 里的 `prompt` 自己正则提取 `/<name>`。改用 `UserPromptExpansion`（新事件，按 skill / command 名 matcher 过滤）可拿到结构化的 `command_name`，少一道字符串解析、且能区分真正的斜杠命令和拷贝粘贴的 `/foo` 文本。
- **顾虑**：需要 Claude Code 较新版本（具体起始版本未在本次调研中确认）；为兼容老版本，可保留 `UserPromptSubmit` 兜底。

### 3.7 不建议引入的事件

- `Stop` / `StopFailure`：观测「Claude 是否在等」的诉求由 `Notification` 已经覆盖；额外引入 Stop 会让 hook 数量增长且收益重复。
- `PermissionRequest` / `PermissionDenied`：会改变 Claude 的权限对话语义，与 statusline 「只看不动」原则冲突。
- `ConfigChange`：用于审计的事件，与显示状态行的产品定位无关。
- `InstructionsLoaded` / `CwdChanged` / `FileChanged`：与 statusline 业务无直接交集，spawn 子进程的成本不划算。

---

## 4. 改进清单（按优先级排序）

工作量量级：**S** ≤ 半天 / **M** 半天到两天 / **L** 两天以上。

| # | 优先级 | 工作量 | 目标 | 落地建议 |
|---|---|---|---|---|
| 1 | **P0** | S | 修：`tool-count` 失败工具会一直显示 `running`，直到 turn 边界才回收 | TodoProgress / ToolCount widget 中给 widget 增加可选 `getHooks()` 返回 `{event:'PostToolUseFailure'}` 并在 `handleHook` 里写 `event:'fail'` jsonl 行；`utils/tool-count` reader 区分 `end` 与 `fail` 两种结束态。新增 `src/utils/__tests__/tool-count-fail.test.ts` 覆盖 |
| 2 | **P1** | S | 优化：`handleHook` 末尾的 `console.log('{}')` 改为 exit 0 + 空 stdout | 删一行；同时跑一遍 `bun test` 验证现有 hook 测试不依赖 `{}` 输出 |
| 3 | **P1** | M | 新增：`NeedsAttention` widget（订阅 `Notification`） | 新建 `src/widgets/NeedsAttention.tsx`，`getHooks()` 返回 `[{event:'Notification', matcher:'permission_prompt|idle_prompt'}]`；`handleHook` 增加分支写 `~/.cache/ccstatusline/notification/<sid>.jsonl`；新建 `utils/notification.ts` reader；widget 渲染最近 30s 内的 attention 标记 |
| 4 | **P1** | S | 修：`isTodoTool` 包含 `TaskList` 但 `TodoProgress.getHooks()` 不监听它，集合不一致 | 在 `tool-names.ts` 注释里说明 `TaskList` 仅用于「这是 todo 家族工具」的语义判断，不参与 `handleHook` 落盘；或者把 `TaskList` 从 `TODO_TOOLS` 拆出（建议后者） |
| 5 | **P2** | M | 新增：`SessionEnd` 触发 jsonl 缓存 GC | 在 `handleHook` 加 `SessionEnd` 分支，扫描 `~/.cache/ccstatusline/*/`，删 30 天前的 session 文件；新增 `utils/cache-gc.ts` + 单测；添加 `--retain-days` 配置（可选）|
| 6 | **P2** | S | 文档：在安装路径选择 TUI 提示「`bunx`/`npm` 每次 hook 都会冷启动 ~100–300ms」 | 在 `installStatusLine` 的 TUI 介绍页加 1–2 行说明；推荐自管模式 |
| 7 | **P2** | M | 优化：Skills 走 `UserPromptExpansion` 取代 `UserPromptSubmit` 的正则解析 | Skills `getHooks()` 增加 `{event:'UserPromptExpansion'}`，handleHook 增加 expansion 分支；保留 `UserPromptSubmit` 正则作为旧版 Claude Code 兼容兜底 |
| 8 | **P2** | M | 新增：Compaction 动画 widget（订阅 `PreCompact` + `PostCompact`） | 价值有限，仅在 P0/P1 都做完后再考虑 |
| 9 | **P2** | S | 加固：`SubagentStart` 加 matcher（按 `agent_type` 列表）以备未来按类型统计 | 把 widget 改成可按需返回 matcher；当前 `unknown` fallback 保持不变 |

---

## 5. 总结

ccstatusline 的 hook 接入是**一套「widget 自描述 → 工具自动 sync」的良好实践**：

- **架构清晰**：写入侧（`syncWidgetHooks`）、读取侧（`handleHook`）解耦；`_tag` namespacing 与用户 hook 共存。
- **语义正确**：所有事件解析、matcher 选择、tool_use_id / agent_id 配对都符合官方文档。
- **失败兜底**：fs IO 全部 try/catch，无论如何 `console.log('{}')` 退出 0，从不阻断 Claude。

唯一**确定会偏离官方语义**的点是「`PostToolUse` 不覆盖失败工具」，需要补 `PostToolUseFailure`（清单 #1，P0）。

其余建议大多围绕「拓展产品功能」展开（Notification / SessionEnd GC / Compaction widget 等），可作为后续独立 issue 推进。

---

## 附录：调研用的 grep 关键词

```text
hook  Hook  SessionStart  SessionEnd  PreToolUse  PostToolUse
Notification  UserPromptSubmit  Stop  SubagentStart  SubagentStop
PreCompact  PostCompact  TaskCreated  TaskCompleted  PermissionRequest
getHooks  WidgetHookDef  syncWidgetHooks  handleHook  HookInput
ccstatusline-managed
```

调研 commit：`b2ca949`（feat/agent-activity-widget），调研日期：2026-04-26。
