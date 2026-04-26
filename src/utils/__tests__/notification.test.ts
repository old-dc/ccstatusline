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
    getNotificationFilePath,
    loadNotificationState,
    parseNotificationKind,
    readNotificationEntries,
    selectActiveNotification,
    type NotificationEntry
} from '../notification';

let testHomeDir = '';

function writeNotificationLog(sessionId: string, lines: string[]): void {
    const filePath = getNotificationFilePath(sessionId);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
}

describe('parseNotificationKind', () => {
    it('returns "permission" for permission_prompt', () => {
        expect(parseNotificationKind('permission_prompt')).toBe('permission');
    });

    it('returns "idle" for idle_prompt', () => {
        expect(parseNotificationKind('idle_prompt')).toBe('idle');
    });

    it('returns null for unknown kinds (auth_success / elicitation_dialog)', () => {
        expect(parseNotificationKind('auth_success')).toBeNull();
        expect(parseNotificationKind('elicitation_dialog')).toBeNull();
        expect(parseNotificationKind('')).toBeNull();
    });

    it('returns null for missing or non-string values', () => {
        expect(parseNotificationKind(undefined)).toBeNull();
        expect(parseNotificationKind(null)).toBeNull();
        expect(parseNotificationKind(123)).toBeNull();
    });
});

describe('selectActiveNotification', () => {
    const NOW = new Date('2026-04-26T10:00:00.000Z');
    const at = (offsetSec: number): Date => new Date(NOW.getTime() + offsetSec * 1000);

    it('returns null when no entries are within the TTL window', () => {
        const entries: NotificationEntry[] = [
            { type: 'permission', timestamp: at(-100) }
        ];
        expect(selectActiveNotification(entries, { ttlSec: 45, now: NOW })).toBeNull();
    });

    it('returns the only matching kind when within TTL', () => {
        const entries: NotificationEntry[] = [
            { type: 'idle', timestamp: at(-10) }
        ];
        const result = selectActiveNotification(entries, { ttlSec: 45, now: NOW });
        expect(result?.type).toBe('idle');
    });

    it('permission wins over idle when both are within TTL (mode=both)', () => {
        const entries: NotificationEntry[] = [
            { type: 'idle', timestamp: at(-5) },
            { type: 'permission', timestamp: at(-30) }
        ];
        const result = selectActiveNotification(entries, { ttlSec: 45, now: NOW });
        expect(result?.type).toBe('permission');
        expect(result?.timestamp).toEqual(at(-30));
    });

    it('falls back to idle when permission is past TTL but idle is still in TTL', () => {
        const entries: NotificationEntry[] = [
            { type: 'permission', timestamp: at(-60) },
            { type: 'idle', timestamp: at(-10) }
        ];
        const result = selectActiveNotification(entries, { ttlSec: 45, now: NOW });
        expect(result?.type).toBe('idle');
    });

    it('mode=permission ignores idle entries even if more recent', () => {
        const entries: NotificationEntry[] = [
            { type: 'idle', timestamp: at(-5) },
            { type: 'permission', timestamp: at(-30) }
        ];
        const result = selectActiveNotification(entries, { mode: 'permission', ttlSec: 45, now: NOW });
        expect(result?.type).toBe('permission');
    });

    it('mode=permission returns null when only idle is in TTL', () => {
        const entries: NotificationEntry[] = [
            { type: 'idle', timestamp: at(-5) }
        ];
        expect(selectActiveNotification(entries, { mode: 'permission', ttlSec: 45, now: NOW })).toBeNull();
    });

    it('mode=idle ignores permission entries', () => {
        const entries: NotificationEntry[] = [
            { type: 'idle', timestamp: at(-30) },
            { type: 'permission', timestamp: at(-5) }
        ];
        const result = selectActiveNotification(entries, { mode: 'idle', ttlSec: 45, now: NOW });
        expect(result?.type).toBe('idle');
    });

    it('exactly at TTL boundary is treated as expired (strict greater-than)', () => {
        const entries: NotificationEntry[] = [
            { type: 'permission', timestamp: at(-45) }
        ];
        // 45s ago with ttl=45s → boundary (excluded), not active
        expect(selectActiveNotification(entries, { ttlSec: 45, now: NOW })).toBeNull();

        // 44s ago with ttl=45s → active
        const inWindow = selectActiveNotification(
            [{ type: 'permission', timestamp: at(-44) }],
            { ttlSec: 45, now: NOW }
        );
        expect(inWindow?.type).toBe('permission');

        // 46s ago with ttl=45s → expired
        const expired = selectActiveNotification(
            [{ type: 'permission', timestamp: at(-46) }],
            { ttlSec: 45, now: NOW }
        );
        expect(expired).toBeNull();
    });

    it('uses the most recent timestamp when several entries of the same kind exist', () => {
        const entries: NotificationEntry[] = [
            { type: 'permission', timestamp: at(-30) },
            { type: 'permission', timestamp: at(-5) },
            { type: 'permission', timestamp: at(-15) }
        ];
        const result = selectActiveNotification(entries, { ttlSec: 45, now: NOW });
        expect(result?.timestamp).toEqual(at(-5));
    });
});

