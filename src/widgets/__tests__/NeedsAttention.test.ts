import {
    describe,
    expect,
    it
} from 'vitest';

import type { RenderContext } from '../../types/RenderContext';
import { DEFAULT_SETTINGS } from '../../types/Settings';
import type { WidgetItem } from '../../types/Widget';
import type { NotificationState } from '../../utils/notification';
import {
    NeedsAttentionWidget,
    selectActiveKind,
    truncateVisible
} from '../NeedsAttention';

function makeContext(state: NotificationState | null, isPreview = false): RenderContext {
    return {
        notificationState: state,
        isPreview
    };
}

function makeState(perm: number | null, idle: number | null, baseMs: number = Date.now()): NotificationState {
    return {
        permission: perm === null ? null : new Date(baseMs - perm * 1000),
        idle: idle === null ? null : new Date(baseMs - idle * 1000)
    };
}

function render(item: WidgetItem, context: RenderContext): string | null {
    return new NeedsAttentionWidget().render(item, context, DEFAULT_SETTINGS);
}

const baseItem: WidgetItem = { id: 'na', type: 'needs-attention' };

describe('selectActiveKind priority', () => {
    const fixedNow = new Date('2026-04-26T12:00:00Z');
    const baseMs = fixedNow.getTime();

    it('prefers permission when both are within ttl', () => {
        const state = makeState(5, 10, baseMs);
        const result = selectActiveKind(state, 'both', 45, fixedNow);
        expect(result?.kind).toBe('permission');
    });

    it('falls back to idle when permission has expired', () => {
        const state = makeState(60, 10, baseMs);
        const result = selectActiveKind(state, 'both', 45, fixedNow);
        expect(result?.kind).toBe('idle');
    });

    it('returns null when both are expired', () => {
        const state = makeState(60, 100, baseMs);
        const result = selectActiveKind(state, 'both', 45, fixedNow);
        expect(result).toBeNull();
    });

    it('respects mode=permission filter', () => {
        const state = makeState(null, 5, baseMs);
        const result = selectActiveKind(state, 'permission', 45, fixedNow);
        expect(result).toBeNull();
    });

    it('respects mode=idle filter', () => {
        const state = makeState(5, null, baseMs);
        const result = selectActiveKind(state, 'idle', 45, fixedNow);
        expect(result).toBeNull();
    });
});

describe('NeedsAttentionWidget render', () => {
    it('shows permission label when active', () => {
        const ctx = makeContext(makeState(2, null));
        expect(render(baseItem, ctx)).toBe('⚠ permission');
    });

    it('shows idle label when only idle is active', () => {
        const ctx = makeContext(makeState(null, 2));
        expect(render(baseItem, ctx)).toBe('◔ idle');
    });

    it('hides output by default when no attention is active', () => {
        const ctx = makeContext({ permission: null, idle: null });
        expect(render(baseItem, ctx)).toBeNull();
    });

    it('renders fallback label when hideWhenIdle is disabled and no attention', () => {
        const ctx = makeContext({ permission: null, idle: null });
        const item: WidgetItem = { ...baseItem, metadata: { hideWhenIdle: 'false' } };
        expect(render(item, ctx)).toBe('⚠ none');
    });

    it('renders empty raw output when hideWhenIdle is disabled with rawValue', () => {
        const ctx = makeContext({ permission: null, idle: null });
        const item: WidgetItem = {
            ...baseItem,
            rawValue: true,
            metadata: { hideWhenIdle: 'false' }
        };
        expect(render(item, ctx)).toBe('');
    });

    it('returns null when notificationState is missing', () => {
        const ctx = makeContext(null);
        expect(render(baseItem, ctx)).toBeNull();
    });

    it('honors custom permission label and truncates to <=20 visible chars', () => {
        const longLabel = 'A'.repeat(21);
        const item: WidgetItem = {
            ...baseItem,
            metadata: { labelPermission: longLabel }
        };
        const ctx = makeContext(makeState(2, null));
        const result = render(item, ctx);
        expect(result).not.toBeNull();
        expect(result?.length).toBe(20);
        expect(result?.endsWith('…')).toBe(true);
    });

    it('honors mode=permission by ignoring idle events', () => {
        const ctx = makeContext(makeState(null, 2));
        const item: WidgetItem = { ...baseItem, metadata: { mode: 'permission' } };
        expect(render(item, ctx)).toBeNull();
    });

    it('honors ttl boundary at exactly 45 seconds', () => {
        const ctx = makeContext(makeState(45, null));
        expect(render(baseItem, ctx)).toBe('⚠ permission');
    });

    it('drops permission once it has expired beyond ttl', () => {
        const ctx = makeContext(makeState(46, null));
        expect(render(baseItem, ctx)).toBeNull();
    });

    it('rawValue=true returns the same label text without prefix changes', () => {
        const ctx = makeContext(makeState(2, null));
        const item: WidgetItem = { ...baseItem, rawValue: true };
        expect(render(item, ctx)).toBe('⚠ permission');
    });
});

