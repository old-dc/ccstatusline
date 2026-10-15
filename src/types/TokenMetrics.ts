export interface TokenUsage {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
}

export interface TranscriptLine {
    message?: { id?: string; usage?: TokenUsage; stop_reason?: string | null };
    isSidechain?: boolean;
    timestamp?: string;
    isApiErrorMessage?: boolean;
    type?: 'user' | 'assistant' | 'system' | 'progress' | 'file-history-snapshot';
    origin?: { kind?: string };
}

export interface SessionStats {
    turnCount: number;
    cacheHitRate: number | null;
}

export interface TokenMetrics {
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    totalTokens: number;
    contextLength: number;
}
