import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type {
    NotificationEntry,
    NotificationKind,
    NotificationState
} from '../types/NotificationState';

const NOTIFICATION_TYPE_TO_KIND: Record<string, NotificationKind> = {
    permission_prompt: 'permission',
    idle_prompt: 'idle'
};

function getNotificationDir(): string {
    return path.join(os.homedir(), '.cache', 'ccstatusline', 'notification');
}

export function getNotificationFilePath(sessionId: string): string {
    return path.join(getNotificationDir(), `${sessionId}.jsonl`);
}

export function classifyNotification(notificationType: string | undefined): NotificationKind | null {
    if (typeof notificationType !== 'string') {
        return null;
    }
    return NOTIFICATION_TYPE_TO_KIND[notificationType] ?? null;
}

export interface NotificationLatest {
    permission: Date | null;
    idle: Date | null;
}

interface ParsedEntry {
    kind: NotificationKind;
    timestamp: Date;
}

function parseEntry(line: string, sessionId: string): ParsedEntry | null {
    try {
        const raw = JSON.parse(line) as Partial<NotificationEntry>;
        if (typeof raw.notification_type !== 'string'
            || typeof raw.timestamp !== 'string'
            || raw.session_id !== sessionId) {
            return null;
        }
        const kind = classifyNotification(raw.notification_type);
        if (!kind) {
            return null;
        }
        const timestamp = new Date(raw.timestamp);
        if (Number.isNaN(timestamp.getTime())) {
            return null;
        }
        return { kind, timestamp };
    } catch {
        return null;
    }
}

export function getNotificationLatest(sessionId: string): NotificationLatest | null {
    if (!sessionId) {
        return null;
    }
    const filePath = getNotificationFilePath(sessionId);
    let contents: string;
    try {
        contents = fs.readFileSync(filePath, 'utf-8');
    } catch {
        return null;
    }

    let permission: Date | null = null;
    let idle: Date | null = null;
    for (const line of contents.split('\n')) {
        if (!line.trim()) {
            continue;
        }
        const parsed = parseEntry(line, sessionId);
        if (!parsed) {
            continue;
        }
        if (parsed.kind === 'permission') {
            if (!permission || parsed.timestamp > permission) {
                permission = parsed.timestamp;
            }
        } else if (!idle || parsed.timestamp > idle) {
            idle = parsed.timestamp;
        }
    }
    return { permission, idle };
}

export interface ResolveOptions {
    now?: Date;
    mode?: 'both' | 'permission' | 'idle';
}

// Picks the highest-priority notification still within TTL. permission > idle.
export function resolveNotificationState(
    latest: NotificationLatest | null,
    ttlSec: number,
    options: ResolveOptions = {}
): NotificationState | null {
    if (!latest) {
        return null;
    }
    const now = options.now ?? new Date();
    const cutoffMs = now.getTime() - ttlSec * 1000;
    const mode = options.mode ?? 'both';

    const permissionFresh = latest.permission && latest.permission.getTime() >= cutoffMs
        ? latest.permission
        : null;
    const idleFresh = latest.idle && latest.idle.getTime() >= cutoffMs
        ? latest.idle
        : null;

    if ((mode === 'both' || mode === 'permission') && permissionFresh) {
        return { type: 'permission', timestamp: permissionFresh };
    }
    if ((mode === 'both' || mode === 'idle') && idleFresh) {
        return { type: 'idle', timestamp: idleFresh };
    }
    return null;
}
