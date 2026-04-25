import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type {
    AgentActivityEvent,
    AgentActivityMetrics,
    AgentEntry
} from '../types/AgentActivityMetrics';

function getAgentActivityDir(): string {
    return path.join(os.homedir(), '.cache', 'ccstatusline', 'agent-activity');
}

export function getAgentActivityFilePath(sessionId: string): string {
    return path.join(getAgentActivityDir(), `agent-activity-${sessionId}.jsonl`);
}

function parseEvent(line: string, sessionId: string): AgentActivityEvent | null {
    try {
        const parsed: unknown = JSON.parse(line);
        if (typeof parsed !== 'object' || parsed === null) {
            return null;
        }
        const record = parsed as Record<string, unknown>;
        if (record.event !== 'start' && record.event !== 'end' && record.event !== 'subagent_start') {
            return null;
        }
        if (typeof record.timestamp !== 'string') {
            return null;
        }
        if (typeof record.session_id !== 'string' || record.session_id !== sessionId) {
            return null;
        }
        const toolUseId = typeof record.id === 'string' && record.id.length > 0 ? record.id : undefined;
        const agentId = typeof record.agent_id === 'string' && record.agent_id.length > 0
            ? record.agent_id
            : undefined;
        if (record.event === 'subagent_start') {
            if (!agentId)
                return null;
        } else if (record.event === 'start') {
            if (!toolUseId)
                return null;
        } else if (!toolUseId && !agentId) {
            // 'end' needs at least one key to correlate back to a start
            return null;
        }
        return {
            event: record.event,
            id: toolUseId,
            agent_id: agentId,
            timestamp: record.timestamp,
            session_id: record.session_id,
            type: typeof record.type === 'string' ? record.type : undefined,
            model: typeof record.model === 'string' ? record.model : undefined,
            description: typeof record.description === 'string' ? record.description : undefined
        };
    } catch {
        return null;
    }
}

function extractTurnTimestamp(line: string, sessionId: string): string | null {
    try {
        const parsed: unknown = JSON.parse(line);
        if (typeof parsed !== 'object' || parsed === null) {
            return null;
        }
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

function buildAgentEntry(event: AgentActivityEvent): AgentEntry {
    return {
        id: event.id ?? '',
        type: typeof event.type === 'string' && event.type.length > 0 ? event.type : 'unknown',
        model: typeof event.model === 'string' ? event.model : undefined,
        description: typeof event.description === 'string' ? event.description : undefined,
        status: 'running',
        startTime: new Date(event.timestamp)
    };
}

export function getAgentActivityMetrics(sessionId: string): AgentActivityMetrics {
    const filePath = getAgentActivityFilePath(sessionId);
    if (!fs.existsSync(filePath)) {
        return { agents: [] };
    }

    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim().length > 0);

        // agentMap keyed by tool_use_id (the stable identity we display from).
        // pendingStarts is a FIFO of tool_use_ids from PreToolUse start events
        // awaiting a SubagentStart companion — we pair them in arrival order.
        // agentIdToToolUseId lets a SubagentStop end event (which only carries
        // agent_id) resolve back to the correct tool_use_id.
        const agentMap = new Map<string, AgentEntry>();
        const pendingStarts: string[] = [];
        const agentIdToToolUseId = new Map<string, string>();
        let lastTurnMs = 0;

        const markCompleted = (toolUseId: string, timestamp: string): void => {
            const existing = agentMap.get(toolUseId);
            if (existing) {
                existing.status = 'completed';
                existing.endTime = new Date(timestamp);
            }
        };

        for (const line of lines) {
            const turnTs = extractTurnTimestamp(line, sessionId);
            if (turnTs !== null) {
                const ms = new Date(turnTs).getTime();
                if (!Number.isNaN(ms) && ms > lastTurnMs) {
                    lastTurnMs = ms;
                }
                continue;
            }
            const event = parseEvent(line, sessionId);
            if (!event) {
                continue;
            }

            if (event.event === 'start' && event.id) {
                if (!agentMap.has(event.id)) {
                    agentMap.set(event.id, buildAgentEntry(event));
                    pendingStarts.push(event.id);
                }
            } else if (event.event === 'subagent_start' && event.agent_id) {
                const tid = pendingStarts.shift();
                if (tid !== undefined) {
                    agentIdToToolUseId.set(event.agent_id, tid);
                }
            } else if (event.event === 'end') {
                if (event.id) {
                    markCompleted(event.id, event.timestamp);
                } else if (event.agent_id) {
                    const tid = agentIdToToolUseId.get(event.agent_id);
                    if (tid !== undefined) {
                        markCompleted(tid, event.timestamp);
                    }
                }
            }
        }

        // Turn-boundary purge: drop completed agents that finished before the
        // last UserPromptSubmit turn marker. Running agents are always kept —
        // they span turns by definition.
        const agents = Array.from(agentMap.values())
            .filter((a) => {
                if (a.status === 'running')
                    return true;
                if (lastTurnMs === 0)
                    return true;
                const endMs = a.endTime?.getTime() ?? a.startTime.getTime();
                return endMs >= lastTurnMs;
            })
            .sort((a, b) => {
                const delta = a.startTime.getTime() - b.startTime.getTime();
                if (delta !== 0) {
                    return delta;
                }
                return a.id.localeCompare(b.id);
            })
            .slice(-10);

        return { agents };
    } catch {
        return { agents: [] };
    }
}
