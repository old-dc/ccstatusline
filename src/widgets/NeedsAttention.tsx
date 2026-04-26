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
    selectActiveNotification,
    type NotificationEntry,
    type NotificationKind,
    type NotificationMode
} from '../utils/notification';

import { formatElapsed } from './AgentActivity';
import { makeModifierText } from './shared/editor-display';
import {
    isMetadataFlagEnabled,
    toggleMetadataFlag
} from './shared/metadata';

const MODES: NotificationMode[] = ['both', 'permission', 'idle'];

const TTL_OPTIONS = [30, 45, 60, 120, 300] as const;
export const DEFAULT_TTL_SEC = 45;
const TTL_MIN = 5;
const TTL_MAX = 600;

const LABEL_MAX_VISIBLE = 20;

const DEFAULT_LABELS: Record<NotificationKind, string> = {
    permission: '⚠ permission',
    idle: '◔ idle'
};

const TTL_KEY = 'ttl';
const SHOW_ELAPSED_KEY = 'showElapsed';
const HIDE_WHEN_IDLE_KEY = 'hideWhenIdle';
const LABEL_PERMISSION_KEY = 'labelPermission';
const LABEL_IDLE_KEY = 'labelIdle';

const CYCLE_MODE_ACTION = 'cycle-mode';
const CYCLE_TTL_ACTION = 'cycle-ttl';
const TOGGLE_ELAPSED_ACTION = 'toggle-elapsed';
const TOGGLE_HIDE_IDLE_ACTION = 'toggle-hide-idle';
const EDIT_LABEL_PERMISSION_ACTION = 'edit-label-permission';
const EDIT_LABEL_IDLE_ACTION = 'edit-label-idle';

// Truncate label by visible character count (Array.from handles surrogate
// pairs; combining marks are out of scope and will overcount but render fine).
export function truncateLabel(label: string, maxVisible = LABEL_MAX_VISIBLE): string {
    const chars = Array.from(label);
    if (chars.length <= maxVisible)
        return label;
    return chars.slice(0, maxVisible - 1).join('') + '…';
}

// PRD AC-12 says elapsed is bounded ≥1s, so coerce sub-second deltas up to 1s
// rather than emitting AgentActivity's "<1s" placeholder.
export function formatNotificationElapsed(start: Date, now: Date): string {
    const ms = Math.max(0, now.getTime() - start.getTime());
    if (ms < 1000)
        return '1s';
    return formatElapsed(start, undefined, now);
}

export class NeedsAttentionWidget implements Widget {
    getDefaultColor(): string { return 'yellow'; }
    getDescription(): string {
        return 'Highlights when Claude Code is awaiting permission or idle (Notification hook)';
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
            modifiers.push('show idle');

        return {
            displayText: 'Needs Attention',
            modifierText: makeModifierText(modifiers)
        };
    }

    // ItemsEditor reserves a/i/d/k/c/r/m/space. PRD's "i" for idle label
    // collides with the insert action, so we map idle-label edit to "l"
    // (mnemonic: id"l"e). All other keys match the PRD UI table.
    getCustomKeybinds(_item?: WidgetItem): CustomKeybind[] {
        return [
            { key: 'v', label: '(v)iew mode: both/permission/idle', action: CYCLE_MODE_ACTION },
            { key: 't', label: '(t)tl', action: CYCLE_TTL_ACTION },
            { key: 'e', label: '(e)lapsed', action: TOGGLE_ELAPSED_ACTION },
            { key: 'h', label: '(h)ide when idle', action: TOGGLE_HIDE_IDLE_ACTION },
            { key: 'p', label: '(p)ermission label', action: EDIT_LABEL_PERMISSION_ACTION },
            { key: 'l', label: 'id(l)e label', action: EDIT_LABEL_IDLE_ACTION }
        ];
    }

    handleEditorAction(action: string, item: WidgetItem): WidgetItem | null {
        if (action === CYCLE_MODE_ACTION) {
            const current = this.getMode(item);
            const next = MODES[(MODES.indexOf(current) + 1) % MODES.length] ?? 'both';
            return { ...item, metadata: { ...item.metadata, mode: next } };
        }
        if (action === CYCLE_TTL_ACTION) {
            const ttl = this.getTtl(item);
            const idx = TTL_OPTIONS.indexOf(ttl as typeof TTL_OPTIONS[number]);
            const next = TTL_OPTIONS[(idx + 1) % TTL_OPTIONS.length] ?? DEFAULT_TTL_SEC;
            return { ...item, metadata: { ...item.metadata, [TTL_KEY]: next.toString() } };
        }
        if (action === TOGGLE_ELAPSED_ACTION) {
            return toggleMetadataFlag(item, SHOW_ELAPSED_KEY);
        }
        if (action === TOGGLE_HIDE_IDLE_ACTION) {
            // hideWhenIdle defaults true. Track explicit user value so the
            // metadata flag toggles between 'true'/'false' from any starting
            // point.
            const current = this.isHideWhenIdleEnabled(item);
            return {
                ...item,
                metadata: { ...item.metadata, [HIDE_WHEN_IDLE_KEY]: (!current).toString() }
            };
        }
        return null;
    }

