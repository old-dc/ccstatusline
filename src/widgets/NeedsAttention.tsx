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
    selectNotificationState,
    type NotificationState
} from '../utils/notification';

import { formatElapsed } from './AgentActivity';
import { makeModifierText } from './shared/editor-display';
import {
    isMetadataFlagEnabled,
    toggleMetadataFlag
} from './shared/metadata';

type Mode = 'both' | 'permission' | 'idle';
const MODES: Mode[] = ['both', 'permission', 'idle'];

const TTL_OPTIONS = [30, 45, 60, 120, 300];
const TTL_DEFAULT = 45;
const TTL_MIN = 5;
const TTL_MAX = 600;

const DEFAULT_LABEL_PERMISSION = '⚠ permission';
const DEFAULT_LABEL_IDLE = '◔ idle';
const NO_ATTENTION_LABEL = '⚠ none';

const MAX_LABEL_VISIBLE_CHARS = 20;

const MODE_KEY = 'mode';
const TTL_KEY = 'ttl';
const SHOW_ELAPSED_KEY = 'showElapsed';
const HIDE_WHEN_IDLE_KEY = 'hideWhenIdle';
const LABEL_PERMISSION_KEY = 'labelPermission';
const LABEL_IDLE_KEY = 'labelIdle';

const CYCLE_MODE_ACTION = 'cycle-mode';
const CYCLE_TTL_ACTION = 'cycle-ttl';
const TOGGLE_SHOW_ELAPSED_ACTION = 'toggle-show-elapsed';
const TOGGLE_HIDE_WHEN_IDLE_ACTION = 'toggle-hide-when-idle';
const EDIT_PERMISSION_LABEL_ACTION = 'edit-permission-label';
const EDIT_IDLE_LABEL_ACTION = 'edit-idle-label';

function countCodepoints(s: string): number {
    return Array.from(s).length;
}

export function truncateLabel(label: string, maxVisibleChars: number): string {
    const codepoints = Array.from(label);
    if (codepoints.length <= maxVisibleChars)
        return label;
    if (maxVisibleChars <= 1)
        return '…';
    return codepoints.slice(0, maxVisibleChars - 1).join('') + '…';
}

export function formatAttentionElapsed(timestamp: Date, ttlSec: number, now: Date = new Date()): string {
    // Clamp to >= 1s and <= ttl seconds, then reuse the AgentActivity formatter.
    const elapsedMs = Math.max(1000, now.getTime() - timestamp.getTime());
    const cappedMs = Math.min(ttlSec * 1000, elapsedMs);
    return formatElapsed(new Date(0), undefined, new Date(cappedMs));
}

interface RenderInputs {
    state: NotificationState | null;
    ttl: number;
    showElapsed: boolean;
    hideWhenIdle: boolean;
    labelPermission: string;
    labelIdle: string;
    rawValue: boolean;
    now: Date;
}

function renderState(inputs: RenderInputs): string | null {
    const { state, ttl, showElapsed, hideWhenIdle, labelPermission, labelIdle, rawValue, now } = inputs;
    if (!state) {
        if (hideWhenIdle)
            return null;
        return rawValue ? '' : NO_ATTENTION_LABEL;
    }
    const baseLabel = state.type === 'permission' ? labelPermission : labelIdle;
    const truncated = truncateLabel(baseLabel, MAX_LABEL_VISIBLE_CHARS);
    if (showElapsed) {
        const elapsed = formatAttentionElapsed(state.timestamp, ttl, now);
        return `${truncated} (${elapsed})`;
    }
    return truncated;
}

export class NeedsAttentionWidget implements Widget {
    getDefaultColor(): string { return 'yellow'; }
    getDescription(): string {
        return 'Highlights when Claude Code is awaiting a permission decision or idle prompt';
    }

    getDisplayName(): string { return 'Needs Attention'; }
    getCategory(): string { return 'Session'; }
    supportsRawValue(): boolean { return true; }
    supportsColors(_item: WidgetItem): boolean { return true; }

    getHooks(): WidgetHookDef[] {
        return [{ event: 'Notification', matcher: 'permission_prompt|idle_prompt' }];
    }

