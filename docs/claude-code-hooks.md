# Claude Code Hooks 全场景说明

本文档基于 Claude Code 官方文档整理 Claude Code 当前支持的 hook 机制，作为 ccstatusline 内部技术参考。

**资料来源（访问日期：2026-04-26）：**
- [Automate workflows with hooks (hooks-guide)](https://code.claude.com/docs/en/hooks-guide)
- [Hooks reference (hooks)](https://code.claude.com/docs/en/hooks)
- 官方 Markdown 镜像：[hooks.md](https://code.claude.com/docs/en/hooks.md)
- 文档索引：[llms-full.txt](https://code.claude.com/docs/llms-full.txt)

> Hook 是 Claude Code 在自身生命周期的特定时机自动执行的「用户脚本」。它们提供**确定性**控制（不依赖 LLM 自觉调用），用于强制项目规则、自动化任务和与外部工具集成。

---

## 1. 配置位置与 Settings 结构

| 位置 | 作用范围 | 是否可共享 |
|---|---|---|
| `~/.claude/settings.json` | 当前用户的所有项目 | 否（本机） |
| `<project>/.claude/settings.json` | 单个项目 | 是（可入仓） |
| `<project>/.claude/settings.local.json` | 单个项目 | 否（gitignore） |
| Managed policy settings | 整个组织 | 是（管理员控制） |
| Plugin `hooks/hooks.json` | 启用插件时 | 是（随插件分发） |
| Skill / Subagent frontmatter | 活动期间 | 是 |

`settings.json` 的 hook 块结构：

```json
{
  "hooks": {
    "<EventName>": [
      {
        "matcher": "<可选；按事件类型语义不同>",
        "hooks": [
          {
            "type": "command",
            "command": "<shell 命令>",
            "if": "<可选；权限规则语法>",
            "timeout": 600
          }
        ]
      }
    ]
  }
}
```

- 同一 `event` 下可以挂多组（按 matcher 区分），每组里可挂多条 hook。
- 多条 hook 并行执行；命令完全相同的会自动去重。
- 可设 `"disableAllHooks": true` 全局关闭。
- `/hooks` 命令打开只读浏览器，按 event 分组列出已加载的 hook。
- 编辑 settings.json 时，文件 watcher 通常会自动 reload。

---

## 2. Hook 类型（type）

| `type` | 含义 |
|---|---|
| `command` | 执行 shell 命令；通过 stdin / stdout / stderr / exit code 通信。最常用。 |
| `http` | 把事件 JSON POST 到指定 URL，响应体使用与 command 输出相同的 JSON 协议。可配 `headers` + `allowedEnvVars`（白名单环境变量插值）。 |
| `prompt` | 发起单轮 LLM 调用，模型返回 `{"ok": true/false, "reason": "..."}`，由模型判断放行/阻断。默认 Haiku，可指定 `model`。 |
| `agent` | 实验功能。生成子代理用工具实际验证条件后再决策；默认超时 60s、最多 50 次工具调用。 |
| `mcp_tool` | 调用已连接 MCP 服务器上的工具。 |

`SessionStart`、`InstructionsLoaded` 仅支持 `command` 与 `mcp_tool`。

---

## 3. 全部事件总表

| 事件 | 触发时机 | Matcher 过滤项 | 可阻断 |
|---|---|---|---|
| `SessionStart` | 会话开始或恢复 | `startup` / `resume` / `clear` / `compact` | 否（输出可注入 context） |
| `SessionEnd` | 会话结束 | `clear` / `resume` / `logout` / `prompt_input_exit` / `bypass_permissions_disabled` / `other` | 否 |
| `UserPromptSubmit` | 用户提交 prompt 后、Claude 处理前 | 不支持 | ✅ |
| `UserPromptExpansion` | 斜杠命令展开为 prompt 之前 | 命令名（skill / command） | ✅ |
| `PreToolUse` | 工具参数生成完毕、执行前 | 工具名 | ✅ |
| `PostToolUse` | 工具执行成功后立即 | 工具名 | ✅（事后阻断后续） |
| `PostToolUseFailure` | 工具执行失败 | 工具名 | 受限（仅可注入上下文） |
| `PostToolBatch` | 一批并行工具调用全部结束、下次模型调用前 | 不支持 | ✅（中断 agentic loop） |
| `PermissionRequest` | 即将弹出权限确认框 | 工具名 | ✅（可代答 allow/deny） |
| `PermissionDenied` | 自动模式分类器拒绝工具调用 | 工具名 | ❌（仅可标记 retry） |
| `Notification` | Claude Code 推送通知（等待输入、idle 等） | `permission_prompt` / `idle_prompt` / `auth_success` / `elicitation_dialog` | ❌ |
| `SubagentStart` | 子代理被启动 | 代理类型（Bash / Explore / Plan / 自定义） | ❌ |
| `SubagentStop` | 子代理结束 | 代理类型 | ✅（可阻止其停止） |
| `TaskCreated` | 通过 `TaskCreate` 创建任务时 | 不支持 | ✅（可回滚创建） |
| `TaskCompleted` | 任务被标记完成时 | 不支持 | ✅（可阻止完成） |
| `Stop` | Claude 完成回复 | 不支持 | ✅（让 Claude 继续工作） |
| `StopFailure` | 因 API 错误结束本轮 | 错误类型（`rate_limit` / `authentication_failed` / `billing_error` / `invalid_request` / `server_error` / `max_output_tokens` / `unknown`） | ❌（输出和 exit code 都被忽略） |
| `TeammateIdle` | Agent team 成员即将进入 idle | 不支持 | ✅ |
| `InstructionsLoaded` | CLAUDE.md / .claude/rules/*.md 加载到上下文时 | `session_start` / `nested_traversal` / `path_glob_match` / `include` / `compact` | ❌ |
| `ConfigChange` | 会话内配置文件被外部进程修改 | `user_settings` / `project_settings` / `local_settings` / `policy_settings` / `skills` | ✅（policy_settings 除外） |
| `CwdChanged` | Claude 切换工作目录（如 `cd`） | 不支持 | ❌ |
| `FileChanged` | 被 watch 的文件发生变更 | 字面量文件名列表（`.envrc\|.env`） | ❌ |
| `WorktreeCreate` | `--worktree` 或 `isolation: "worktree"` 创建 worktree | 不支持 | ✅（非 0 退出会令创建失败） |
| `WorktreeRemove` | 会话退出或子代理结束时删除 worktree | 不支持 | ❌ |
| `PreCompact` | 上下文压缩前 | `manual` / `auto` | ✅ |
| `PostCompact` | 上下文压缩后 | `manual` / `auto` | ❌ |
| `Elicitation` | MCP server 在工具调用中请求用户输入 | MCP server 名 | ✅（可代答） |
| `ElicitationResult` | 用户回应 MCP elicitation、回写 server 之前 | MCP server 名 | ✅（可改写或阻断） |

事件按生命周期可大致分三档：
- **每会话一次**：`SessionStart`、`SessionEnd`
- **每个轮次**：`UserPromptSubmit`、`Stop`、`StopFailure`、`PostToolBatch`
- **每个工具调用**：`PreToolUse`、`PostToolUse`、`PostToolUseFailure`、`PermissionRequest`、`PermissionDenied`

---

## 4. 通用输入字段

每次事件触发都会通过 stdin 收到 JSON。以下字段对所有事件都可用（除非该事件的 schema 明确说明缺失）：

| 字段 | 说明 |
|---|---|
| `session_id` | 当前会话 ID |
| `transcript_path` | 会话 JSONL 转录文件的绝对路径 |
| `cwd` | 事件触发时的工作目录 |
| `hook_event_name` | 触发的事件名（同 settings 里的 key） |
| `permission_mode` | 当前权限模式：`default` / `plan` / `acceptEdits` / `auto` / `dontAsk` / `bypassPermissions` |
| `agent_id`、`agent_type` | 在子代理上下文中触发时附带 |

事件特定字段见下文「分章节」部分。

---

## 5. 通用输出 / 决策协议

Hook 通过 stdout、stderr、exit code 与 Claude Code 通信：

| Exit code | 含义 |
|---|---|
| `0` | 成功；解析 stdout 当 JSON。`UserPromptSubmit`、`UserPromptExpansion`、`SessionStart` 时 stdout 直接被加入 Claude context。 |
| `2` | **阻断**：忽略 stdout；stderr 作为反馈传给 Claude。 |
| 其它 | 非阻断错误：transcript 上显示 `<hook> hook error` + 第一行 stderr，完整 stderr 进 debug log。 |

> 重要：`exit 2` 和「打印 JSON」**不要混用**。Claude Code 在 exit 2 下不解析 JSON。

### 5.1 结构化 JSON 输出（exit 0 时）

通用顶层字段：

```jsonc
{
  "continue": true,           // 是否继续（仅部分事件支持）
  "stopReason": "...",        // continue=false 时的展示理由
  "suppressOutput": false,    // 隐藏本 hook 的常规日志输出
  "systemMessage": "...",     // 在 transcript 内追加一条系统级提示
  "decision": "block",        // 通用阻断决策（PostToolUse/Stop 等使用）
  "reason": "...",            // decision=block 时的反馈给 Claude 的理由
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    // 事件专属字段，见下文
  }
}
```

### 5.2 多 hook 决策合并

同一事件多个 hook 命中时，每个 hook 各自返回结果，**Claude Code 取最严决策**：
- 任意一个 `PreToolUse` 返回 `deny` → 工具被取消
- 任意一个返回 `ask` → 强制弹权限框（即使其它 hook 都 allow）
- 多个 hook 的 `additionalContext` 会合并保留

---

## 6. Matcher 语法

| 语法 | 行为 |
|---|---|
| 省略 / `""` / `"*"` | 匹配该事件全部 |
| 仅由字母、数字、`_`、`\|` 组成 | 字面量精确匹配；`\|` 表示 OR |
| 含其它字符 | 当作 JavaScript 正则 |

工具事件（`PreToolUse` / `PostToolUse` / `PostToolUseFailure` / `PermissionRequest` / `PermissionDenied`）的工具名匹配示例：

| 用法 | Matcher |
|---|---|
| 单个内置工具 | `Bash` |
| OR 列表 | `Edit\|Write` |
| 全部 MCP | `mcp__.*` |
| 指定 server 全部工具 | `mcp__github__.*` |
| 跨 server 命名模式 | `mcp__.*__write.*` |

`FileChanged` 的 matcher 是「按 `|` 拆分的字面量文件名列表」，不当正则。

### 6.1 `if` 字段（按工具参数过滤，需 v2.1.85+）

仅在工具事件上生效。沿用权限规则语法，能在 hook 进程**生成前**就根据工具参数过滤，避免无谓的 spawn：

```json
{
  "type": "command",
  "if": "Bash(git *)",
  "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/check-git.sh"
}
```

复合命令（`npm test && git push`）会拆分子命令逐一判断，任一子命令命中即触发。

---

## 7. 环境变量

| 变量 | 说明 |
|---|---|
| `CLAUDE_PROJECT_DIR` | 项目根目录绝对路径（`command` hook 内可用，便于引用项目内脚本） |
| `CLAUDE_PLUGIN_ROOT` | 当前插件安装目录 |
| `CLAUDE_PLUGIN_DATA` | 当前插件持久化数据目录 |
| `CLAUDE_ENV_FILE` | 文件路径；写入这里的 `export` 会被 Claude 在每条 Bash 命令前 source。仅 `SessionStart` / `CwdChanged` / `FileChanged` 可用 |
| `CLAUDE_CODE_REMOTE` | 远程 Web 环境下被设为 `"true"` |

---

## 8. 各事件分章节细节

### 8.1 SessionStart

- **触发**：会话启动或恢复（首次进入、`/resume`、`/clear`、压缩后续传）
- **支持 type**：`command`、`mcp_tool`
- **stdin 主要字段**：通用 + `source`（`startup` / `resume` / `clear` / `compact`）+ `model` + 可选 `agent_type`
- **可用环境变量**：`CLAUDE_ENV_FILE`
- **输出语义**：
  - exit 0、stdout 内容 → 直接注入 Claude context（适合给本会话「开局补一段说明」）
  - 也可返回 `additionalContext`、`continue`、`stopReason`、`systemMessage`
- **典型用途**：
  - 在 `compact` 触发时重新注入项目约定，补回压缩丢掉的关键信息
  - 用 `direnv export bash > "$CLAUDE_ENV_FILE"` 加载目录级环境变量

### 8.2 SessionEnd

- **触发**：会话退出
- **stdin 主要字段**：通用 + `reason`
- **输出语义**：exit code 被忽略；用于审计和清理
- **典型用途**：清理 `~/.cache/<your-tool>/<session_id>/` 临时文件、上传本会话 telemetry

### 8.3 UserPromptSubmit

- **触发**：用户回车提交 prompt 后、Claude 收到前
- **stdin 主要字段**：通用 + `permission_mode` + `prompt`（提交的原始文本）
- **输出语义**：
  - exit 0 + stdout 文本 → 拼入 Claude 上下文
  - `{"decision": "block", "reason": "..."}` → 提示用户被拦截
  - `{"hookSpecificOutput": {"additionalContext": "..."}}` → 仅注入上下文不影响显示
  - `sessionTitle` 字段可改 session 标题
- **典型用途**：把内部知识库片段、当前 sprint 目标等动态注入；按用户输入做敏感词拦截

### 8.4 UserPromptExpansion

- **触发**：斜杠命令展开成最终 prompt 之前（在 `UserPromptSubmit` 前）
- **stdin 主要字段**：通用 + `permission_mode` + `expansion_type`（`slash_command` / `mcp_prompt`）+ `command_name` + `command_args` + `command_source` + `prompt`
- **输出语义**：可用 `decision: "block"` 阻止展开、`additionalContext` 注入背景
- **典型用途**：审计 / 拦截危险斜杠命令；为某些命令补充模板上下文

### 8.5 PreToolUse

- **触发**：Claude 决定调用工具、参数已敲定，但未执行
- **stdin 主要字段**：通用 + `permission_mode` + `tool_name` + `tool_input` + `tool_use_id`
  - `tool_input` 内容因工具而异：
    - `Bash`：`command`、`description`、`timeout`、`run_in_background`
    - `Edit`：`file_path`、`old_string`、`new_string`、`replace_all`
    - `Write`：`file_path`、`content`
    - `Read`：`file_path`、`offset`、`limit`
    - `Glob`：`pattern`、`path`
    - `Grep`：`pattern`、`path`、`glob`、`output_mode`、`-i`、`multiline` 等
    - `WebFetch`：`url`、`prompt`
    - `WebSearch`：`query`、`allowed_domains`、`blocked_domains`
    - `Agent`：`prompt`、`description`、`subagent_type`、`model`
    - MCP 工具：`mcp__<server>__<tool>`，`tool_input` 由 MCP 决定
- **输出语义**（`hookSpecificOutput`）：
  - `permissionDecision`：`allow` / `deny` / `ask` / `defer`
  - `permissionDecisionReason`：解释字符串
  - `updatedInput`：可改写工具参数（多个 hook 同时改时**最后写入者赢**）
  - `additionalContext`：附加给 Claude 的上下文
- **重要**：`PreToolUse` 在权限模式判断**之前**触发。Hook 的 `deny` 即使在 `bypassPermissions` 下也生效；但 `allow` 不能绕过 deny 规则。
- **典型用途**：
  - `protect-files.sh`：拦截对 `.env`、`.git/`、`package-lock.json` 等敏感文件的修改
  - `bash-validator.sh`：检查 Bash 命令含 `drop table` 等危险动词
  - 把 `npm` 改写成 `bun`（`updatedInput`）
- **官方示例**：[bash_command_validator_example.py](https://github.com/anthropics/claude-code/blob/main/examples/hooks/bash_command_validator_example.py)

### 8.6 PostToolUse

- **触发**：工具调用**成功**返回后立即（失败走 `PostToolUseFailure`）
- **stdin 主要字段**：通用 + `permission_mode` + `tool_name` + `tool_input` + `tool_response` + `tool_use_id` + `duration_ms`
- **输出语义**：`decision: "block"` + `reason` 让 Claude 收到反馈并调整；`additionalContext` 注入；MCP 工具可用 `updatedMCPToolOutput` 改写工具输出
- **限制**：工具已执行，无法回滚
- **典型用途**：
  - `Edit|Write` 之后跑 `prettier --write`
  - 记录每条 Bash 命令到日志（`jq -r '.tool_input.command' >> ~/cmd.log`）

### 8.7 PostToolUseFailure

- **触发**：工具执行失败（异常、超时、被中断等）
- **stdin 主要字段**：通用 + `tool_name` + `tool_input` + `tool_use_id` + `error` + `is_interrupt` + `duration_ms`
- **输出语义**：限制较多，主要用于注入 `additionalContext`
- **典型用途**：失败计数、把外部诊断信息回灌到 Claude

### 8.8 PostToolBatch

- **触发**：一批并行工具调用全部结束、下一次模型调用前
- **stdin 主要字段**：通用 + `tool_calls`（数组，含每个调用的 input/response/error）
- **输出语义**：可 `decision: "block"` 中断 agentic loop
- **典型用途**：批量验证、批次后跑一次性 lint / 测试

### 8.9 PermissionRequest

- **触发**：Claude Code 即将向用户弹出权限确认框
- **stdin 主要字段**：通用 + `tool_name` + `tool_input` + `permission_suggestions`
- **输出语义**（`hookSpecificOutput.decision`）：
  - `behavior: "allow"`：替用户回答「允许」，可附 `updatedInput` / `updatedPermissions` / `message`
  - `behavior: "deny"`：替用户回答「拒绝」，可附 `message` / `interrupt`
- **`updatedPermissions`** 可执行的更新类型：
  - `addRules` / `replaceRules` / `removeRules`
  - `setMode`（mode：`default` / `acceptEdits` / `bypassPermissions` 等）
  - `addDirectories` / `removeDirectories`
  - 每条都带 `destination`：`session` / `localSettings` / `projectSettings` / `userSettings`
- **限制**：在非交互模式（`-p`）下不会触发，请改用 `PreToolUse`
- **典型用途**：自动放行 `ExitPlanMode` 等高频确认；进入 `acceptEdits` 模式

### 8.10 PermissionDenied

- **触发**：自动模式分类器拒绝了某个工具调用
- **stdin 主要字段**：通用 + `tool_name` + `tool_input` + `tool_use_id` + `denial_reason`
- **输出语义**：`hookSpecificOutput.retry: true` 告诉模型「可以再试」
- **典型用途**：根据补充策略允许重试

### 8.11 Notification

- **触发**：Claude Code 推送通知（等待用户操作、auth 成功、idle 提示等）
- **stdin 主要字段**：通用 + `notification_type` + `message`
- **输出语义**：观测性事件，exit code 被忽略
- **典型用途**：
  - macOS：`osascript -e 'display notification ...'`
  - Linux：`notify-send`
  - Windows：PowerShell `MessageBox`

### 8.12 SubagentStart / SubagentStop

- **触发**：子代理被启动 / 子代理结束
- **stdin 主要字段**：通用 + `agent_id` + `agent_type` + （Start）`prompt` / `description` / `model` + （Stop）`stop_reason`
- **输出语义**：
  - SubagentStart：观测性
  - SubagentStop：可用 `decision: "block"` 阻止它停下
- **典型用途**：跟踪子代理活跃状态、强制完成度校验

### 8.13 TaskCreated / TaskCompleted

- **触发**：通过 `TaskCreate` 创建任务 / 任务被标记完成
- **stdin 主要字段**：通用 + `task_id` + （Created）`task_input` / （Completed）`completion_input`
- **输出语义**：可 `decision: "block"` 拦截
- **典型用途**：审计任务流；强制任务必须先有 PR / 测试才能 complete

### 8.14 Stop / StopFailure

- **Stop**：Claude 完成回复（用户中断不触发）
  - stdin：通用 + `stop_reason` + `model` + `input_tokens` + `output_tokens`
  - `decision: "block"` 让 Claude 继续
  - **注意**：Stop hook 内必须检查 `stop_hook_active` 字段，避免无限循环：

    ```bash
    INPUT=$(cat)
    if [ "$(echo "$INPUT" | jq -r '.stop_hook_active')" = "true" ]; then
      exit 0
    fi
    ```

  - 适合搭配 `type: "prompt"` / `"agent"` 跑「质量门」（如「测试是否全过」）
- **StopFailure**：因 API 错误结束（`rate_limit` / `authentication_failed` 等）
  - stdin：通用 + `error_type` + `error_message`
  - **输出和 exit code 都被忽略**，纯观测

### 8.15 TeammateIdle

- **触发**：Agent team 中某个 teammate 即将进入 idle
- stdin：通用 + `agent_id` + `agent_type`
- 输出可 `decision: "block"` 阻止 idle，配合 `continue: false` + `stopReason`

### 8.16 InstructionsLoaded

- **触发**：CLAUDE.md / `.claude/rules/*.md` 被加载到 context
- stdin：通用 + `file_path` + `memory_type`（User/Project/Local/Managed）+ `load_reason` + `globs` + `trigger_file_path` + `parent_file_path`
- 仅观测；支持 `command` 与 `mcp_tool` 类型

### 8.17 ConfigChange

- **触发**：会话内某个配置文件被外部修改
- stdin：通用 + `source`（`user_settings` / `project_settings` / `local_settings` / `policy_settings` / `skills`）+ `changed_fields`
- 可 `decision: "block"` 拒绝改动（`policy_settings` 除外）
- 典型用途：审计配置变更、合规拦截

### 8.18 CwdChanged / FileChanged

- **CwdChanged**：cwd 变更时（如 Claude 跑了 `cd`）
  - stdin：通用 + `old_cwd` + `new_cwd`
  - 可写 `CLAUDE_ENV_FILE`
- **FileChanged**：被 watch 的文件发生变化
  - stdin：通用 + `file_path` + `change_type`（`created` / `modified` / `deleted`）
  - matcher 是字面量文件名 `|` 列表，不是正则
  - 可写 `CLAUDE_ENV_FILE`
- 典型用途：与 direnv / devbox / nix 集成自动同步环境变量

### 8.19 PreCompact / PostCompact

- **PreCompact**：上下文压缩前
  - stdin：通用 + `trigger`（`manual` / `auto`）+ `estimated_tokens_saved`
  - 可 `decision: "block"` 阻止压缩
- **PostCompact**：压缩后
  - stdin：通用 + `trigger` + `tokens_before` + `tokens_after`
  - 仅观测

### 8.20 WorktreeCreate / WorktreeRemove

- **WorktreeCreate**：通过 `--worktree` 或 `isolation: "worktree"` 创建 worktree
  - stdin：通用 + `worktree_name` + `base_path`
  - **command hook**：把 worktree 路径写到 stdout（这是创建结果），非 0 退出会让创建失败
  - **HTTP hook**：在响应里返回 `hookSpecificOutput.worktreePath`
- **WorktreeRemove**：worktree 被销毁时（会话退出 / 子代理结束）
  - stdin：通用 + `worktree_name` + `worktree_path`
  - 失败仅记入 debug 日志

### 8.21 Elicitation / ElicitationResult

- **Elicitation**：MCP server 在工具调用过程中需要用户输入
  - stdin：通用 + `server_name` + `tool_name` + `form_fields`
  - `hookSpecificOutput.action`：`accept` / `decline` / `cancel`，accept 时 `content` 给字段填值
- **ElicitationResult**：用户回应已收集，回写 server 之前
  - stdin：上面的内容 + `form_response`
  - 可 `action: "accept"` + `content` 改写、`decline` 阻断（exit 2 等价）

---

## 9. 限制与排错

### 9.1 已知限制

- Hook 默认超时 10 分钟，可在 hook 项里 `"timeout": <秒>` 修改。
- Hook 不能触发 `/` 命令或工具调用；只能通过 stdout / stderr / exit code 与 Claude 通信。`additionalContext` 是「系统提醒」，Claude 当文本看。
- `PostToolUse` 无法撤销已发生的副作用。
- `PermissionRequest` 在非交互模式（`-p`）下不触发，需用 `PreToolUse` 兜底。
- `Stop` 不在用户主动中断时触发。
- 多个 `PreToolUse` 同时返回 `updatedInput` 时**最后写入者赢**（并行执行，顺序不确定）。
- `bypassPermissions` 不能由 hook 写入 `defaultMode`；必须会话启动时已开放该模式。

### 9.2 常见坑

- **shell profile 输出污染 JSON**：Hook 在非交互 shell 中跑，但仍会 source `~/.zshrc` / `~/.bashrc`。如果 profile 里有 unconditional `echo`，会被拼到 hook stdout 前面，导致 JSON 解析失败。修复：

  ```bash
  if [[ $- == *i* ]]; then
    echo "Shell ready"
  fi
  ```

- **找不到命令**：用 `$CLAUDE_PROJECT_DIR` 或绝对路径引用脚本；脚本要有可执行位（`chmod +x`）。
- **死循环**：`Stop` hook 必须先看 `stop_hook_active`。
- **Matcher 大小写敏感**。

### 9.3 调试

- `Ctrl+O` 切换 transcript 视图，能看到每个 hook 的一行总结。
- `claude --debug-file /tmp/claude.log` 启动时启 debug log；运行中 `/debug` 也能开。
- 手动测：`echo '{"tool_name":"Bash","tool_input":{"command":"ls"}}' | ./my-hook.sh`，再 `echo $?`。

---

## 10. 安全注意

> 摘自 [hooks#security-considerations](https://code.claude.com/docs/en/hooks)。

- Hook 命令是用户自己写的，**完全继承用户的 shell 权限**，没有沙箱。
- 部署到团队前请审计：路径是否绝对、外部命令是否受信任、是否有 `eval` / 模板注入面。
- 在共享仓库 `.claude/settings.json` 里挂的 hook 会自动跑在每个克隆者机器上。建议这类敏感 hook 放在 `.claude/settings.local.json`（gitignore），或写明 `if` 限制范围。

---

## 附：参考链接（访问日期 2026-04-26）

- [Hooks reference](https://code.claude.com/docs/en/hooks)（重定向自 docs.anthropic.com）
- [Automate workflows with hooks (guide)](https://code.claude.com/docs/en/hooks-guide)
- [Markdown 镜像](https://code.claude.com/docs/en/hooks.md)
- [文档全索引 llms-full.txt](https://code.claude.com/docs/llms-full.txt)
- [Agent SDK hooks](https://code.claude.com/docs/en/agent-sdk/hooks)
- [Bash command validator example](https://github.com/anthropics/claude-code/blob/main/examples/hooks/bash_command_validator_example.py)
- [Permissions 文档](https://code.claude.com/docs/en/permissions)
- [Plugins 文档](https://code.claude.com/docs/en/plugins)
