export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export interface TodoItem {
    id?: string;
    content: string;
    activeForm?: string;
    status: TodoStatus;
}

export interface TodoProgressSnapshot {
    timestamp: string;
    session_id: string;
    todos: TodoItem[];
}

export interface TodoProgressMetrics {
    todos: TodoItem[];
    timestamp: string | null;
    // Writer tool that produced this snapshot. TodoWrite snapshots are
    // rewritten each turn, so they expire on a turn boundary; TaskCreate /
    // TaskUpdate are incremental + cross-turn persistent and must NOT expire.
    // Null means a legacy snapshot written before this field existed.
    source?: string | null;
}