    // ItemsEditor reserves a/i/d/k/c/r/m/space for built-in actions. PRD asked
    // for `i` to edit the idle label, but `i` is taken by `insert`; we use `b`
    // (la(b)el idle) instead so the keybind actually fires.
    getCustomKeybinds(_item?: WidgetItem): CustomKeybind[] {
        return [
            { key: 'v', label: '(v)iew: both/permission/idle', action: CYCLE_MODE_ACTION },
            { key: 't', label: '(t)tl', action: CYCLE_TTL_ACTION },
            { key: 'e', label: '(e)lapsed', action: TOGGLE_SHOW_ELAPSED_ACTION },
            { key: 'h', label: '(h)ide when idle', action: TOGGLE_HIDE_WHEN_IDLE_ACTION },
            { key: 'p', label: '(p)ermission label', action: EDIT_PERMISSION_LABEL_ACTION },
            { key: 'b', label: 'la(b)el idle', action: EDIT_IDLE_LABEL_ACTION }
        ];
    }

    handleEditorAction(action: string, item: WidgetItem): WidgetItem | null {
        if (action === CYCLE_MODE_ACTION) {
            const current = this.getMode(item);
            const next = MODES[(MODES.indexOf(current) + 1) % MODES.length] ?? 'both';
            return { ...item, metadata: { ...item.metadata, [MODE_KEY]: next } };
        }
        if (action === CYCLE_TTL_ACTION) {
            const current = this.getTtl(item);
            const idx = TTL_OPTIONS.indexOf(current);
            const next = TTL_OPTIONS[(idx + 1) % TTL_OPTIONS.length] ?? TTL_DEFAULT;
            return { ...item, metadata: { ...item.metadata, [TTL_KEY]: next.toString() } };
        }
        if (action === TOGGLE_SHOW_ELAPSED_ACTION) {
            return toggleMetadataFlag(item, SHOW_ELAPSED_KEY);
        }
        if (action === TOGGLE_HIDE_WHEN_IDLE_ACTION) {
            const current = this.isHideWhenIdle(item);
            return {
                ...item,
                metadata: {
                    ...item.metadata,
                    [HIDE_WHEN_IDLE_KEY]: (!current).toString()
                }
            };
        }
        return null;
    }

    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        const mode = this.getMode(item);
        const ttl = this.getTtl(item);
        const modifiers: string[] = [mode, `ttl=${ttl}s`];

        if (isMetadataFlagEnabled(item, SHOW_ELAPSED_KEY)) {
            modifiers.push('elapsed');
        }
        if (!this.isHideWhenIdle(item)) {
            modifiers.push('always show');
        }
        if (this.hasCustomLabel(item, LABEL_PERMISSION_KEY)) {
            modifiers.push('custom permission');
        }
        if (this.hasCustomLabel(item, LABEL_IDLE_KEY)) {
            modifiers.push('custom idle');
        }

