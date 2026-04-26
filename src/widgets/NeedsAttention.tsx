import {
    Box,
    Text,
    useInput
} from 'ink';
import React, { useState } from 'react';

import type {
    ActiveNotification,
    NotificationEntry
} from '../types/NotificationState';
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
import { selectActiveNotification } from '../utils/notification';

import { makeModifierText } from './shared/editor-display';
import {
    isMetadataFlagEnabled,
    toggleMetadataFlag
} from './shared/metadata';

type Mode = 'both' | 'permission' | 'idle';

const MODES: Mode[] = ['both', 'permission', 'idle'];
const TTL_CYCLE: number[] = [30, 45, 60, 120, 300];

const TTL_DEFAULT = 45;
const TTL_MIN = 5;
const TTL_MAX = 600;
const LABEL_MAX_VISIBLE = 20;

const DEFAULT_PERMISSION_LABEL = '⚠ permission';
const DEFAULT_IDLE_LABEL = '◔ idle';
const DEFAULT_NONE_LABEL = '⚠ none';

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

function truncateLabel(label: string, maxVisible = LABEL_MAX_VISIBLE): string {
    const graphemes = Array.from(label);
    if (graphemes.length <= maxVisible)
        return label;
    return graphemes.slice(0, maxVisible - 1).join('') + '…';
}

export function formatElapsedSeconds(elapsedMs: number): string {
    const seconds = Math.max(1, Math.round(elapsedMs / 1000));
    if (seconds < 60)
        return `${seconds}s`;
    const totalMinutes = Math.floor(seconds / 60);
    const remainSeconds = seconds % 60;
    if (totalMinutes < 60) {
        return `${totalMinutes}m${remainSeconds.toString().padStart(2, '0')}s`;
    }
    const hours = Math.floor(totalMinutes / 60);
    const remainMinutes = totalMinutes % 60;
    return `${hours}h${remainMinutes.toString().padStart(2, '0')}m`;
}

export class NeedsAttentionWidget implements Widget {
    getDefaultColor(): string { return 'yellow'; }

    getDescription(): string {
        return 'Highlights status line when Claude Code is waiting for permission or idle';
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
        const ttl = this.getTtlSeconds(item);
        const modifiers: string[] = [mode, `ttl=${ttl}s`];
        if (this.isShowElapsed(item))
            modifiers.push('elapsed');
        if (!this.isHideWhenIdle(item))
            modifiers.push('show idle frame');
        if (this.getLabelPermission(item) !== DEFAULT_PERMISSION_LABEL)
            modifiers.push('custom perm');
        if (this.getLabelIdle(item) !== DEFAULT_IDLE_LABEL)
            modifiers.push('custom idle');
        return {
            displayText: this.getDisplayName(),
            modifierText: makeModifierText(modifiers)
        };
    }

    // Note: PRD specified `i` for idle label, but ItemsEditor reserves `i`
    // (insert). Using `l` (mnemonic: id*l*e) so the binding actually fires.
    getCustomKeybinds(_item?: WidgetItem): CustomKeybind[] {
        return [
            { key: 'v', label: '(v)iew mode: both/permission/idle', action: CYCLE_MODE_ACTION },
            { key: 't', label: '(t)tl: 30/45/60/120/300s', action: CYCLE_TTL_ACTION },
            { key: 'e', label: '(e)lapsed', action: TOGGLE_SHOW_ELAPSED_ACTION },
            { key: 'h', label: '(h)ide when idle', action: TOGGLE_HIDE_WHEN_IDLE_ACTION },
            { key: 'p', label: '(p)ermission label', action: EDIT_LABEL_PERMISSION_ACTION },
            { key: 'l', label: 'id(l)e label', action: EDIT_LABEL_IDLE_ACTION }
        ];
    }

    handleEditorAction(action: string, item: WidgetItem): WidgetItem | null {
        if (action === CYCLE_MODE_ACTION) {
            const current = this.getMode(item);
            const nextIndex = (MODES.indexOf(current) + 1) % MODES.length;
            const next = MODES[nextIndex] ?? 'both';
            return { ...item, metadata: { ...item.metadata, [MODE_KEY]: next } };
        }
        if (action === CYCLE_TTL_ACTION) {
            const current = this.getTtlSeconds(item);
            const idx = TTL_CYCLE.indexOf(current);
            const next = TTL_CYCLE[(idx + 1) % TTL_CYCLE.length] ?? TTL_DEFAULT;
            return { ...item, metadata: { ...item.metadata, [TTL_KEY]: next.toString() } };
        }
        if (action === TOGGLE_SHOW_ELAPSED_ACTION) {
            return toggleMetadataFlag(item, SHOW_ELAPSED_KEY);
        }
        if (action === TOGGLE_HIDE_WHEN_IDLE_ACTION) {
            const currentlyHiding = this.isHideWhenIdle(item);
            return {
                ...item,
                metadata: {
                    ...item.metadata,
                    [HIDE_WHEN_IDLE_KEY]: (!currentlyHiding).toString()
                }
            };
        }
        return null;
    }

    render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
        const rawValue = item.rawValue === true;
        const hideWhenIdle = this.isHideWhenIdle(item);
        const showElapsed = this.isShowElapsed(item);

        if (context.isPreview) {
            return this.renderPreview(item, rawValue, hideWhenIdle, showElapsed);
        }