describe('notification jsonl IO', () => {
    beforeEach(() => {
        testHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccstatusline-notif-'));
        vi.spyOn(os, 'homedir').mockReturnValue(testHomeDir);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        if (testHomeDir) {
            fs.rmSync(testHomeDir, { recursive: true, force: true });
        }
    });

    it('uses ~/.cache/ccstatusline/notification path', () => {
        expect(getNotificationFilePath('session-1')).toBe(
            path.join(testHomeDir, '.cache', 'ccstatusline', 'notification', 'session-1.jsonl')
        );
    });

    it('readNotificationEntries returns [] when no file exists', () => {
        expect(readNotificationEntries('missing')).toEqual([]);
    });

    it('returns parsed entries for valid permission/idle records and ignores other kinds', () => {
        writeNotificationLog('session-1', [
            JSON.stringify({
                timestamp: '2026-04-26T10:00:00.000Z',
                session_id: 'session-1',
                notification_type: 'permission_prompt'
            }),
            JSON.stringify({
                timestamp: '2026-04-26T10:00:05.000Z',
                session_id: 'session-1',
                notification_type: 'auth_success'
            }),
            JSON.stringify({
                timestamp: '2026-04-26T10:00:10.000Z',
                session_id: 'session-1',
                notification_type: 'idle_prompt'
            })
        ]);
        const entries = readNotificationEntries('session-1');
        expect(entries.map(e => e.type)).toEqual(['permission', 'idle']);
    });

    it('drops entries belonging to a different session_id', () => {
        writeNotificationLog('session-1', [
            JSON.stringify({
                timestamp: '2026-04-26T10:00:00.000Z',
                session_id: 'other',
                notification_type: 'permission_prompt'
            })
        ]);
        expect(readNotificationEntries('session-1')).toEqual([]);
    });

    it('skips malformed JSON lines without throwing', () => {
        writeNotificationLog('session-1', [
            'not-json',
            JSON.stringify({
                timestamp: '2026-04-26T10:00:00.000Z',
                session_id: 'session-1',
                notification_type: 'idle_prompt'
            }),
            '{"incomplete": '
        ]);
        const entries = readNotificationEntries('session-1');
        expect(entries.map(e => e.type)).toEqual(['idle']);
    });

    it('skips entries with missing notification_type field', () => {
        writeNotificationLog('session-1', [
            JSON.stringify({
                timestamp: '2026-04-26T10:00:00.000Z',
                session_id: 'session-1'
            })
        ]);
        expect(readNotificationEntries('session-1')).toEqual([]);
    });

    it('loadNotificationState picks the active entry through selectActiveNotification', () => {
        const baseTime = new Date('2026-04-26T10:00:00.000Z');
        const ts = (offsetSec: number) => new Date(baseTime.getTime() + offsetSec * 1000).toISOString();
        writeNotificationLog('session-1', [
            JSON.stringify({
                timestamp: ts(-300),
                session_id: 'session-1',
                notification_type: 'permission_prompt'
            }),
            JSON.stringify({
                timestamp: ts(-10),
                session_id: 'session-1',
                notification_type: 'idle_prompt'
            })
        ]);
        const result = loadNotificationState('session-1', { ttlSec: 45, now: baseTime });
        expect(result?.type).toBe('idle');
    });
});
