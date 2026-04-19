// Claude Code tool names referenced in hooks.
// Centralized so future renames (e.g. Task → Agent, TodoWrite →
// TaskCreate/TaskUpdate) only require updating this file.

export const SKILL_TOOL = 'Skill';

export const SUBAGENT_TOOLS = ['Agent'] as const;

export const TODO_TOOLS = ['TaskCreate', 'TaskUpdate', 'TaskList'] as const;

export const LEGACY_TODO_TOOLS = ['TodoWrite'] as const;

const ALL_TODO_TOOLS: readonly string[] = [...TODO_TOOLS, ...LEGACY_TODO_TOOLS];

export function isSkillTool(name: string | undefined): boolean {
    return name === SKILL_TOOL;
}

export function isSubagentTool(name: string | undefined): boolean {
    if (name === undefined)
        return false;
    return (SUBAGENT_TOOLS as readonly string[]).includes(name);
}

export function isTodoTool(name: string | undefined): boolean {
    if (name === undefined || name === '')
        return false;
    return ALL_TODO_TOOLS.includes(name);
}