        return {
            displayText: 'Needs Attention',
            modifierText: makeModifierText(modifiers)
        };
    }

    render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
        const mode = this.getMode(item);
        const ttl = this.getTtl(item);
        const showElapsed = isMetadataFlagEnabled(item, SHOW_ELAPSED_KEY);
        const hideWhenIdle = this.isHideWhenIdle(item);
        const rawValue = item.rawValue === true;
        const labelPermission = this.getLabel(item, LABEL_PERMISSION_KEY, DEFAULT_LABEL_PERMISSION);
        const labelIdle = this.getLabel(item, LABEL_IDLE_KEY, DEFAULT_LABEL_IDLE);

        if (context.isPreview) {
            return this.renderPreview({
                mode,
                ttl,
                showElapsed,
                hideWhenIdle,
                labelPermission,
                labelIdle,
                rawValue
            });
        }

        const allEvents = context.notificationEvents ?? [];
        const filtered = mode === 'both'
            ? allEvents
            : allEvents.filter(e => e.type === mode);
        const now = new Date();
        const state = selectNotificationState(filtered, ttl, now);

        return renderState({
            state,
            ttl,
            showElapsed,
            hideWhenIdle,
            labelPermission,
            labelIdle,
            rawValue,
            now
        });
    }

    renderEditor(props: WidgetEditorProps): React.ReactElement {
        return <NeedsAttentionEditor {...props} />;
    }

    private renderPreview(opts: {
        mode: Mode;
        ttl: number;
        showElapsed: boolean;
        hideWhenIdle: boolean;
        labelPermission: string;
        labelIdle: string;
        rawValue: boolean;
    }): string | null {
        const { mode, ttl, showElapsed, hideWhenIdle, labelPermission, labelIdle, rawValue } = opts;
        // Pick a sample event so the user can see a representative label.
        const previewType: 'permission' | 'idle' = mode === 'idle' ? 'idle' : 'permission';
        const sampleNow = new Date(60_000);
        const sampleTimestamp = new Date(48_000);
        const state: NotificationState = { type: previewType, timestamp: sampleTimestamp };
        return renderState({
            state,
            ttl,
            showElapsed,
            hideWhenIdle,
            labelPermission,
            labelIdle,
            rawValue,
            now: sampleNow
        });
    }

    private getMode(item: WidgetItem): Mode {
        const raw = item.metadata?.[MODE_KEY];
        if (raw === 'permission' || raw === 'idle' || raw === 'both')
            return raw;
        return 'both';
    }

    getTtl(item: WidgetItem): number {
        const raw = item.metadata?.[TTL_KEY];
        if (raw === undefined)
            return TTL_DEFAULT;
        const parsed = parseInt(raw, 10);
        if (Number.isNaN(parsed))
            return TTL_DEFAULT;
        if (parsed < TTL_MIN)
            return TTL_MIN;
        if (parsed > TTL_MAX)
            return TTL_MAX;
        return parsed;
    }

    private isHideWhenIdle(item: WidgetItem): boolean {
        const raw = item.metadata?.[HIDE_WHEN_IDLE_KEY];
        if (raw === 'false')
            return false;
        return true;
    }

    private hasCustomLabel(item: WidgetItem, key: string): boolean {
        const raw = item.metadata?.[key];
        return typeof raw === 'string' && raw.length > 0;
    }

    private getLabel(item: WidgetItem, key: string, defaultValue: string): string {
        const raw = item.metadata?.[key];
        if (typeof raw !== 'string' || raw.length === 0)
            return defaultValue;
        return raw;
    }
}

const NeedsAttentionEditor: React.FC<WidgetEditorProps> = ({ widget, onComplete, onCancel, action }) => {
    const editingPermission = action === EDIT_PERMISSION_LABEL_ACTION;
    const editingIdle = action === EDIT_IDLE_LABEL_ACTION;
    const metadataKey = editingPermission ? LABEL_PERMISSION_KEY : LABEL_IDLE_KEY;
    const initialValue = widget.metadata?.[metadataKey] ?? '';
    const [value, setValue] = useState(initialValue);

    useInput((input, key) => {
        if (!editingPermission && !editingIdle) {
            return;
        }
        if (key.return) {
            const baseMetadata = Object.fromEntries(
                Object.entries(widget.metadata ?? {}).filter(([k]) => k !== metadataKey)
            );
            const nextMetadata: Record<string, string> = value.length === 0
                ? baseMetadata
                : { ...baseMetadata, [metadataKey]: value };
            const hasMetadata = Object.keys(nextMetadata).length > 0;
            onComplete({
                ...widget,
                metadata: hasMetadata ? nextMetadata : undefined
            });
        } else if (key.escape) {
            onCancel();
        } else if (key.backspace) {
            const codepoints = Array.from(value);
            setValue(codepoints.slice(0, -1).join(''));
        } else if (shouldInsertInput(input, key)) {
            const next = value + input;
            if (countCodepoints(next) <= MAX_LABEL_VISIBLE_CHARS) {
                setValue(next);
            }
        }
    });

    if (!editingPermission && !editingIdle) {
        return <Text>Unknown editor mode</Text>;
    }

    const labelName = editingPermission ? 'permission' : 'idle';
    const defaultLabel = editingPermission ? DEFAULT_LABEL_PERMISSION : DEFAULT_LABEL_IDLE;
    return (
        <Box flexDirection='column'>
            <Box>
                <Text>{`Enter ${labelName} label (max ${MAX_LABEL_VISIBLE_CHARS} chars, blank = default "${defaultLabel}"): `}</Text>
                <Text>{value}</Text>
                <Text backgroundColor='gray' color='black'>{' '}</Text>
            </Box>
            <Text dimColor>Enter saves, ESC cancels</Text>
        </Box>
    );
};
