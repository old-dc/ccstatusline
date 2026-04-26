import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    afterAll,
    afterEach,
    beforeEach,
    describe,
    expect,
    it
} from 'vitest';

import type { Settings } from '../../types/Settings';
import { DEFAULT_SETTINGS } from '../../types/Settings';
import { syncWidgetHooks } from '../hooks';

const STATUS_LINE_COMMAND = 'bunx ccstatusline';

function settingsWithLines(lines: Settings['lines']): Settings {
    return { ...DEFAULT_SETTINGS, lines };
}

function writeClaudeStatusLine(): void {
    fs.writeFileSync(getClaudeSettingsPath(), JSON.stringify({ statusLine: { type: 'command', command: STATUS_LINE_COMMAND } }, null, 2), 'utf-8');
}

function readManagedHook(event: string): { matcher?: string; hooks?: { command?: string }[] } | undefined {
    const saved = JSON.parse(fs.readFileSync(getClaudeSettingsPath(), 'utf-8')) as { hooks?: Record<string, { _tag?: string; matcher?: string; hooks?: { command?: string }[] }[]> };
    return saved.hooks?.[event]?.find(entry => entry._tag === 'ccstatusline-managed');
}

const ORIGINAL_CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR;
let testClaudeConfigDir = '';

function getClaudeSettingsPath(): string {
    return path.join(testClaudeConfigDir, 'settings.json');
}

describe('syncWidgetHooks', () => {
    beforeEach(() => {
        testClaudeConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccstatusline-hooks-'));
        process.env.CLAUDE_CONFIG_DIR = testClaudeConfigDir;
    });

    afterEach(() => {
        if (testClaudeConfigDir) {
            fs.rmSync(testClaudeConfigDir, { recursive: true, force: true });
        }
    });

    afterAll(() => {
        if (ORIGINAL_CLAUDE_CONFIG_DIR === undefined) {
            delete process.env.CLAUDE_CONFIG_DIR;
        } else {
            process.env.CLAUDE_CONFIG_DIR = ORIGINAL_CLAUDE_CONFIG_DIR;
        }
    });

    it('removes managed hooks and persists cleanup when status line is unset', async () => {
        const settingsPath = getClaudeSettingsPath();
        fs.writeFileSync(settingsPath, JSON.stringify({
            hooks: {
                PreToolUse: [
                    {
                        _tag: 'ccstatusline-managed',
                        matcher: 'Skill',
                        hooks: [{ type: 'command', command: 'old-command --hook' }]
                    },
                    {
                        matcher: 'Other',
                        hooks: [{ type: 'command', command: 'keep-command' }]
                    }
                ],
                UserPromptSubmit: [
                    {
                        _tag: 'ccstatusline-managed',
                        hooks: [{ type: 'command', command: 'old-command --hook' }]
                    }
                ]
            }
        }, null, 2), 'utf-8');

        await syncWidgetHooks(DEFAULT_SETTINGS);

        const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as { hooks?: Record<string, unknown[]> };
        expect(saved.hooks).toEqual({
            PreToolUse: [
                {
                    matcher: 'Other',
                    hooks: [{ type: 'command', command: 'keep-command' }]
                }
            ]
        });
    });

    it('registers a Notification hook with the permission_prompt|idle_prompt matcher when a NeedsAttention widget is configured', async () => {
        writeClaudeStatusLine();

        const settings = settingsWithLines([[
            { id: 'na-1', type: 'needs-attention' }
        ]]);

        await syncWidgetHooks(settings);

        const entry = readManagedHook('Notification');
        expect(entry).toBeDefined();
        expect(entry?.matcher).toBe('permission_prompt|idle_prompt');
        expect(entry?.hooks?.[0]?.command).toBe(`${STATUS_LINE_COMMAND} --hook`);
    });

    it('removes the Notification hook after the NeedsAttention widget is removed', async () => {
        writeClaudeStatusLine();

        await syncWidgetHooks(settingsWithLines([[
            { id: 'na-1', type: 'needs-attention' }
        ]]));
        expect(readManagedHook('Notification')).toBeDefined();

        await syncWidgetHooks(settingsWithLines([[]]));

        const saved = JSON.parse(fs.readFileSync(getClaudeSettingsPath(), 'utf-8')) as { hooks?: Record<string, unknown[]> };
        expect(saved.hooks?.Notification).toBeUndefined();
    });

    it('writes only one Notification hook entry when multiple NeedsAttention widgets are configured', async () => {
        writeClaudeStatusLine();

        await syncWidgetHooks(settingsWithLines([[
            { id: 'na-1', type: 'needs-attention', metadata: { mode: 'permission' } },
            { id: 'na-2', type: 'needs-attention', metadata: { mode: 'idle' } },
            { id: 'na-3', type: 'needs-attention' }
        ]]));

        const saved = JSON.parse(fs.readFileSync(getClaudeSettingsPath(), 'utf-8')) as { hooks?: Record<string, { _tag?: string; matcher?: string }[]> };
        const notificationEntries = saved.hooks?.Notification ?? [];
        const managed = notificationEntries.filter(e => e._tag === 'ccstatusline-managed');
        expect(managed).toHaveLength(1);
        expect(managed[0]?.matcher).toBe('permission_prompt|idle_prompt');
    });
});
