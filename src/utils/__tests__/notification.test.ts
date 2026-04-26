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

import type { NotificationEntry } from '../../types/NotificationState';
import {
    getNotificationFilePath,
    parseNotificationLine,
    readNotificationEntries,
    selectActiveNotification
} from '../notification';

let testHomeDir = '';

function writeJsonl(sessionId: string, lines: string[]): void {
    const filePath = getNotificationFilePath(sessionId);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
}

function isoMinusSeconds(now: Date, seconds: number): string {
    return new Date(now.getTime() - seconds * 1000).toISOString();
}

describe('notification jsonl path', () => {
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

    it('locates notification jsonl under ~/.cache/ccstatusline/notification', () => {
        expect(getNotificationFilePath('sess-1')).toBe(
            path.join(testHomeDir, '.cache', 'ccstatusline', 'notification', 'sess-1.jsonl')
        );
    });

    it('returns empty list when the file does not exist', () => {
        expect(readNotificationEntries('missing')).toEqual([]);
    });

    it('reads and filters entries by session_id', () => {
        const now = new Date();
        writeJsonl('sess-1', [
            JSON.stringify({
                timestamp: now.toISOString(),
                session_id: 'sess-1',
                notification_type: 'permission_prompt'
            }),
            JSON.stringify({
                timestamp: now.toISOString(),
                session_id: 'sess-2',
                notification_type: 'idle_prompt'
            }),
            JSON.stringify({
                timestamp: now.toISOString(),
                session_id: 'sess-1',
                notification_type: 'idle_prompt',
                message: 'still alive'
            })
        ]);

        const entries = readNotificationEntries('sess-1');
        expect(entries).toHaveLength(2);
        expect(entries.map(e => e.notification_type)).toEqual(['permission_prompt', 'idle_prompt']);
        expect(entries[1]?.message).toBe('still alive');
    });

    it('skips malformed lines without throwing', () => {
        writeJsonl('sess-1', [
            'not-json',
            JSON.stringify({ no: 'session' }),
            JSON.stringify({
                timestamp: new Date().toISOString(),
                session_id: 'sess-1',
                notification_type: 'permission_prompt'
            }),
            JSON.stringify({
                timestamp: new Date().toISOString(),
                session_id: 'sess-1'
            })
        ]);

        const entries = readNotificationEntries('sess-1');
        expect(entries).toHaveLength(1);
    });
});

describe('parseNotificationLine', () => {
    const sessionId = 'sess-1';

    it('returns null for invalid notification_type', () => {
        const line = JSON.stringify({
            timestamp: new Date().toISOString(),
            session_id: sessionId,
            notification_type: 'auth_success'
        });
        expect(parseNotificationLine(line, sessionId)).toBeNull();
    });

    it('returns null when notification_type is missing entirely', () => {
        const line = JSON.stringify({
            timestamp: new Date().toISOString(),
            session_id: sessionId
        });
        expect(parseNotificationLine(line, sessionId)).toBeNull();
    });

    it('returns null when session_id mismatches', () => {
        const line = JSON.stringify({
            timestamp: new Date().toISOString(),
            session_id: 'other',
            notification_type: 'idle_prompt'
        });
        expect(parseNotificationLine(line, sessionId)).toBeNull();
    });

    it('parses a valid permission_prompt entry', () => {
        const ts = new Date().toISOString();
        const line = JSON.stringify({
            timestamp: ts,
            session_id: sessionId,
            notification_type: 'permission_prompt',
            message: 'approve?'
        });
        expect(parseNotificationLine(line, sessionId)).toEqual({
            timestamp: ts,
            session_id: sessionId,
            notification_type: 'permission_prompt',
            message: 'approve?'
        });
    });
});

describe('selectActiveNotification — TTL & priority', () => {
    function entry(seconds: number, type: 'permission_prompt' | 'idle_prompt', now: Date): NotificationEntry {
        return {
            timestamp: isoMinusSeconds(now, seconds),
            session_id: 'sess-1',
            notification_type: type
        };
    }

    it('returns null when there are no entries', () => {
        const now = new Date();
        expect(selectActiveNotification([], { ttlSeconds: 45, now })).toBeNull();
    });

    it('AC-7: permission has priority over idle when both are within TTL', () => {
        const now = new Date();
        const entries: NotificationEntry[] = [
            entry(2, 'idle_prompt', now),
            entry(5, 'permission_prompt', now)
        ];
        const active = selectActiveNotification(entries, { ttlSeconds: 45, now });
        expect(active?.kind).toBe('permission');
    });

    it('AC-8: falls back to idle when permission is past TTL but idle is not', () => {
        const now = new Date();
        const entries: NotificationEntry[] = [
            entry(60, 'permission_prompt', now),
            entry(10, 'idle_prompt', now)
        ];
        const active = selectActiveNotification(entries, { ttlSeconds: 45, now });
        expect(active?.kind).toBe('idle');
    });

    it('AC-3 boundary: 44s within ttl=45 still shows', () => {
        const now = new Date();
        const entries: NotificationEntry[] = [entry(44, 'permission_prompt', now)];
        expect(selectActiveNotification(entries, { ttlSeconds: 45, now })?.kind).toBe('permission');
    });

    it('AC-3 boundary: exactly 45s with ttl=45 still shows (inclusive)', () => {
        const now = new Date();
        const entries: NotificationEntry[] = [entry(45, 'permission_prompt', now)];
        expect(selectActiveNotification(entries, { ttlSeconds: 45, now })?.kind).toBe('permission');
    });

    it('AC-3 boundary: 46s past ttl=45 disappears', () => {
        const now = new Date();
        const entries: NotificationEntry[] = [entry(46, 'permission_prompt', now)];
        expect(selectActiveNotification(entries, { ttlSeconds: 45, now })).toBeNull();
    });

    it('AC-10 mode=permission: ignores idle even when within TTL', () => {
        const now = new Date();
        const entries: NotificationEntry[] = [entry(5, 'idle_prompt', now)];
        expect(selectActiveNotification(entries, { ttlSeconds: 45, mode: 'permission', now }))
            .toBeNull();
    });

    it('AC-10 mode=idle: ignores permission even when within TTL', () => {
        const now = new Date();
        const entries: NotificationEntry[] = [entry(5, 'permission_prompt', now)];
        expect(selectActiveNotification(entries, { ttlSeconds: 45, mode: 'idle', now }))
            .toBeNull();
    });

    it('picks the latest permission timestamp when multiple are present', () => {
        const now = new Date();
        const entries: NotificationEntry[] = [
            entry(40, 'permission_prompt', now),
            entry(10, 'permission_prompt', now)
        ];
        const active = selectActiveNotification(entries, { ttlSeconds: 45, now });
        expect(active?.kind).toBe('permission');
        expect(now.getTime() - (active?.timestamp.getTime() ?? 0)).toBeLessThanOrEqual(11_000);
    });

    it('ignores entries with malformed timestamps', () => {
        const now = new Date();
        const entries: NotificationEntry[] = [
            { timestamp: 'not-a-date', session_id: 'sess-1', notification_type: 'permission_prompt' },
            entry(5, 'idle_prompt', now)
        ];
        expect(selectActiveNotification(entries, { ttlSeconds: 45, now })?.kind).toBe('idle');
    });
});
