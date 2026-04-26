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
    isWithinTtl,
    type NotificationKind,
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

const TTL_OPTIONS = [30, 45, 60, 120, 300] as const;
const DEFAULT_TTL = 45;
const MIN_TTL = 5;
const MAX_TTL = 600;
const MAX_LABEL_VISIBLE = 20;

const DEFAULT_LABEL_PERMISSION = '⚠ permission';
const DEFAULT_LABEL_IDLE = '◔ idle';
const NONE_LABEL = '⚠ none';

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
const EDIT_LABEL_PERMISSION_ACTION = 'edit-label-permission';
const EDIT_LABEL_IDLE_ACTION = 'edit-label-idle';

export function truncateVisible(text: string, maxLen: number): string {
    if (text.length <= maxLen)
        return text;
    return text.slice(0, maxLen - 1) + '…';
}

export function selectActiveKind(
    state: NotificationState,
    mode: Mode,
    ttlSec: number,
    now: Date = new Date()
): { kind: NotificationKind; timestamp: Date } | null {
    const allowPermission = mode !== 'idle';
    const allowIdle = mode !== 'permission';

    const permissionTs = state.permission;
    const idleTs = state.idle;

    if (allowPermission && isWithinTtl(permissionTs, ttlSec, now) && permissionTs !== null) {
        return { kind: 'permission', timestamp: permissionTs };
    }
    if (allowIdle && isWithinTtl(idleTs, ttlSec, now) && idleTs !== null) {
        return { kind: 'idle', timestamp: idleTs };
    }
    return null;
}

export class NeedsAttentionWidget implements Widget {
    getDefaultColor(): string { return 'yellow'; }
    getDescription(): string {
        return 'Highlights the status line when Claude Code is awaiting permission or idling';
    }

    getDisplayName(): string { return 'Needs Attention'; }
    getCategory(): string { return 'Session'; }
    supportsRawValue(): boolean { return true; }
    supportsColors(_item: WidgetItem): boolean { return true; }

