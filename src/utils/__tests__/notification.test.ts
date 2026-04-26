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
    classifyNotification,
    getNotificationFilePath,
    getNotificationLatest,
    resolveNotificationState
} from '../notification';

let testHomeDir = '';

function writeNotificationLog(sessionId: string, lines: string[]): void {
    const logPath = getNotificationFilePath(sessionId);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, lines.join('\n'), 'utf-8');
}

describe('notification utility', () => {
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
        expect(getNotificationFilePath('sid-1')).toBe(
            path.join(testHomeDir, '.cache', 'ccstatusline', 'notification', 'sid-1.jsonl')
        );
    });

    describe('classifyNotification', () => {
        it('maps permission_prompt to permission and idle_prompt to idle', () => {
            expect(classifyNotification('permission_prompt')).toBe('permission');
            expect(classifyNotification('idle_prompt')).toBe('idle');
        });

        it('returns null for unknown or missing types', () => {
            expect(classifyNotification('auth_success')).toBeNull();
            expect(classifyNotification('elicitation_dialog')).toBeNull();
            expect(classifyNotification(undefined)).toBeNull();
            expect(classifyNotification('')).toBeNull();
        });
    });

    describe('getNotificationLatest', () => {
        it('returns null when log file does not exist', () => {
            expect(getNotificationLatest('missing-session')).toBeNull();
        });

        it('returns null when sessionId is empty', () => {
            expect(getNotificationLatest('')).toBeNull();
        });

        it('reports the most recent timestamp per kind, ignoring other sessions', () => {
            const t = '2026-04-26T12:00:00.000Z';
            writeNotificationLog('sid-1', [
                JSON.stringify({ timestamp: t, session_id: 'sid-1', notification_type: 'permission_prompt' }),
                JSON.stringify({ timestamp: '2026-04-26T12:00:30.000Z', session_id: 'sid-1', notification_type: 'permission_prompt' }),
                JSON.stringify({ timestamp: '2026-04-26T12:01:00.000Z', session_id: 'sid-1', notification_type: 'idle_prompt' }),
                JSON.stringify({ timestamp: '2026-04-26T12:02:00.000Z', session_id: 'other-session', notification_type: 'permission_prompt' })
            ]);

            const latest = getNotificationLatest('sid-1');
            expect(latest?.permission?.toISOString()).toBe('2026-04-26T12:00:30.000Z');
            expect(latest?.idle?.toISOString()).toBe('2026-04-26T12:01:00.000Z');
        });

        it('silently drops malformed lines, missing notification_type, and unknown types', () => {
            writeNotificationLog('sid-1', [
                'not json',
                JSON.stringify({ timestamp: '2026-04-26T12:00:00.000Z', session_id: 'sid-1' }),
                JSON.stringify({ timestamp: '2026-04-26T12:00:00.000Z', session_id: 'sid-1', notification_type: 'auth_success' }),
                JSON.stringify({ timestamp: 'not-a-date', session_id: 'sid-1', notification_type: 'permission_prompt' }),
                JSON.stringify({ timestamp: '2026-04-26T12:00:01.000Z', session_id: 'sid-1', notification_type: 'idle_prompt' })
            ]);

            const latest = getNotificationLatest('sid-1');
            expect(latest?.permission).toBeNull();
            expect(latest?.idle?.toISOString()).toBe('2026-04-26T12:00:01.000Z');
        });
    });

    describe('resolveNotificationState', () => {
        const eventTime = new Date('2026-04-26T12:00:00.000Z');

        it('returns null when latest is null', () => {
            expect(resolveNotificationState(null, 45)).toBeNull();
        });

        it('prefers permission over idle when both are within TTL', () => {
            const now = new Date(eventTime.getTime() + 5_000);
            const state = resolveNotificationState(
                { permission: eventTime, idle: eventTime },
                45,
                { now }
            );
            expect(state?.type).toBe('permission');
        });

        it('falls back to idle when permission is past TTL but idle is fresh', () => {
            const idleTime = new Date(eventTime.getTime() + 60_000);
            const now = new Date(eventTime.getTime() + 70_000);
            const state = resolveNotificationState(
                { permission: eventTime, idle: idleTime },
                45,
                { now }
            );
            expect(state?.type).toBe('idle');
            expect(state?.timestamp.toISOString()).toBe(idleTime.toISOString());
        });

        it('returns the entry exactly at TTL boundary (44s, 45s) and drops 46s', () => {
            const ttl = 45;
            const at44 = resolveNotificationState(
                { permission: eventTime, idle: null },
                ttl,
                { now: new Date(eventTime.getTime() + 44_000) }
            );
            const at45 = resolveNotificationState(
                { permission: eventTime, idle: null },
                ttl,
                { now: new Date(eventTime.getTime() + 45_000) }
            );
            const at46 = resolveNotificationState(
                { permission: eventTime, idle: null },
                ttl,
                { now: new Date(eventTime.getTime() + 46_000) }
            );

            expect(at44?.type).toBe('permission');
            expect(at45?.type).toBe('permission');
            expect(at46).toBeNull();
        });

        it('mode=permission ignores idle entries entirely', () => {
            const now = new Date(eventTime.getTime() + 5_000);
            const state = resolveNotificationState(
                { permission: null, idle: eventTime },
                45,
                { now, mode: 'permission' }
            );
            expect(state).toBeNull();
        });

        it('mode=idle ignores permission entries entirely', () => {
            const now = new Date(eventTime.getTime() + 5_000);
            const state = resolveNotificationState(
                { permission: eventTime, idle: null },
                45,
                { now, mode: 'idle' }
            );
            expect(state).toBeNull();
        });
    });
});
