import {
    Box,
    Text,
    useInput
} from 'ink';
import React, { useState } from 'react';

import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    CustomKeybind,
    Widget,
    WidgetEditorDisplay,
    WidgetEditorProps,
    WidgetItem
} from '../types/Widget';
import type { WidgetHookDef } from '../utils/hooks';
import { shouldInsertInput } from '../utils/input-guards';
import {
    resolveNotificationState,
    type NotificationLatest
} from '../utils/notification';

import { formatElapsed } from './AgentActivity';
import { makeModifierText } from './shared/editor-display';
import {
    isMetadataFlagEnabled,
    toggleMetadataFlag
} from './shared/metadata';

export type Mode = 'both' | 'permission' | 'idle';
const MODES: Mode[] = ['both', 'permission', 'idle'];

const TTL_OPTIONS = [30, 45, 60, 120, 300] as const;
const TTL_DEFAULT = 45;
const TTL_MIN = 5;
const TTL_MAX = 600;
const LABEL_MAX = 20;

const DEFAULT_LABEL_PERMISSION = '⚠ permission';
const DEFAULT_LABEL_IDLE = '◔ idle';
const NONE_LABEL = '⚠ none';

const SHOW_ELAPSED_KEY = 'showElapsed';
const HIDE_WHEN_IDLE_KEY = 'hideWhenIdle';
const TTL_KEY = 'ttl';
const MODE_KEY = 'mode';
const LABEL_PERMISSION_KEY = 'labelPermission';
const LABEL_IDLE_KEY = 'labelIdle';

const CYCLE_MODE_ACTION = 'cycle-mode';
const CYCLE_TTL_ACTION = 'cycle-ttl';
const TOGGLE_ELAPSED_ACTION = 'toggle-elapsed';
const TOGGLE_HIDE_WHEN_IDLE_ACTION = 'toggle-hide-when-idle';
const EDIT_LABEL_PERMISSION_ACTION = 'edit-label-permission';
const EDIT_LABEL_IDLE_ACTION = 'edit-label-idle';

function truncateLabel(text: string): string {
    const chars = Array.from(text);
    if (chars.length <= LABEL_MAX) {
        return chars.join('');
    }
    return chars.slice(0, LABEL_MAX - 1).join('') + '…';
}

export function getEffectiveLabel(item: WidgetItem, kind: 'permission' | 'idle'): string {
    const key = kind === 'permission' ? LABEL_PERMISSION_KEY : LABEL_IDLE_KEY;
    const fallback = kind === 'permission' ? DEFAULT_LABEL_PERMISSION : DEFAULT_LABEL_IDLE;
    const raw = item.metadata?.[key];
    if (typeof raw !== 'string' || raw.length === 0) {
        return fallback;
    }
    return truncateLabel(raw);
}

function clampTtl(value: number): number {
    if (!Number.isFinite(value) || value < TTL_MIN) {
        return TTL_MIN;
    }
    if (value > TTL_MAX) {
        return TTL_MAX;
    }
    return Math.floor(value);
}

export function getMode(item: WidgetItem): Mode {
    const raw = item.metadata?.[MODE_KEY];
    return raw === 'permission' || raw === 'idle' ? raw : 'both';
}

export function getTtl(item: WidgetItem): number {
    const raw = item.metadata?.[TTL_KEY];
    if (raw === undefined) {
        return TTL_DEFAULT;
    }
    const parsed = parseInt(raw, 10);
    if (Number.isNaN(parsed)) {
        return TTL_DEFAULT;
    }
    return clampTtl(parsed);
}

export function isShowElapsed(item: WidgetItem): boolean {
    return isMetadataFlagEnabled(item, SHOW_ELAPSED_KEY);
}

export function isHideWhenIdle(item: WidgetItem): boolean {
    const raw = item.metadata?.[HIDE_WHEN_IDLE_KEY];
    if (raw === undefined) {
        return true;
    }
    return raw === 'true';
}

function nextTtl(current: number): number {
    const idx = TTL_OPTIONS.indexOf(current as typeof TTL_OPTIONS[number]);
    if (idx === -1) {
        return TTL_DEFAULT;
    }
    return TTL_OPTIONS[(idx + 1) % TTL_OPTIONS.length] ?? TTL_DEFAULT;
}

export class NeedsAttentionWidget implements Widget {
    getDefaultColor(): string { return 'yellow'; }
    getDescription(): string { return 'Highlights when Claude Code is waiting for permission or idle prompts'; }
    getDisplayName(): string { return 'Needs Attention'; }
    getCategory(): string { return 'Session'; }
    supportsRawValue(): boolean { return true; }
    supportsColors(_item: WidgetItem): boolean { return true; }

