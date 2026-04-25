import {
    Box,
    Text,
    useInput
} from 'ink';
import React, { useState } from 'react';

import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type { TodoItem } from '../types/TodoProgressMetrics';
import type {
    CustomKeybind,
    Widget,
    WidgetEditorDisplay,
    WidgetEditorProps,
    WidgetItem
} from '../types/Widget';
import type { WidgetHookDef } from '../utils/hooks';
import { shouldInsertInput } from '../utils/input-guards';

import { makeModifierText } from './shared/editor-display';
import {
    isMetadataFlagEnabled,
    toggleMetadataFlag
} from './shared/metadata';

type Mode = 'current' | 'status';
const MODES: Mode[] = ['current', 'status'];
const MODE_LABELS: Record<Mode, string> = {
    current: 'current',
    status: 'status'
};

const HIDE_WHEN_EMPTY_KEY = 'hideWhenEmpty';
const HIDE_PROGRESS_KEY = 'hideProgress';
const HIDE_CONTENT_KEY = 'hideContent';
const STALE_MINUTES_KEY = 'staleMinutes';

const CYCLE_MODE_ACTION = 'cycle-mode';
const TOGGLE_HIDE_EMPTY_ACTION = 'toggle-hide-empty';
const TOGGLE_HIDE_PROGRESS_ACTION = 'toggle-hide-progress';
const TOGGLE_HIDE_CONTENT_ACTION = 'toggle-hide-content';
const EDIT_STALE_ACTION = 'edit-stale-minutes';

export interface TodoDisplayFlags {
    hideProgress: boolean;
    hideContent: boolean;
}

function truncate(text: string, maxLen: number): string {
    if (text.length <= maxLen)
        return text;
    return `${text.slice(0, maxLen - 3)}...`;
}

export function formatTodoProgress(
    todos: TodoItem[],
    flags: TodoDisplayFlags,
    rawValue: boolean
): string {
    if (todos.length === 0) {
        return rawValue ? '' : 'Todo: none';
    }

    const completed = todos.filter(t => t.status === 'completed').length;
    const total = todos.length;
    const progress = `${completed}/${total}`;
    const inProgress = todos.find(t => t.status === 'in_progress');

    if (inProgress) {
        if (flags.hideContent) {
            const body = flags.hideProgress ? 'in progress' : `${progress} in progress`;
            return rawValue ? body : `Todo: ${body}`;
        }
        const content = truncate(inProgress.content, 40);
        const body = flags.hideProgress ? content : `${content} (${progress})`;
        return rawValue ? body : `▸ ${body}`;
    }

    const body = flags.hideProgress ? 'done' : `${progress} done`;
    return rawValue ? body : `Todo: ${body}`;
}

export function formatTodoStatus(todos: TodoItem[], rawValue: boolean): string {
    if (todos.length === 0) {
        return rawValue ? '' : 'Todo: none';
    }
    let pending = 0;
    let doing = 0;
    let done = 0;
    for (const t of todos) {
        switch (t.status) {
            case 'pending':
                pending += 1;
                break;
            case 'in_progress':
                doing += 1;
                break;
            case 'completed':
                done += 1;
                break;
        }
    }
    if (rawValue) {
        return `${pending}/${doing}/${done}`;
    }
    const parts: string[] = [];
    if (pending > 0)
        parts.push(`☐ Todo ×${pending}`);
    if (doing > 0)
        parts.push(`◐ Doing ×${doing}`);
    if (done > 0)
        parts.push(`✓ Done ×${done}`);
    return `Todo: ${parts.join(' | ')}`;
}

export class TodoProgressWidget implements Widget {
    getDefaultColor(): string { return 'yellow'; }
    getDescription(): string {
        return 'Shows current in-progress todo and completion ratio from todo tools';
    }

    getDisplayName(): string { return 'Todo Progress'; }
    getCategory(): string { return 'Session'; }
    supportsRawValue(): boolean { return true; }
    supportsColors(_item: WidgetItem): boolean { return true; }