describe('NeedsAttentionWidget metadata', () => {
    it('exposes Notification hook with permission_prompt|idle_prompt matcher', () => {
        const widget = new NeedsAttentionWidget();
        expect(widget.getHooks()).toEqual([
            { event: 'Notification', matcher: 'permission_prompt|idle_prompt' }
        ]);
    });

    it('lists category Session and the documented keybinds', () => {
        const widget = new NeedsAttentionWidget();
        expect(widget.getCategory()).toBe('Session');
        expect(widget.getCustomKeybinds().map(k => k.key)).toEqual(['v', 't', 'e', 'h', 'p', 'i']);
    });

    it('cycles mode both -> permission -> idle -> both', () => {
        const widget = new NeedsAttentionWidget();
        const a = widget.handleEditorAction('cycle-mode', baseItem);
        const b = widget.handleEditorAction('cycle-mode', a ?? baseItem);
        const c = widget.handleEditorAction('cycle-mode', b ?? baseItem);
        expect(a?.metadata?.mode).toBe('permission');
        expect(b?.metadata?.mode).toBe('idle');
        expect(c?.metadata?.mode).toBe('both');
    });

    it('cycles ttl through 30/45/60/120/300', () => {
        const widget = new NeedsAttentionWidget();
        let item = baseItem;
        const cycle: string[] = [];
        for (let i = 0; i < 6; i++) {
            const next = widget.handleEditorAction('cycle-ttl', item);
            if (!next)
                break;
            cycle.push(next.metadata?.ttl ?? '');
            item = next;
        }
        expect(cycle).toEqual(['60', '120', '300', '30', '45', '60']);
    });

    it('toggle-hide-when-idle flips the explicit flag respecting the default true', () => {
        const widget = new NeedsAttentionWidget();
        const off = widget.handleEditorAction('toggle-hide-when-idle', baseItem);
        const on = widget.handleEditorAction('toggle-hide-when-idle', off ?? baseItem);
        expect(off?.metadata?.hideWhenIdle).toBe('false');
        expect(on?.metadata?.hideWhenIdle).toBe('true');
    });

    it('reports editor display with mode and ttl modifiers', () => {
        const widget = new NeedsAttentionWidget();
        const display = widget.getEditorDisplay({
            ...baseItem,
            metadata: { mode: 'permission', ttl: '60', showElapsed: 'true' }
        });
        expect(display.displayText).toBe('NeedsAttention');
        expect(display.modifierText).toBe('(permission, ttl=60s, elapsed)');
    });
});

describe('NeedsAttentionWidget preview', () => {
    it('shows a permission sample by default in preview', () => {
        const ctx = makeContext({ permission: null, idle: null }, true);
        expect(render(baseItem, ctx)).toBe('⚠ permission');
    });

    it('shows an idle sample with elapsed when configured', () => {
        const ctx = makeContext({ permission: null, idle: null }, true);
        const item: WidgetItem = {
            ...baseItem,
            metadata: { mode: 'idle', showElapsed: 'true' }
        };
        expect(render(item, ctx)).toBe('◔ idle (12s)');
    });
});

describe('truncateVisible', () => {
    it('preserves shorter strings', () => {
        expect(truncateVisible('short', 20)).toBe('short');
    });

    it('truncates with ellipsis at the boundary', () => {
        expect(truncateVisible('A'.repeat(25), 20)).toBe('A'.repeat(19) + '…');
    });
});
