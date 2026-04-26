import {
    describe,
    expect,
    it
} from 'vitest';

import type { RenderContext } from '../../types/RenderContext';
import type { Settings } from '../../types/Settings';
import type { TodoItem } from '../../types/TodoProgressMetrics';
import type { WidgetItem } from '../../types/Widget';
import {
    LEGACY_TODO_TOOLS,
    TODO_TOOLS
} from '../../utils/tool-names';
import {
    TodoProgressWidget,
    formatTodoProgress,
    formatTodoStatus
} from '../TodoProgress';

function makeItem(overrides: Partial<WidgetItem> = {}): WidgetItem {
    return { id: 'w1', type: 'todo-progress', ...overrides };
}

function makeContext(todos: TodoItem[], overrides: Partial<RenderContext> = {}): RenderContext {
    return {
        todoProgressMetrics: { todos, timestamp: '2026-04-19T10:00:00.000Z' },
        ...overrides
    };
}

const settings = {} as Settings;

describe('formatTodoProgress', () => {
    const off = { hideProgress: false, hideContent: false };

    it('returns Todo: none when todos empty', () => {
        expect(formatTodoProgress([], off, false)).toBe('Todo: none');
    });

    it('returns empty string when empty and rawValue', () => {
        expect(formatTodoProgress([], off, true)).toBe('');
    });

    it('formats in_progress with progress by default', () => {
        const todos: TodoItem[] = [
            { content: 'Fix auth', status: 'in_progress' },
            { content: 'Ship', status: 'pending' },
            { content: 'Done', status: 'completed' }
        ];
        expect(formatTodoProgress(todos, off, false)).toBe('▸ Fix auth (1/3)');
    });

    it('omits icon and label in rawValue for in_progress', () => {
        const todos: TodoItem[] = [
            { content: 'Fix auth', status: 'in_progress' },
            { content: 'Ship', status: 'pending' }
        ];
        expect(formatTodoProgress(todos, off, true)).toBe('Fix auth (0/2)');
    });

    it('truncates long in_progress content at 40 chars', () => {
        const long = 'a'.repeat(60);
        const todos: TodoItem[] = [{ content: long, status: 'in_progress' }];
        const out = formatTodoProgress(todos, off, false);
        expect(out).toBe(`▸ ${`a`.repeat(37)}... (0/1)`);
    });

    it('hideProgress strips the ratio', () => {
        const todos: TodoItem[] = [
            { content: 'Fix auth', status: 'in_progress' }
        ];
        expect(formatTodoProgress(todos, { hideProgress: true, hideContent: false }, false))
            .toBe('▸ Fix auth');
    });

    it('hideContent replaces content with in progress label', () => {
        const todos: TodoItem[] = [
            { content: 'Fix auth', status: 'in_progress' },
            { content: 'Ship', status: 'completed' }
        ];
        expect(formatTodoProgress(todos, { hideProgress: false, hideContent: true }, false))
            .toBe('Todo: 1/2 in progress');
    });

    it('hideContent + hideProgress collapses to in progress', () => {
        const todos: TodoItem[] = [
            { content: 'Fix auth', status: 'in_progress' }
        ];
        expect(formatTodoProgress(todos, { hideProgress: true, hideContent: true }, false))
            .toBe('Todo: in progress');
    });

    it('without any in_progress shows done ratio', () => {
        const todos: TodoItem[] = [
            { content: 'A', status: 'completed' },
            { content: 'B', status: 'pending' }
        ];
        expect(formatTodoProgress(todos, off, false)).toBe('Todo: 1/2 done');
    });

    it('without in_progress + hideProgress shows bare done', () => {
        const todos: TodoItem[] = [{ content: 'A', status: 'completed' }];
        expect(formatTodoProgress(todos, { hideProgress: true, hideContent: false }, false))
            .toBe('Todo: done');
    });

    it('rawValue strips Todo: label for done state', () => {
        const todos: TodoItem[] = [{ content: 'A', status: 'completed' }];
        expect(formatTodoProgress(todos, off, true)).toBe('1/1 done');
    });
});