    render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
        const rawValue = item.rawValue === true;
        const mode = this.getMode(item);
        const showElapsed = this.isShowElapsedEnabled(item);
        const hideWhenIdle = this.isHideWhenIdleEnabled(item);
        const ttl = this.getTtl(item);

        if (context.isPreview) {
            return this.renderPreview(item, showElapsed);
        }

        const entries = context.notificationEntries ?? [];
        const active = selectActiveNotification(entries, { mode, ttlSec: ttl });

        if (!active) {
            if (hideWhenIdle)
                return null;
            return rawValue ? '' : '⚠ none';
        }

        return this.formatActive(item, active, showElapsed);
    }

    private renderPreview(item: WidgetItem, showElapsed: boolean): string {
        const mode = this.getMode(item);
        const previewKind: NotificationKind = mode === 'idle' ? 'idle' : 'permission';
        const sample: NotificationEntry = {
            type: previewKind,
            timestamp: new Date(Date.now() - 12_000)
        };
        return this.formatActive(item, sample, showElapsed);
    }

    // The active label is identical for rawValue=true and rawValue=false (the
    // PRD only differentiates the two for the empty/idle output), so this
    // helper does not branch on rawValue.
    private formatActive(
        item: WidgetItem,
        entry: NotificationEntry,
        showElapsed: boolean
    ): string {
        const baseLabel = this.getLabel(item, entry.type);
        const label = truncateLabel(baseLabel);
        if (!showElapsed)
            return label;
        const elapsed = formatNotificationElapsed(entry.timestamp, new Date());
        return `${label} (${elapsed})`;
    }

    renderEditor(props: WidgetEditorProps): React.ReactElement {
        return <NeedsAttentionEditor {...props} />;
    }

    getMode(item: WidgetItem): NotificationMode {
        const raw = item.metadata?.mode;
        if (raw && (MODES as string[]).includes(raw))
            return raw as NotificationMode;
        return 'both';
    }

    getTtl(item: WidgetItem): number {
        const raw = item.metadata?.[TTL_KEY];
        if (raw === undefined)
            return DEFAULT_TTL_SEC;
        const parsed = parseInt(raw, 10);
        if (Number.isNaN(parsed) || parsed < TTL_MIN || parsed > TTL_MAX)
            return DEFAULT_TTL_SEC;
        return parsed;
    }

    isShowElapsedEnabled(item: WidgetItem): boolean {
        return isMetadataFlagEnabled(item, SHOW_ELAPSED_KEY);
    }

    // hideWhenIdle defaults to true when the metadata key is missing.
    isHideWhenIdleEnabled(item: WidgetItem): boolean {
        const raw = item.metadata?.[HIDE_WHEN_IDLE_KEY];
        if (raw === undefined)
            return true;
        return raw !== 'false';
    }

    getLabel(item: WidgetItem, kind: NotificationKind): string {
        const key = kind === 'permission' ? LABEL_PERMISSION_KEY : LABEL_IDLE_KEY;
        const value = item.metadata?.[key];
        if (value === undefined || value === '')
            return DEFAULT_LABELS[kind];
        return value;
    }
}

const NeedsAttentionEditor: React.FC<WidgetEditorProps> = ({ widget, onComplete, onCancel, action }) => {
    const isLabelAction = action === EDIT_LABEL_PERMISSION_ACTION || action === EDIT_LABEL_IDLE_ACTION;
    const metadataKey = action === EDIT_LABEL_PERMISSION_ACTION ? LABEL_PERMISSION_KEY : LABEL_IDLE_KEY;

    const initialValue = (() => {
        if (!isLabelAction)
            return '';
        return widget.metadata?.[metadataKey] ?? '';
    })();
    const [value, setValue] = useState(initialValue);

    useInput((input, key) => {
        if (!isLabelAction)
            return;

        if (key.return) {
            const { [metadataKey]: _previous, ...rest } = widget.metadata ?? {};
            void _previous;
            const nextMetadata = value === ''
                ? rest
                : { ...rest, [metadataKey]: value };
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

    if (!isLabelAction) {
        return <Text>Unknown editor mode</Text>;
    }

    const labelKind = action === EDIT_LABEL_PERMISSION_ACTION ? 'permission' : 'idle';
    return (
        <Box flexDirection='column'>
            <Box>
                <Text>
                    Custom
                    {labelKind}
                    {' '}
                    label (empty for default, max 20 visible chars):
                    {' '}
                </Text>
                <Text>{value}</Text>
                <Text backgroundColor='gray' color='black'>{' '}</Text>
            </Box>
            <Text dimColor>Press Enter to save, ESC to cancel</Text>
        </Box>
    );
};
