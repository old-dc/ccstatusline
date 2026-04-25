export type AgentStatus = 'running' | 'completed';

export interface AgentEntry {
    id: string;
    type: string;
    model?: string;
    description?: string;
    status: AgentStatus;
    startTime: Date;
    endTime?: Date;
}

export interface AgentActivityMetrics { agents: AgentEntry[] }

export interface AgentActivityEvent {
    timestamp: string;
    session_id: string;
    event: 'start' | 'end' | 'subagent_start';
    id?: string;
    agent_id?: string;
    type?: string;
    model?: string;
    description?: string;
}