describe('formatTodoStatus', () => {
    it('returns Todo: none when todos empty (label form)', () => {
        expect(formatTodoStatus([], false)).toBe('Todo: none');
    });

    it('returns empty string when empty + rawValue', () => {
        expect(formatTodoStatus([], true)).toBe('');
    });

    it('counts pending/in_progress/completed and labels TODO/DOING/DONE', () => {
        const todos: TodoItem[] = [
            { content: 'a', status: 'pending' },
            { content: 'b', status: 'pending' },
            { content: 'c', status: 'in_progress' },
            { content: 'd', status: 'completed' },
            { content: 'e', status: 'completed' },
            { content: 'f', status: 'completed' }
        ];
        expect(formatTodoStatus(todos, false)).toBe('Todo: ☐ Todo ×2 | ◐ Doing ×1 | ✓ Done ×3');
    });

    it('rawValue collapses to "pending/in_progress/completed" tri-count', () => {
        const todos: TodoItem[] = [
            { content: 'a', status: 'pending' },
            { content: 'b', status: 'in_progress' },
            { content: 'c', status: 'completed' }
        ];
        expect(formatTodoStatus(todos, true)).toBe('1/1/1');
    });

    it('omits empty buckets (only ✓ when nothing else)', () => {
        const todos: TodoItem[] = [
            { content: 'a', status: 'completed' },
            { content: 'b', status: 'completed' }
        ];
        expect(formatTodoStatus(todos, false)).toBe('Todo: ✓ Done ×2');
    });

    it('omits empty buckets (pending-only)', () => {
        const todos: TodoItem[] = [
            { content: 'a', status: 'pending' },
            { content: 'b', status: 'pending' },
            { content: 'c', status: 'pending' }
        ];
        expect(formatTodoStatus(todos, false)).toBe('Todo: ☐ Todo ×3');
    });

    it('omits empty buckets (no pending, has doing + done)', () => {
        const todos: TodoItem[] = [
            { content: 'a', status: 'in_progress' },
            { content: 'b', status: 'completed' },
            { content: 'c', status: 'completed' }
        ];
        expect(formatTodoStatus(todos, false)).toBe('Todo: ◐ Doing ×1 | ✓ Done ×2');
    });

    it('rawValue still reports all three buckets even when some are zero', () => {
        const todos: TodoItem[] = [
            { content: 'a', status: 'completed' },
            { content: 'b', status: 'completed' }
        ];
        expect(formatTodoStatus(todos, true)).toBe('0/0/2');
    });
});

