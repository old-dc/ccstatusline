import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type {
    ActiveNotification,
    NotificationEntry,
    NotificationType
} from '../types/NotificationState';

function getNotificationDir(): string {
    return path.join(os.homedir(), '.cache', 'ccstatusline', 'notification');
}

export function getNotificationFilePath(sessionId: string): string {
    return path.join(getNotificationDir(), `${sessionId}.jsonl`);
}

function isNotificationType(value: unknown): value is NotificationType {
    return value === 'permission_prompt' || value === 'idle_prompt';
}

export function parseNotificationLine(line: string, sessionId: string): NotificationEntry | null {
    try {
        const parsed: unknown = JSON.parse(line);
        if (typeof parsed !== 'object' || parsed === null) {
            return null;
        }
        const record = parsed as Record<string, unknown>;
        if (record.session_id !== sessionId) {
            return null;
        }
        if (typeof record.timestamp !== 'string') {
            return null;
        }
        if (!isNotificationType(record.notification_type)) {
            return null;
        }
        const entry: NotificationEntry = {
            timestamp: record.timestamp,
            session_id: record.session_id,
            notification_type: record.notification_type
        };
        if (typeof record.message === 'string') {
            entry.message = record.message;
        }
        return entry;
    } catch {
        return null;
    }
}

export function readNotificationEntries(sessionId: string): NotificationEntry[] {
    const filePath = getNotificationFilePath(sessionId);
    if (!fs.existsSync(filePath)) {
        return [];
    }
    let raw: string;
    try {
        raw = fs.readFileSync(filePath, 'utf-8');
    } catch {
        return [];
    }
    const entries: NotificationEntry[] = [];
    for (const line of raw.split('\n')) {
        if (!line.trim())
            continue;
        const parsed = parseNotificationLine(line, sessionId);
        if (parsed)
            entries.push(parsed);
    }
    return entries;
}

interface ResolveOptions {
    ttlSeconds: number;
    mode?: 'both' | 'permission' | 'idle';
    now?: Date;
}

// Pure function — takes parsed entries + ttl + now, returns active label.
// permission > idle priority. Within each kind, the most recent timestamp wins.
export function selectActiveNotification(
    entries: NotificationEntry[],
    options: ResolveOptions
): ActiveNotification | null {
    const mode = options.mode ?? 'both';
    const now = options.now ?? new Date();
    const ttlMs = Math.max(0, options.ttlSeconds * 1000);
    const cutoffMs = now.getTime() - ttlMs;

    let latestPermission: Date | null = null;
    let latestIdle: Date | null = null;

    for (const entry of entries) {
        const ts = Date.parse(entry.timestamp);
        if (Number.isNaN(ts))
            continue;
        if (ts < cutoffMs)
            continue;
        if (entry.notification_type === 'permission_prompt') {
            if (latestPermission === null || ts > latestPermission.getTime()) {
                latestPermission = new Date(ts);
            }
        } else if (latestIdle === null || ts > latestIdle.getTime()) {
            latestIdle = new Date(ts);
        }
    }

    if (mode !== 'idle' && latestPermission !== null) {
        return { kind: 'permission', timestamp: latestPermission };
    }
    if (mode !== 'permission' && latestIdle !== null) {
        return { kind: 'idle', timestamp: latestIdle };
    }
    return null;
}

// Convenience helper used by the main render path: read jsonl then resolve.
export function getActiveNotification(
    sessionId: string,
    options: ResolveOptions
): ActiveNotification | null {
    return selectActiveNotification(readNotificationEntries(sessionId), options);
}
