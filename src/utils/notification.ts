import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type NotificationKind = 'permission' | 'idle';
export type NotificationMode = 'both' | 'permission' | 'idle';

export interface NotificationEntry {
    type: NotificationKind;
    timestamp: Date;
}

const KIND_FROM_TYPE: Record<string, NotificationKind | undefined> = {
    permission_prompt: 'permission',
    idle_prompt: 'idle'
};

function getNotificationDir(): string {
    return path.join(os.homedir(), '.cache', 'ccstatusline', 'notification');
}

export function getNotificationFilePath(sessionId: string): string {
    return path.join(getNotificationDir(), `${sessionId}.jsonl`);
}

export function parseNotificationKind(notificationType: unknown): NotificationKind | null {
    if (typeof notificationType !== 'string')
        return null;
    return KIND_FROM_TYPE[notificationType] ?? null;
}

export interface SelectNotificationOptions {
    mode?: NotificationMode;
    ttlSec: number;
    now?: Date;
}

// Picks the "active" notification according to PRD precedence rules:
//   - both:       permission > idle (permission wins when both in TTL window)
//   - permission: only permission entries are eligible
//   - idle:       only idle entries are eligible
// In each kind, the most recent entry within the TTL window wins.
export function selectActiveNotification(
    entries: NotificationEntry[],
    options: SelectNotificationOptions
): NotificationEntry | null {
    const mode = options.mode ?? 'both';
    const now = options.now ?? new Date();
    const cutoffMs = now.getTime() - options.ttlSec * 1000;

    let lastPermission: NotificationEntry | null = null;
    let lastIdle: NotificationEntry | null = null;

    for (const entry of entries) {
        if (entry.timestamp.getTime() <= cutoffMs)
            continue;
        if (entry.type === 'permission' && (mode === 'both' || mode === 'permission')) {
            if (!lastPermission || entry.timestamp.getTime() > lastPermission.timestamp.getTime()) {
                lastPermission = entry;
            }
        } else if (entry.type === 'idle' && (mode === 'both' || mode === 'idle')) {
            if (!lastIdle || entry.timestamp.getTime() > lastIdle.timestamp.getTime()) {
                lastIdle = entry;
            }
        }
    }

    if (mode === 'permission')
        return lastPermission;
    if (mode === 'idle')
        return lastIdle;
    return lastPermission ?? lastIdle;
}

export function readNotificationEntries(sessionId: string): NotificationEntry[] {
    const filePath = getNotificationFilePath(sessionId);
    if (!fs.existsSync(filePath))
        return [];

    let content: string;
    try {
        content = fs.readFileSync(filePath, 'utf-8');
    } catch {
        return [];
    }

    const entries: NotificationEntry[] = [];
    for (const line of content.split('\n')) {
        if (!line.trim())
            continue;
        try {
            const parsed: unknown = JSON.parse(line);
            if (typeof parsed !== 'object' || parsed === null)
                continue;
            const rec = parsed as Record<string, unknown>;
            if (typeof rec.timestamp !== 'string')
                continue;
            if (typeof rec.session_id !== 'string' || rec.session_id !== sessionId)
                continue;
            const kind = parseNotificationKind(rec.notification_type);
            if (!kind)
                continue;
            const timestamp = new Date(rec.timestamp);
            if (Number.isNaN(timestamp.getTime()))
                continue;
            entries.push({ type: kind, timestamp });
        } catch {
            continue;
        }
    }
    return entries;
}

export function loadNotificationState(
    sessionId: string,
    options: SelectNotificationOptions
): NotificationEntry | null {
    const entries = readNotificationEntries(sessionId);
    if (entries.length === 0)
        return null;
    return selectActiveNotification(entries, options);
}