    getHooks(): WidgetHookDef[] {
        return [{ event: 'Notification', matcher: 'permission_prompt|idle_prompt' }];
    }

    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        const mode = this.getMode(item);
        const ttl = this.getTtl(item);
        const modifiers: string[] = [mode, `ttl=${ttl}s`];
        if (this.isShowElapsedEnabled(item))
            modifiers.push('elapsed');
        if (!this.isHideWhenIdleEnabled(item))
            modifiers.push('always show');
        const customPermission = this.getRawLabel(item, LABEL_PERMISSION_KEY);
        if (customPermission)
            modifiers.push('custom permission label');
        const customIdle = this.getRawLabel(item, LABEL_IDLE_KEY);
        if (customIdle)
            modifiers.push('custom idle label');
        return {
            displayText: 'NeedsAttention',
            modifierText: makeModifierText(modifiers)
        };
    }

    getCustomKeybinds(): CustomKeybind[] {
        return [
            { key: 'v', label: '(v)iew: both/permission/idle', action: CYCLE_MODE_ACTION },
            { key: 't', label: '(t)tl', action: CYCLE_TTL_ACTION },
            { key: 'e', label: '(e)lapsed', action: TOGGLE_SHOW_ELAPSED_ACTION },
            { key: 'h', label: '(h)ide when idle', action: TOGGLE_HIDE_WHEN_IDLE_ACTION },
            { key: 'p', label: '(p)ermission label', action: EDIT_LABEL_PERMISSION_ACTION },
            { key: 'i', label: '(i)dle label', action: EDIT_LABEL_IDLE_ACTION }
        ];
    }

    handleEditorAction(action: string, item: WidgetItem): WidgetItem | null {
        if (action === CYCLE_MODE_ACTION) {
            const next = MODES[(MODES.indexOf(this.getMode(item)) + 1) % MODES.length] ?? 'both';
            return { ...item, metadata: { ...item.metadata, [MODE_KEY]: next } };
        }
        if (action === CYCLE_TTL_ACTION) {
            const current = this.getTtl(item);
            const idx = TTL_OPTIONS.indexOf(current as typeof TTL_OPTIONS[number]);
            const nextIdx = idx === -1 ? 0 : (idx + 1) % TTL_OPTIONS.length;
            const next = TTL_OPTIONS[nextIdx] ?? DEFAULT_TTL;
            return { ...item, metadata: { ...item.metadata, [TTL_KEY]: String(next) } };
        }
        if (action === TOGGLE_SHOW_ELAPSED_ACTION) {
            return toggleMetadataFlag(item, SHOW_ELAPSED_KEY);
        }
        if (action === TOGGLE_HIDE_WHEN_IDLE_ACTION) {
            // hideWhenIdle defaults to true, so the first toggle should set false explicitly.
            const enabled = this.isHideWhenIdleEnabled(item);
            return {
                ...item,
                metadata: { ...item.metadata, [HIDE_WHEN_IDLE_KEY]: (!enabled).toString() }
            };
        }
        return null;
    }

    renderEditor(props: WidgetEditorProps): React.ReactElement {
        return <NeedsAttentionEditor {...props} />;
    }

    render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
        const mode = this.getMode(item);
        const ttl = this.getTtl(item);
        const showElapsed = this.isShowElapsedEnabled(item);
        const hideWhenIdle = this.isHideWhenIdleEnabled(item);
        const rawValue = item.rawValue === true;

        if (context.isPreview) {
            return this.renderPreview(item, mode, showElapsed);
        }

        const state = context.notificationState ?? null;
        const active = state ? selectActiveKind(state, mode, ttl) : null;
        if (active === null) {
            return this.renderIdle(hideWhenIdle, rawValue);
        }
        return this.formatLabel(item, active.kind, active.timestamp, showElapsed);
    }

    private renderPreview(item: WidgetItem, mode: Mode, showElapsed: boolean): string {
        const kind: NotificationKind = mode === 'idle' ? 'idle' : 'permission';
        const label = this.getLabel(item, kind);
        const sampleSec = kind === 'permission' ? 3 : 12;
        return showElapsed ? `${label} (${sampleSec}s)` : label;
    }

    private renderIdle(hideWhenIdle: boolean, rawValue: boolean): string | null {
        if (hideWhenIdle)
            return null;
        return rawValue ? '' : NONE_LABEL;
    }

    private formatLabel(
        item: WidgetItem,
        kind: NotificationKind,
        timestamp: Date,
        showElapsed: boolean
    ): string {
        const label = this.getLabel(item, kind);
        if (!showElapsed)
            return label;
        const elapsed = formatElapsed(timestamp, undefined);
        return `${label} (${elapsed})`;
    }

    getLabel(item: WidgetItem, kind: NotificationKind): string {
        const customRaw = this.getRawLabel(
            item,
            kind === 'permission' ? LABEL_PERMISSION_KEY : LABEL_IDLE_KEY
        );
        const fallback = kind === 'permission' ? DEFAULT_LABEL_PERMISSION : DEFAULT_LABEL_IDLE;
        const source = customRaw !== null && customRaw.length > 0 ? customRaw : fallback;
        return truncateVisible(source, MAX_LABEL_VISIBLE);
    }

    private getRawLabel(item: WidgetItem, key: string): string | null {
        const raw = item.metadata?.[key];
        if (typeof raw !== 'string' || raw.length === 0)
            return null;
        return raw;
    }

    getMode(item: WidgetItem): Mode {
        const raw = item.metadata?.[MODE_KEY];
        return raw !== undefined && (MODES as string[]).includes(raw) ? raw as Mode : 'both';
    }

    getTtl(item: WidgetItem): number {
        const raw = item.metadata?.[TTL_KEY];
        if (raw === undefined)
            return DEFAULT_TTL;
        const parsed = parseInt(raw, 10);
        if (Number.isNaN(parsed) || parsed < MIN_TTL || parsed > MAX_TTL)
            return DEFAULT_TTL;
        return parsed;
    }

    isShowElapsedEnabled(item: WidgetItem): boolean {
        return isMetadataFlagEnabled(item, SHOW_ELAPSED_KEY);
    }

    isHideWhenIdleEnabled(item: WidgetItem): boolean {
        const raw = item.metadata?.[HIDE_WHEN_IDLE_KEY];
        if (raw === undefined)
            return true;
        return raw === 'true';
    }
}

const NeedsAttentionEditor: React.FC<WidgetEditorProps> = ({ widget, onComplete, onCancel, action }) => {
    const editingPermission = action === EDIT_LABEL_PERMISSION_ACTION;
    const editingIdle = action === EDIT_LABEL_IDLE_ACTION;
    const metadataKey = editingPermission ? LABEL_PERMISSION_KEY : LABEL_IDLE_KEY;
    const [value, setValue] = useState(widget.metadata?.[metadataKey] ?? '');

    useInput((input, key) => {
        if (!editingPermission && !editingIdle)
            return;

        if (key.return) {
            const next = { ...(widget.metadata ?? {}) };
            if (value.length === 0) {
                // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                delete next[metadataKey];
            } else {
                next[metadataKey] = value;
            }
            onComplete({
                ...widget,
                metadata: Object.keys(next).length > 0 ? next : undefined
            });
            return;
        }
        if (key.escape) {
            onCancel();
            return;
        }
        if (key.backspace) {
            setValue(value.slice(0, -1));
            return;
        }
        if (shouldInsertInput(input, key)) {
            setValue(value + input);
        }
    });

    if (!editingPermission && !editingIdle) {
        return <Text>Unknown editor mode</Text>;
    }

    const heading = editingPermission ? 'permission' : 'idle';
    const fallback = editingPermission ? DEFAULT_LABEL_PERMISSION : DEFAULT_LABEL_IDLE;

    return (
        <Box flexDirection='column'>
            <Box>
                <Text>
                    {`Enter ${heading} label (empty for default "${fallback}", truncated to ${MAX_LABEL_VISIBLE} chars at render): `}
                </Text>
                <Text>{value}</Text>
                <Text backgroundColor='gray' color='black'>{' '}</Text>
            </Box>
            <Text dimColor>Press Enter to save, ESC to cancel</Text>
        </Box>
    );
};
