import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type NotificationType = 'permission' | 'idle';

export interface NotificationEvent {
    type: NotificationType;
    timestamp: Date;
}

export interface NotificationState {
    type: NotificationType;
    timestamp: Date;
}

function getNotificationDir(): string {
    return path.join(os.homedir(), '.cache', 'ccstatusline', 'notification');
}

export function getNotificationFilePath(sessionId: string): string {
    return path.join(getNotificationDir(), `notification-${sessionId}.jsonl`);
}

function parseEvent(line: string, sessionId: string): NotificationEvent | null {
    try {
        const parsed: unknown = JSON.parse(line);
        if (typeof parsed !== 'object' || parsed === null) {
            return null;
        }
        const record = parsed as Record<string, unknown>;
        if (record.session_id !== sessionId)
            return null;
        if (typeof record.timestamp !== 'string')
            return null;
        const ts = new Date(record.timestamp);
        if (Number.isNaN(ts.getTime()))
            return null;
        if (record.notification_type === 'permission_prompt')
            return { type: 'permission', timestamp: ts };
        if (record.notification_type === 'idle_prompt')
            return { type: 'idle', timestamp: ts };
        return null;
    } catch {
        return null;
    }
}

export function loadNotificationEvents(sessionId: string): NotificationEvent[] {
    const filePath = getNotificationFilePath(sessionId);
    if (!fs.existsSync(filePath))
        return [];

    let content: string;
    try {
        content = fs.readFileSync(filePath, 'utf-8');
    } catch {
        return [];
    }

    const lines = content.split('\n').filter(line => line.trim().length > 0);
    const events: NotificationEvent[] = [];
    for (const line of lines) {
        const event = parseEvent(line, sessionId);
        if (event)
            events.push(event);
    }
    return events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

// Filters events to those within `ttlSec` of `now` and returns the most
// relevant one. permission outranks idle: any permission still in TTL wins
// over any idle, regardless of which is more recent.
export function selectNotificationState(
    events: NotificationEvent[],
    ttlSec: number,
    now: Date = new Date()
): NotificationState | null {
    if (ttlSec <= 0)
        return null;
    const cutoffMs = now.getTime() - ttlSec * 1000;

    let latestPermission: NotificationEvent | null = null;
    let latestIdle: NotificationEvent | null = null;

    for (const event of events) {
        if (event.timestamp.getTime() < cutoffMs)
            continue;
        if (event.type === 'permission') {
            if (!latestPermission || event.timestamp > latestPermission.timestamp) {
                latestPermission = event;
            }
        } else if (!latestIdle || event.timestamp > latestIdle.timestamp) {
            latestIdle = event;
        }
    }

    if (latestPermission)
        return { type: 'permission', timestamp: latestPermission.timestamp };
    if (latestIdle)
        return { type: 'idle', timestamp: latestIdle.timestamp };
    return null;
}
