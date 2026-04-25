import {
    describe,
    expect,
    it
} from 'vitest';

import {
    LEGACY_TODO_TOOLS,
    SKILL_TOOL,
    SUBAGENT_TOOLS,
    TODO_TOOLS,
    isSkillTool,
    isSubagentTool,
    isTodoTool
} from '../tool-names';

describe('tool-names', () => {
    it('SKILL_TOOL is the literal Skill', () => {
        expect(SKILL_TOOL).toBe('Skill');
    });

    it('SUBAGENT_TOOLS contains Agent', () => {
        expect(SUBAGENT_TOOLS).toContain('Agent');
    });

    it('TODO_TOOLS covers the new incremental suite', () => {
        expect(TODO_TOOLS).toEqual(expect.arrayContaining(['TaskCreate', 'TaskUpdate']));
    });

    it('LEGACY_TODO_TOOLS still lists TodoWrite for backward compat', () => {
        expect(LEGACY_TODO_TOOLS).toContain('TodoWrite');
    });

    it('isTodoTool accepts both new and legacy names', () => {
        expect(isTodoTool('TaskCreate')).toBe(true);
        expect(isTodoTool('TaskUpdate')).toBe(true);
        expect(isTodoTool('TodoWrite')).toBe(true);
        expect(isTodoTool('Agent')).toBe(false);
        expect(isTodoTool('')).toBe(false);
        expect(isTodoTool(undefined)).toBe(false);
    });

    it('isSubagentTool matches Agent', () => {
        expect(isSubagentTool('Agent')).toBe(true);
        expect(isSubagentTool('Task')).toBe(false);
        expect(isSubagentTool(undefined)).toBe(false);
    });

    it('isSkillTool matches Skill', () => {
        expect(isSkillTool('Skill')).toBe(true);
        expect(isSkillTool('skill')).toBe(false);
        expect(isSkillTool(undefined)).toBe(false);
    });
});