    getHooks(): WidgetHookDef[] {
        return [{ event: 'Notification', matcher: 'permission_prompt|idle_prompt' }];
    }

    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        const mode = getMode(item);
        const ttl = getTtl(item);
        const modifiers = [mode, `ttl=${ttl}s`];
        if (isShowElapsed(item)) {
            modifiers.push('elapsed');
        }
        if (!isHideWhenIdle(item)) {
            modifiers.push('show idle');
        }
        if (typeof item.metadata?.[LABEL_PERMISSION_KEY] === 'string'
            && item.metadata[LABEL_PERMISSION_KEY].length > 0) {
            modifiers.push('custom permission');
        }
        if (typeof item.metadata?.[LABEL_IDLE_KEY] === 'string'
            && item.metadata[LABEL_IDLE_KEY].length > 0) {
            modifiers.push('custom idle');
        }
        return {
            displayText: this.getDisplayName(),
            modifierText: makeModifierText(modifiers)
        };
    }

    getCustomKeybinds(_item?: WidgetItem): CustomKeybind[] {
        return [
            { key: 'v', label: '(v)iew: both/permission/idle', action: CYCLE_MODE_ACTION },
            { key: 't', label: '(t)tl', action: CYCLE_TTL_ACTION },
            { key: 'e', label: '(e)lapsed', action: TOGGLE_ELAPSED_ACTION },
            { key: 'h', label: '(h)ide when idle', action: TOGGLE_HIDE_WHEN_IDLE_ACTION },
            { key: 'p', label: '(p)ermission label', action: EDIT_LABEL_PERMISSION_ACTION },
            { key: 'i', label: '(i)dle label', action: EDIT_LABEL_IDLE_ACTION }
        ];
    }

    handleEditorAction(action: string, item: WidgetItem): WidgetItem | null {
        if (action === CYCLE_MODE_ACTION) {
            const current = getMode(item);
            const next = MODES[(MODES.indexOf(current) + 1) % MODES.length] ?? 'both';
            return { ...item, metadata: { ...item.metadata, [MODE_KEY]: next } };
        }
        if (action === CYCLE_TTL_ACTION) {
            const next = nextTtl(getTtl(item));
            return { ...item, metadata: { ...item.metadata, [TTL_KEY]: next.toString() } };
        }
        if (action === TOGGLE_ELAPSED_ACTION) {
            return toggleMetadataFlag(item, SHOW_ELAPSED_KEY);
        }
        if (action === TOGGLE_HIDE_WHEN_IDLE_ACTION) {
            return {
                ...item,
                metadata: {
                    ...item.metadata,
                    [HIDE_WHEN_IDLE_KEY]: (!isHideWhenIdle(item)).toString()
                }
            };
        }
        return null;
    }

    renderEditor(props: WidgetEditorProps): React.ReactElement {
        return <NeedsAttentionEditor {...props} />;
    }

    render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
        if (context.isPreview) {
            return this.renderPreview(item, getMode(item), isShowElapsed(item));
        }
        return computeNeedsAttentionOutput(item, context.notificationLatest ?? null, new Date());
    }

    private renderPreview(item: WidgetItem, mode: Mode, showElapsed: boolean): string {
        const sampleKind: 'permission' | 'idle' = mode === 'idle' ? 'idle' : 'permission';
        const label = getEffectiveLabel(item, sampleKind);
        if (!showElapsed) {
            return label;
        }
        const previewSecondsAgo = sampleKind === 'permission' ? 1 : 12;
        const fakeNow = new Date();
        const fakeStart = new Date(fakeNow.getTime() - previewSecondsAgo * 1000);
        const elapsed = formatElapsed(fakeStart, fakeNow, fakeNow);
        return `${label} (${elapsed})`;
    }
}

function formatLabel(
    item: WidgetItem,
    kind: 'permission' | 'idle',
    eventTime: Date,
    showElapsed: boolean,
    ttl: number,
    now: Date
): string {
    const label = getEffectiveLabel(item, kind);
    if (!showElapsed) {
        return label;
    }
    const elapsedMs = now.getTime() - eventTime.getTime();
    const cappedMs = Math.min(Math.max(elapsedMs, 1000), ttl * 1000);
    const cappedNow = new Date(eventTime.getTime() + cappedMs);
    const elapsed = formatElapsed(eventTime, cappedNow, cappedNow);
    return `${label} (${elapsed})`;
}

export function computeNeedsAttentionOutput(
    item: WidgetItem,
    latest: NotificationLatest | null,
    now: Date
): string | null {
    const rawValue = item.rawValue === true;
    const mode = getMode(item);
    const ttl = getTtl(item);
    const showElapsed = isShowElapsed(item);
    const hideWhenIdle = isHideWhenIdle(item);

    const state = resolveNotificationState(latest, ttl, { mode, now });
    if (!state) {
        if (hideWhenIdle) {
            return null;
        }
        return rawValue ? '' : NONE_LABEL;
    }
    return formatLabel(item, state.type, state.timestamp, showElapsed, ttl, now);
}

const NeedsAttentionEditor: React.FC<WidgetEditorProps> = ({ widget, onComplete, onCancel, action }) => {
    const editingPermission = action === EDIT_LABEL_PERMISSION_ACTION;
    const editingIdle = action === EDIT_LABEL_IDLE_ACTION;
    const labelKey = editingPermission ? LABEL_PERMISSION_KEY : LABEL_IDLE_KEY;
    const initial = widget.metadata?.[labelKey] ?? '';
    const [value, setValue] = useState(initial);

    useInput((input, key) => {
        if (!editingPermission && !editingIdle) {
            return;
        }
        if (key.return) {
            const trimmed = value;
            const nextMetadata = Object.fromEntries(
                Object.entries(widget.metadata ?? {}).filter(([key]) => key !== labelKey)
            );
            if (trimmed.length > 0) {
                nextMetadata[labelKey] = trimmed;
            }
            onComplete({
                ...widget,
                metadata: Object.keys(nextMetadata).length > 0 ? nextMetadata : undefined
            });
        } else if (key.escape) {
            onCancel();
        } else if (key.backspace) {
            setValue(value.slice(0, -1));
        } else if (shouldInsertInput(input, key)) {
            setValue(value + input);
        }
    });

    if (editingPermission || editingIdle) {
        const which = editingPermission ? 'permission' : 'idle';
        return (
            <Box flexDirection='column'>
                <Box>
                    <Text>
                        {`Enter ${which} label (empty to reset, max ${LABEL_MAX} chars): `}
                    </Text>
                    <Text>{value}</Text>
                    <Text backgroundColor='gray' color='black'>{' '}</Text>
                </Box>
                <Text dimColor>Press Enter to save, ESC to cancel</Text>
            </Box>
        );
    }

    return <Text>Unknown editor mode</Text>;
};
