import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type NotificationKind = 'permission' | 'idle';

export interface NotificationState {
    permission: Date | null;
    idle: Date | null;
}

const EMPTY: NotificationState = { permission: null, idle: null };

interface NotificationLogEntry {
    timestamp?: string;
    session_id?: string;
    notification_type?: string;
    message?: string;
}

function getNotificationDir(): string {
    return path.join(os.homedir(), '.cache', 'ccstatusline', 'notification');
}

export function getNotificationFilePath(sessionId: string): string {
    return path.join(getNotificationDir(), `${sessionId}.jsonl`);
}

export function classifyNotificationType(notificationType: string | undefined): NotificationKind | null {
    if (notificationType === 'permission_prompt')
        return 'permission';
    if (notificationType === 'idle_prompt')
        return 'idle';
    return null;
}

export function loadNotificationState(sessionId: string): NotificationState {
    const filePath = getNotificationFilePath(sessionId);
    if (!fs.existsSync(filePath)) {
        return { ...EMPTY };
    }

    let raw: string;
    try {
        raw = fs.readFileSync(filePath, 'utf-8');
    } catch {
        return { ...EMPTY };
    }

    const state: NotificationState = { permission: null, idle: null };
    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        let entry: NotificationLogEntry;
        try {
            entry = JSON.parse(trimmed) as NotificationLogEntry;
        } catch {
            continue;
        }
        const kind = classifyNotificationType(entry.notification_type);
        if (!kind)
            continue;
        if (typeof entry.timestamp !== 'string')
            continue;
        const ts = new Date(entry.timestamp);
        if (Number.isNaN(ts.getTime()))
            continue;
        const current = state[kind];
        if (current === null || ts.getTime() > current.getTime()) {
            state[kind] = ts;
        }
    }
    return state;
}

export function isWithinTtl(timestamp: Date | null, ttlSec: number, now: Date = new Date()): boolean {
    if (timestamp === null)
        return false;
    const ageSec = (now.getTime() - timestamp.getTime()) / 1000;
    return ageSec >= 0 && ageSec <= ttlSec;
}