describe('TodoProgressWidget', () => {
    const widget = new TodoProgressWidget();

    it('reports static metadata', () => {
        expect(widget.getDisplayName()).toBe('Todo Progress');
        expect(widget.getCategory()).toBe('Session');
        expect(widget.getDefaultColor()).toBe('yellow');
        expect(widget.supportsRawValue()).toBe(true);
    });

    it('registers hooks for the new task tools plus legacy TodoWrite', () => {
        expect(widget.getHooks()).toEqual([
            { event: 'PostToolUse', matcher: 'TaskCreate' },
            { event: 'PostToolUse', matcher: 'TaskUpdate' },
            { event: 'PostToolUse', matcher: 'TodoWrite' },
            { event: 'UserPromptSubmit' }
        ]);
    });

    it('returns preview output in preview mode', () => {
        const result = widget.render(makeItem(), { isPreview: true }, settings);
        expect(result).toBe('▸ Fix authentication bug (1/5)');
    });

    it('renders Todo: none when no metrics', () => {
        expect(widget.render(makeItem(), {}, settings)).toBe('Todo: none');
    });

    it('returns null when empty and hideWhenEmpty is on', () => {
        const item = makeItem({ metadata: { hideWhenEmpty: 'true' } });
        expect(widget.render(item, {}, settings)).toBeNull();
    });

    it('renders in_progress with progress from context', () => {
        const ctx = makeContext([
            { content: 'Fix bug', status: 'in_progress' },
            { content: 'Ship', status: 'pending' }
        ]);
        expect(widget.render(makeItem(), ctx, settings)).toBe('▸ Fix bug (0/2)');
    });

    it('respects hideProgress metadata', () => {
        const ctx = makeContext([{ content: 'Fix bug', status: 'in_progress' }]);
        const item = makeItem({ metadata: { hideProgress: 'true' } });
        expect(widget.render(item, ctx, settings)).toBe('▸ Fix bug');
    });

    it('respects hideContent metadata', () => {
        const ctx = makeContext([
            { content: 'Fix bug', status: 'in_progress' },
            { content: 'Ship', status: 'completed' }
        ]);
        const item = makeItem({ metadata: { hideContent: 'true' } });
        expect(widget.render(item, ctx, settings)).toBe('Todo: 1/2 in progress');
    });

    it('cycles toggle handlers', () => {
        const base = makeItem();
        const afterP = widget.handleEditorAction('toggle-hide-progress', base);
        expect(afterP?.metadata?.hideProgress).toBe('true');
        const afterC = widget.handleEditorAction('toggle-hide-content', base);
        expect(afterC?.metadata?.hideContent).toBe('true');
        const afterH = widget.handleEditorAction('toggle-hide-empty', base);
        expect(afterH?.metadata?.hideWhenEmpty).toBe('true');
        expect(widget.handleEditorAction('unknown', base)).toBeNull();
    });

    it('cycle-mode rotates current → status → current', () => {
        const base = makeItem();
        const a = widget.handleEditorAction('cycle-mode', base);
        expect(a?.metadata?.mode).toBe('status');
        const b = widget.handleEditorAction('cycle-mode', a ?? base);
        expect(b?.metadata?.mode).toBe('current');
    });

    it('renders status mode breakdown from real metrics', () => {
        const ctx = makeContext([
            { content: 'a', status: 'pending' },
            { content: 'b', status: 'pending' },
            { content: 'c', status: 'in_progress' },
            { content: 'd', status: 'completed' },
            { content: 'e', status: 'completed' },
            { content: 'f', status: 'completed' }
        ]);
        const item = makeItem({ metadata: { mode: 'status' } });
        expect(widget.render(item, ctx, settings)).toBe('Todo: ☐ Todo ×2 | ◐ Doing ×1 | ✓ Done ×3');
    });

    it('renders status mode rawValue without label', () => {
        const ctx = makeContext([
            { content: 'a', status: 'pending' },
            { content: 'b', status: 'in_progress' },
            { content: 'c', status: 'completed' }
        ]);
        const item = makeItem({ rawValue: true, metadata: { mode: 'status' } });
        expect(widget.render(item, ctx, settings)).toBe('1/1/1');
    });

    it('renders status mode preview sample', () => {
        // Sample is 3 pending + 1 in_progress + 1 completed.
        const item = makeItem({ metadata: { mode: 'status' } });
        expect(widget.render(item, { isPreview: true }, settings))
            .toBe('Todo: ☐ Todo ×3 | ◐ Doing ×1 | ✓ Done ×1');
    });

    it('builds editor display modifiers in order', () => {
        const item = makeItem({ metadata: { hideContent: 'true', hideProgress: 'true', hideWhenEmpty: 'true' } });
        const display = widget.getEditorDisplay(item);
        expect(display.displayText).toBe('Todo Progress');
        expect(display.modifierText).toBe('(current, no content, no progress, hide when empty)');
    });

    it('shows just the mode label when no other flags set', () => {
        expect(widget.getEditorDisplay(makeItem()).modifierText).toBe('(current)');
    });

    it('shows status label when mode is status', () => {
        const item = makeItem({ metadata: { mode: 'status' } });
        expect(widget.getEditorDisplay(item).modifierText).toBe('(status)');
    });

    it('surfaces stale minutes in editor modifier when configured', () => {
        const item = makeItem({ metadata: { staleMinutes: '30' } });
        expect(widget.getEditorDisplay(item).modifierText).toBe('(current, stale: 30m)');
    });

    it('treats snapshot as empty when staleMinutes exceeded', () => {
        const oldTimestamp = new Date(Date.now() - 60 * 60_000).toISOString();  // 60 min ago
        const ctx: RenderContext = {
            todoProgressMetrics: {
                todos: [{ content: 'Stale task', status: 'in_progress' }],
                timestamp: oldTimestamp
            }
        };
        const item = makeItem({ metadata: { staleMinutes: '30' } });  // 30 min threshold
        expect(widget.render(item, ctx, settings)).toBe('Todo: none');
    });

    it('keeps snapshot when within staleMinutes window', () => {
        const recent = new Date(Date.now() - 10 * 60_000).toISOString();  // 10 min ago
        const ctx: RenderContext = {
            todoProgressMetrics: {
                todos: [{ content: 'Fresh task', status: 'in_progress' }],
                timestamp: recent
            }
        };
        const item = makeItem({ metadata: { staleMinutes: '30' } });
        expect(widget.render(item, ctx, settings)).toBe('▸ Fresh task (0/1)');
    });

    it('staleMinutes=0 disables the check', () => {
        const ancient = new Date(2020, 0, 1).toISOString();
        const ctx: RenderContext = {
            todoProgressMetrics: {
                todos: [{ content: 'Old but not stale', status: 'in_progress' }],
                timestamp: ancient
            }
        };
        const item = makeItem({ metadata: { staleMinutes: '0' } });
        expect(widget.render(item, ctx, settings)).toBe('▸ Old but not stale (0/1)');
    });
});

describe('TodoProgressWidget — hook / TODO_TOOLS consistency', () => {
    // Invariant: every name in TODO_TOOLS must have a matching PostToolUse
    // hook in TodoProgress.getHooks(). A name in the set without a hook
    // means handleHook will never see that tool — which previously was the
    // case for TaskList. Catching that drift here keeps the two definitions
    // from silently diverging again.
    it('every TODO_TOOLS entry is registered as a PostToolUse hook', () => {
        const widget = new TodoProgressWidget();
        const postToolMatchers = widget.getHooks()
            .filter(h => h.event === 'PostToolUse' && typeof h.matcher === 'string')
            .map(h => h.matcher);

        for (const name of TODO_TOOLS) {
            expect(postToolMatchers).toContain(name);
        }
    });

    it('every PostToolUse matcher points at a known todo tool', () => {
        const widget = new TodoProgressWidget();
        const knownNames = new Set<string>([...TODO_TOOLS, ...LEGACY_TODO_TOOLS]);

        for (const hook of widget.getHooks()) {
            if (hook.event !== 'PostToolUse') {
                continue;
            }
            expect(hook.matcher, 'PostToolUse hook should always carry a matcher').toBeDefined();
            if (typeof hook.matcher === 'string') {
                expect(knownNames.has(hook.matcher)).toBe(true);
            }
        }
    });
});
