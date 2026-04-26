import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

import {
    classifyNotificationType,
    getNotificationFilePath,
    isWithinTtl,
    loadNotificationState
} from '../notification';

let testHomeDir = '';

function writeNotificationLog(sessionId: string, lines: string[]): void {
    const filePath = getNotificationFilePath(sessionId);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
}

describe('classifyNotificationType', () => {
    it('maps permission_prompt and idle_prompt to internal kinds', () => {
        expect(classifyNotificationType('permission_prompt')).toBe('permission');
        expect(classifyNotificationType('idle_prompt')).toBe('idle');
    });

    it('returns null for unknown or missing types', () => {
        expect(classifyNotificationType(undefined)).toBeNull();
        expect(classifyNotificationType('auth_success')).toBeNull();
        expect(classifyNotificationType('elicitation_dialog')).toBeNull();
    });
});

describe('isWithinTtl', () => {
    const now = new Date('2026-04-26T12:00:00Z');

    it('returns false for null timestamps', () => {
        expect(isWithinTtl(null, 45, now)).toBe(false);
    });

    it('returns true at and inside the ttl window', () => {
        const fortyFourSecsAgo = new Date(now.getTime() - 44_000);
        const exactlyTtl = new Date(now.getTime() - 45_000);
        expect(isWithinTtl(fortyFourSecsAgo, 45, now)).toBe(true);
        expect(isWithinTtl(exactlyTtl, 45, now)).toBe(true);
    });

    it('returns false once past the ttl window', () => {
        const fortySixSecsAgo = new Date(now.getTime() - 46_000);
        expect(isWithinTtl(fortySixSecsAgo, 45, now)).toBe(false);
    });
});

describe('loadNotificationState', () => {
    beforeEach(() => {
        testHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccstatusline-home-'));
        vi.spyOn(os, 'homedir').mockReturnValue(testHomeDir);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        if (testHomeDir) {
            fs.rmSync(testHomeDir, { recursive: true, force: true });
        }
    });

    it('uses ~/.cache/ccstatusline/notification path for jsonl', () => {
        expect(getNotificationFilePath('sess-1')).toBe(
            path.join(testHomeDir, '.cache', 'ccstatusline', 'notification', 'sess-1.jsonl')
        );
    });

    it('returns empty state when no jsonl file exists', () => {
        expect(loadNotificationState('missing')).toEqual({ permission: null, idle: null });
    });

    it('keeps the most recent timestamp for each kind', () => {
        writeNotificationLog('sess-1', [
            JSON.stringify({ timestamp: '2026-04-26T11:59:00Z', notification_type: 'permission_prompt' }),
            JSON.stringify({ timestamp: '2026-04-26T11:58:30Z', notification_type: 'idle_prompt' }),
            JSON.stringify({ timestamp: '2026-04-26T11:59:30Z', notification_type: 'permission_prompt' })
        ]);
        const state = loadNotificationState('sess-1');
        expect(state.permission?.toISOString()).toBe('2026-04-26T11:59:30.000Z');
        expect(state.idle?.toISOString()).toBe('2026-04-26T11:58:30.000Z');
    });

    it('ignores entries without a recognized notification_type', () => {
        writeNotificationLog('sess-1', [
            JSON.stringify({ timestamp: '2026-04-26T11:59:00Z' }),
            JSON.stringify({ timestamp: '2026-04-26T11:59:00Z', notification_type: 'auth_success' }),
            JSON.stringify({ timestamp: '2026-04-26T11:59:00Z', notification_type: 'idle_prompt' })
        ]);
        const state = loadNotificationState('sess-1');
        expect(state.permission).toBeNull();
        expect(state.idle?.toISOString()).toBe('2026-04-26T11:59:00.000Z');
    });

    it('skips malformed lines without throwing', () => {
        writeNotificationLog('sess-1', [
            'not-json',
            JSON.stringify({ timestamp: 'not-a-date', notification_type: 'permission_prompt' }),
            JSON.stringify({ timestamp: '2026-04-26T11:59:00Z', notification_type: 'permission_prompt' })
        ]);
        const state = loadNotificationState('sess-1');
        expect(state.permission?.toISOString()).toBe('2026-04-26T11:59:00.000Z');
    });
});