    getHooks(): WidgetHookDef[] {
        return [
            { event: 'PostToolUse', matcher: 'TaskCreate' },
            { event: 'PostToolUse', matcher: 'TaskUpdate' },
            { event: 'PostToolUse', matcher: 'TodoWrite' },
            { event: 'UserPromptSubmit' }
        ];
    }

    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        const mode = this.getMode(item);
        const modifiers: string[] = [MODE_LABELS[mode]];
        if (this.shouldHideContent(item)) {
            modifiers.push('no content');
        }
        if (this.shouldHideProgress(item)) {
            modifiers.push('no progress');
        }
        const stale = this.parseStaleMinutes(item);
        if (stale > 0) {
            modifiers.push(`stale: ${stale}m`);
        }
        if (this.isHideWhenEmptyEnabled(item)) {
            modifiers.push('hide when empty');
        }
        return {
            displayText: 'Todo Progress',
            modifierText: makeModifierText(modifiers)
        };
    }

    getCustomKeybinds(_item?: WidgetItem): CustomKeybind[] {
        return [
            { key: 'v', label: '(v)iew: current/status', action: CYCLE_MODE_ACTION },
            { key: 'p', label: '(p)rogress', action: TOGGLE_HIDE_PROGRESS_ACTION },
            { key: 't', label: '(t)ext', action: TOGGLE_HIDE_CONTENT_ACTION },
            { key: 'h', label: '(h)ide when empty', action: TOGGLE_HIDE_EMPTY_ACTION },
            { key: 's', label: '(s)tale min', action: EDIT_STALE_ACTION }
        ];
    }

    handleEditorAction(action: string, item: WidgetItem): WidgetItem | null {
        if (action === CYCLE_MODE_ACTION) {
            const currentMode = this.getMode(item);
            const nextIndex = (MODES.indexOf(currentMode) + 1) % MODES.length;
            const nextMode = MODES[nextIndex] ?? 'current';
            return { ...item, metadata: { ...item.metadata, mode: nextMode } };
        }
        if (action === TOGGLE_HIDE_PROGRESS_ACTION) {
            return toggleMetadataFlag(item, HIDE_PROGRESS_KEY);
        }
        if (action === TOGGLE_HIDE_CONTENT_ACTION) {
            return toggleMetadataFlag(item, HIDE_CONTENT_KEY);
        }
        if (action === TOGGLE_HIDE_EMPTY_ACTION) {
            return toggleMetadataFlag(item, HIDE_WHEN_EMPTY_KEY);
        }
        // EDIT_STALE_ACTION returns null to trigger renderEditor below.
        return null;
    }

    renderEditor(props: WidgetEditorProps): React.ReactElement {
        return <TodoProgressEditor {...props} />;
    }

    render(item: WidgetItem, context: RenderContext, _settings: Settings): string | null {
        const rawValue = item.rawValue === true;
        const mode = this.getMode(item);
        const flags: TodoDisplayFlags = {
            hideProgress: this.shouldHideProgress(item),
            hideContent: this.shouldHideContent(item)
        };

        if (context.isPreview) {
            const sample: TodoItem[] = [
                { content: 'Write tests', status: 'completed' },
                { content: 'Fix authentication bug', status: 'in_progress' },
                { content: 'Add docs', status: 'pending' },
                { content: 'Ship release', status: 'pending' },
                { content: 'Cleanup', status: 'pending' }
            ];
            return mode === 'status'
                ? formatTodoStatus(sample, rawValue)
                : formatTodoProgress(sample, flags, rawValue);
        }

        const metrics = context.todoProgressMetrics;
        const todos = metrics?.todos ?? [];
        const stale = this.parseStaleMinutes(item);
        const isStale = stale > 0 && metrics?.timestamp
            ? (Date.now() - new Date(metrics.timestamp).getTime()) > stale * 60_000
            : false;

        if (todos.length === 0 || isStale) {
            if (this.isHideWhenEmptyEnabled(item))
                return null;
            return rawValue ? '' : 'Todo: none';
        }

        return mode === 'status'
            ? formatTodoStatus(todos, rawValue)
            : formatTodoProgress(todos, flags, rawValue);
    }

    private getMode(item: WidgetItem): Mode {
        const raw = item.metadata?.mode;
        return raw !== undefined && (MODES as string[]).includes(raw) ? raw as Mode : 'current';
    }

    private shouldHideProgress(item: WidgetItem): boolean {
        return isMetadataFlagEnabled(item, HIDE_PROGRESS_KEY);
    }

    private shouldHideContent(item: WidgetItem): boolean {
        return isMetadataFlagEnabled(item, HIDE_CONTENT_KEY);
    }

    private isHideWhenEmptyEnabled(item: WidgetItem): boolean {
        return isMetadataFlagEnabled(item, HIDE_WHEN_EMPTY_KEY);
    }

    parseStaleMinutes(item: WidgetItem): number {
        const raw = item.metadata?.[STALE_MINUTES_KEY];
        if (raw === undefined)
            return 0;
        const parsed = parseInt(raw, 10);
        if (Number.isNaN(parsed) || parsed < 0)
            return 0;
        return parsed;
    }
}

const TodoProgressEditor: React.FC<WidgetEditorProps> = ({ widget, onComplete, onCancel, action }) => {
    const initialValue = (() => {
        const raw = widget.metadata?.[STALE_MINUTES_KEY];
        if (raw === undefined)
            return '0';
        const parsed = parseInt(raw, 10);
        return Number.isNaN(parsed) || parsed < 0 ? '0' : parsed.toString();
    })();
    const [value, setValue] = useState(initialValue);

    useInput((input, key) => {
        if (action !== EDIT_STALE_ACTION) {
            return;
        }

        if (key.return) {
            const parsed = parseInt(value, 10);
            if (Number.isNaN(parsed) || parsed < 0) {
                onCancel();
                return;
            }
            onComplete({
                ...widget,
                metadata: {
                    ...widget.metadata,
                    [STALE_MINUTES_KEY]: parsed.toString()
                }
            });
        } else if (key.escape) {
            onCancel();
        } else if (key.backspace) {
            setValue(value.slice(0, -1));
        } else if (shouldInsertInput(input, key) && /\d/.test(input)) {
            setValue(value + input);
        }
    });

    if (action === EDIT_STALE_ACTION) {
        return (
            <Box flexDirection='column'>
                <Box>
                    <Text>Stale minutes — treat todo snapshot as empty once older than this (0 disables): </Text>
                    <Text>{value}</Text>
                    <Text backgroundColor='gray' color='black'>{' '}</Text>
                </Box>
                <Text dimColor>Press Enter to save, ESC to cancel</Text>
            </Box>
        );
    }

    return <Text>Unknown editor mode</Text>;
};