        const ttl = this.getTtlSeconds(item);
        const mode = this.getMode(item);
        const entries: NotificationEntry[] = context.notificationEntries ?? [];
        const active = selectActiveNotification(entries, { ttlSeconds: ttl, mode });

        if (!active) {
            if (hideWhenIdle)
                return null;
            return rawValue ? '' : DEFAULT_NONE_LABEL;
        }

        return this.formatActiveLabel(item, active, showElapsed, new Date());
    }

    renderEditor(props: WidgetEditorProps): React.ReactElement | null {
        if (props.action === EDIT_LABEL_PERMISSION_ACTION
            || props.action === EDIT_LABEL_IDLE_ACTION) {
            return <NeedsAttentionLabelEditor {...props} />;
        }
        return null;
    }

    private renderPreview(
        item: WidgetItem,
        rawValue: boolean,
        hideWhenIdle: boolean,
        showElapsed: boolean
    ): string | null {
        const mode = this.getMode(item);
        if (mode === 'idle') {
            return this.formatPreviewLabel(item, 'idle', showElapsed);
        }
        if (mode === 'permission') {
            return this.formatPreviewLabel(item, 'permission', showElapsed);
        }
        if (hideWhenIdle) {
            return this.formatPreviewLabel(item, 'permission', showElapsed);
        }
        return this.formatPreviewLabel(item, 'permission', showElapsed);
    }

    private formatPreviewLabel(
        item: WidgetItem,
        kind: 'permission' | 'idle',
        showElapsed: boolean
    ): string {
        const base = kind === 'permission'
            ? truncateLabel(this.getLabelPermission(item))
            : truncateLabel(this.getLabelIdle(item));
        if (!showElapsed)
            return base;
        return `${base} (12s)`;
    }

    private formatActiveLabel(
        item: WidgetItem,
        active: ActiveNotification,
        showElapsed: boolean,
        now: Date
    ): string {
        const base = active.kind === 'permission'
            ? truncateLabel(this.getLabelPermission(item))
            : truncateLabel(this.getLabelIdle(item));
        if (!showElapsed)
            return base;
        const elapsedMs = Math.max(0, now.getTime() - active.timestamp.getTime());
        return `${base} (${formatElapsedSeconds(elapsedMs)})`;
    }

    private getMode(item: WidgetItem): Mode {
        const raw = item.metadata?.[MODE_KEY];
        if (raw === 'permission' || raw === 'idle')
            return raw;
        return 'both';
    }

    private getTtlSeconds(item: WidgetItem): number {
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

    private isShowElapsed(item: WidgetItem): boolean {
        return isMetadataFlagEnabled(item, SHOW_ELAPSED_KEY);
    }

    // hideWhenIdle defaults to true (PRD AC-4). Treat absence and any value
    // other than the literal string "false" as enabled.
    private isHideWhenIdle(item: WidgetItem): boolean {
        const raw = item.metadata?.[HIDE_WHEN_IDLE_KEY];
        if (raw === undefined)
            return true;
        return raw !== 'false';
    }

    private getLabelPermission(item: WidgetItem): string {
        const raw = item.metadata?.[LABEL_PERMISSION_KEY];
        if (raw === undefined || raw === '')
            return DEFAULT_PERMISSION_LABEL;
        return raw;
    }

    private getLabelIdle(item: WidgetItem): string {
        const raw = item.metadata?.[LABEL_IDLE_KEY];
        if (raw === undefined || raw === '')
            return DEFAULT_IDLE_LABEL;
        return raw;
    }
}

const NeedsAttentionLabelEditor: React.FC<WidgetEditorProps> = ({ widget, onComplete, onCancel, action }) => {
    const editingPermission = action === EDIT_LABEL_PERMISSION_ACTION;
    const metadataKey = editingPermission ? LABEL_PERMISSION_KEY : LABEL_IDLE_KEY;
    const initialValue = widget.metadata?.[metadataKey] ?? '';
    const [value, setValue] = useState(initialValue);

    useInput((input, key) => {
        if (key.return) {
            const trimmed = value.trim();
            const baseEntries = Object.entries(widget.metadata ?? {})
                .filter(([entryKey]) => entryKey !== metadataKey);
            const nextEntries = trimmed === ''
                ? baseEntries
                : [...baseEntries, [metadataKey, trimmed] as const];
            const nextMetadata = Object.fromEntries(nextEntries);
            onComplete({
                ...widget,
                metadata: Object.keys(nextMetadata).length > 0 ? nextMetadata : undefined
            });
            return;
        }
        if (key.escape) {
            onCancel();
            return;
        }
        if (key.backspace || key.delete) {
            setValue(prev => prev.slice(0, -1));
            return;
        }
        if (shouldInsertInput(input, key)) {
            setValue(prev => prev + input);
        }
    });

    const promptText = editingPermission
        ? 'Edit permission label (≤20 visible chars, blank = default): '
        : 'Edit idle label (≤20 visible chars, blank = default): ';
    return (
        <Box flexDirection='column'>
            <Box>
                <Text>{promptText}</Text>
                <Text>{value}</Text>
                <Text backgroundColor='gray' color='black'>{' '}</Text>
            </Box>
            <Text dimColor>Press Enter to save, ESC to cancel.</Text>
        </Box>
    );
};
