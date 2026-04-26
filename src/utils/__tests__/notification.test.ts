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
    loadNotificationEvents,
    selectNotificationState,
    type NotificationEvent
} from '../notification';

let testHomeDir = '';

function writeNotificationLog(sessionId: string, lines: string[]): void {
    const filePath = getNotificationFilePath(sessionId);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
}

function eventLine(sessionId: string, type: string, timestamp: string): string {
    return JSON.stringify({
        timestamp,
        session_id: sessionId,
        notification_type: type
    });
}

describe('notification cache path', () => {
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

    it('uses ~/.cache/ccstatusline/notification path', () => {
        expect(getNotificationFilePath('session-1')).toBe(
            path.join(testHomeDir, '.cache', 'ccstatusline', 'notification', 'notification-session-1.jsonl')
        );
    });

    it('returns empty list when file does not exist', () => {
        expect(loadNotificationEvents('missing-session')).toEqual([]);
    });

    it('parses valid permission_prompt and idle_prompt events sorted ascending', () => {
        writeNotificationLog('s1', [
            eventLine('s1', 'idle_prompt', '2026-04-26T10:00:30Z'),
            eventLine('s1', 'permission_prompt', '2026-04-26T10:00:10Z')
        ]);
        const events = loadNotificationEvents('s1');
        expect(events.map(e => e.type)).toEqual(['permission', 'idle']);
        expect(events[0]?.timestamp.toISOString()).toBe('2026-04-26T10:00:10.000Z');
        expect(events[1]?.timestamp.toISOString()).toBe('2026-04-26T10:00:30.000Z');
    });

    it('skips events for other session_ids', () => {
        writeNotificationLog('s1', [
            eventLine('s1', 'permission_prompt', '2026-04-26T10:00:10Z'),
            eventLine('s2', 'idle_prompt', '2026-04-26T10:00:20Z')
        ]);
        const events = loadNotificationEvents('s1');
        expect(events).toHaveLength(1);
        expect(events[0]?.type).toBe('permission');
    });

    it('skips unsupported notification_type values (e.g. auth_success)', () => {
        writeNotificationLog('s1', [
            eventLine('s1', 'auth_success', '2026-04-26T10:00:10Z'),
            eventLine('s1', 'idle_prompt', '2026-04-26T10:00:20Z')
        ]);
        const events = loadNotificationEvents('s1');
        expect(events).toHaveLength(1);
        expect(events[0]?.type).toBe('idle');
    });

    it('skips malformed lines and missing required fields without throwing', () => {
        writeNotificationLog('s1', [
            'not-json',
            JSON.stringify({ session_id: 's1' }), // no timestamp
            JSON.stringify({
                timestamp: '2026-04-26T10:00:10Z',
                session_id: 's1'
            }), // no notification_type
            eventLine('s1', 'permission_prompt', 'not-a-date'),
            eventLine('s1', 'permission_prompt', '2026-04-26T10:00:10Z')
        ]);
        const events = loadNotificationEvents('s1');
        expect(events).toHaveLength(1);
        expect(events[0]?.type).toBe('permission');
    });
});

describe('selectNotificationState', () => {
    function event(type: 'permission' | 'idle', secondsAgo: number, now: Date): NotificationEvent {
        return { type, timestamp: new Date(now.getTime() - secondsAgo * 1000) };
    }

    it('returns null when ttl <= 0', () => {
        const now = new Date('2026-04-26T10:00:00Z');
        const events = [event('permission', 1, now)];
        expect(selectNotificationState(events, 0, now)).toBeNull();
        expect(selectNotificationState(events, -5, now)).toBeNull();
    });

    it('returns null when no events match the TTL window', () => {
        const now = new Date('2026-04-26T10:00:00Z');
        const events = [event('permission', 100, now)];
        expect(selectNotificationState(events, 45, now)).toBeNull();
    });

    it('TTL boundary: ttl=45, event 44s ago renders, event 46s ago does not', () => {
        const now = new Date('2026-04-26T10:00:00Z');
        expect(selectNotificationState([event('permission', 44, now)], 45, now)?.type).toBe('permission');
        expect(selectNotificationState([event('permission', 45, now)], 45, now)?.type).toBe('permission');
        expect(selectNotificationState([event('permission', 46, now)], 45, now)).toBeNull();
    });

    it('permission outranks idle when both are within TTL', () => {
        const now = new Date('2026-04-26T10:00:00Z');
        const events = [
            event('idle', 5, now),
            event('permission', 30, now)
        ];
        expect(selectNotificationState(events, 60, now)?.type).toBe('permission');
    });

    it('falls back to idle when permission has expired but idle is still in TTL', () => {
        const now = new Date('2026-04-26T10:00:00Z');
        const events = [
            event('permission', 90, now),
            event('idle', 10, now)
        ];
        expect(selectNotificationState(events, 60, now)?.type).toBe('idle');
    });

    it('returns the most recent event of the chosen type', () => {
        const now = new Date('2026-04-26T10:00:00Z');
        const events = [
            event('permission', 30, now),
            event('permission', 5, now)
        ];
        const state = selectNotificationState(events, 60, now);
        expect(state?.type).toBe('permission');
        expect(state?.timestamp).toEqual(new Date(now.getTime() - 5000));
    });
});
