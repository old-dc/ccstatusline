import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type {
    TodoItem,
    TodoProgressMetrics,
    TodoStatus
} from '../types/TodoProgressMetrics';

function getTodoProgressDir(): string {
    return path.join(os.homedir(), '.cache', 'ccstatusline', 'todo-progress');
}

export function getTodoProgressFilePath(sessionId: string): string {
    return path.join(getTodoProgressDir(), `todo-progress-${sessionId}.jsonl`);
}

function isTodoStatus(value: unknown): value is TodoStatus {
    return value === 'pending' || value === 'in_progress' || value === 'completed';
}

function normalizeTodo(entry: unknown): TodoItem | null {
    if (typeof entry !== 'object' || entry === null) {
        return null;
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.content !== 'string') {
        return null;
    }
    if (!isTodoStatus(record.status)) {
        return null;
    }
    const item: TodoItem = {
        content: record.content,
        status: record.status
    };
    if (typeof record.id === 'string' && record.id.length > 0) {
        item.id = record.id;
    }
    if (typeof record.activeForm === 'string') {
        item.activeForm = record.activeForm;
    }
    return item;
}

function extractTurnTimestamp(line: string, sessionId: string): string | null {
    try {
        const parsed: unknown = JSON.parse(line);
        if (typeof parsed !== 'object' || parsed === null)
            return null;
        const record = parsed as Record<string, unknown>;
        if (record.event !== 'turn')
            return null;
        if (record.session_id !== sessionId)
            return null;
        if (typeof record.timestamp !== 'string')
            return null;
        return record.timestamp;
    } catch {
        return null;
    }
}

function parseSnapshot(line: string, sessionId: string): TodoProgressMetrics | null {
    try {
        const parsed: unknown = JSON.parse(line);
        if (typeof parsed !== 'object' || parsed === null) {
            return null;
        }
        const record = parsed as Record<string, unknown>;
        if (typeof record.timestamp !== 'string') {
            return null;
        }
        if (record.session_id !== sessionId) {
            return null;
        }
        if (!Array.isArray(record.todos)) {
            return null;
        }
        const todos: TodoItem[] = [];
        for (const raw of record.todos) {
            const normalized = normalizeTodo(raw);
            if (normalized !== null) {
                todos.push(normalized);
            }
        }
        const source = typeof record.source === 'string' ? record.source : null;
        return { todos, timestamp: record.timestamp, source };
    } catch {
        return null;
    }
}

export function getTodoProgressMetrics(sessionId: string): TodoProgressMetrics {
    const filePath = getTodoProgressFilePath(sessionId);
    if (!fs.existsSync(filePath)) {
        return { todos: [], timestamp: null };
    }

    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim().length > 0);

        let lastTurnMs = 0;
        let lastSnapshot: TodoProgressMetrics | null = null;

        for (const line of lines) {
            const turnTs = extractTurnTimestamp(line, sessionId);
            if (turnTs !== null) {
                const ms = new Date(turnTs).getTime();
                if (!Number.isNaN(ms) && ms > lastTurnMs) {
                    lastTurnMs = ms;
                }
                continue;
            }
            const snapshot = parseSnapshot(line, sessionId);
            if (snapshot !== null) {
                lastSnapshot = snapshot;
            }
        }

        if (lastSnapshot === null) {
            return { todos: [], timestamp: null };
        }

        // Turn-boundary purge: only applies to TodoWrite snapshots. TodoWrite
        // rewrites the full list each turn, so stale cross-turn state should
        // be dropped. TaskCreate / TaskUpdate are incremental + cross-turn
        // persistent by design — they must survive turn boundaries until
        // explicitly deleted. Legacy snapshots (source == null) predate this
        // field and are treated as TodoWrite for back-compat.
        const source = lastSnapshot.source ?? null;
        const isTodoWriteSnapshot = source === null || source === 'TodoWrite';
        if (isTodoWriteSnapshot && lastTurnMs > 0 && lastSnapshot.timestamp !== null) {
            const snapshotMs = new Date(lastSnapshot.timestamp).getTime();
            if (!Number.isNaN(snapshotMs) && snapshotMs < lastTurnMs) {
                return { todos: [], timestamp: lastSnapshot.timestamp, source };
            }
        }

        return lastSnapshot;
    } catch {
        return { todos: [], timestamp: null };
    }
}

export interface TodoEvent {
    tool: string;
    taskId: string | undefined;
    input: {
        subject?: string;
        activeForm?: string;
        status?: string;
    };
}

export function applyTodoEvent(current: TodoItem[], event: TodoEvent): TodoItem[] {
    if (event.tool === 'TaskCreate') {
        const subject = event.input.subject;
        if (typeof subject !== 'string' || subject.length === 0 || event.taskId === undefined) {
            return current;
        }
        const next: TodoItem = {
            id: event.taskId,
            content: subject,
            status: 'pending'
        };
        if (typeof event.input.activeForm === 'string') {
            next.activeForm = event.input.activeForm;
        }
        return [...current, next];
    }

    if (event.tool === 'TaskUpdate') {
        if (event.taskId === undefined) {
            return current;
        }
        if (event.input.status === 'deleted') {
            return current.filter(t => t.id !== event.taskId);
        }
        return current.map((t) => {
            if (t.id !== event.taskId)
                return t;
            const patched: TodoItem = { ...t };
            if (typeof event.input.subject === 'string' && event.input.subject.length > 0) {
                patched.content = event.input.subject;
            }
            if (typeof event.input.activeForm === 'string') {
                patched.activeForm = event.input.activeForm;
            }
            if (isTodoStatus(event.input.status)) {
                patched.status = event.input.status;
            }
            return patched;
        });
    }

    // TaskList / TaskGet / unknown → no state change
    return current;
}

export function extractTaskIdFromResponse(toolResponse: unknown): string | undefined {
    if (typeof toolResponse !== 'object' || toolResponse === null) {
        return undefined;
    }
    const resp = toolResponse as Record<string, unknown>;
    // TaskUpdate: { taskId: "10", ... }
    if (typeof resp.taskId === 'string' && resp.taskId.length > 0) {
        return resp.taskId;
    }
    // TaskCreate: { task: { id: "11", subject: "..." } }
    const task = resp.task;
    if (typeof task === 'object' && task !== null) {
        const inner = task as Record<string, unknown>;
        if (typeof inner.id === 'string' && inner.id.length > 0) {
            return inner.id;
        }
    }
    return undefined;
}

export function readLastTodoSnapshot(sessionId: string): TodoItem[] {
    const filePath = getTodoProgressFilePath(sessionId);
    if (!fs.existsSync(filePath)) {
        return [];
    }
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim().length > 0);
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];
            if (line === undefined)
                continue;
            const snapshot = parseSnapshot(line, sessionId);
            if (snapshot !== null) {
                return snapshot.todos;
            }
        }
        return [];
    } catch {
        return [];
    }
}
