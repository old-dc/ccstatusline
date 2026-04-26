import {
    describe,
    expect,
    it
} from 'vitest';

import type { RenderContext } from '../../types/RenderContext';
import { DEFAULT_SETTINGS } from '../../types/Settings';
import type { WidgetItem } from '../../types/Widget';
import type { NotificationEntry } from '../../utils/notification';
import {
    DEFAULT_TTL_SEC,
    NeedsAttentionWidget,
    formatNotificationElapsed,
    truncateLabel
} from '../NeedsAttention';

function makeContext(entries: NotificationEntry[], isPreview = false): RenderContext {
    return {
        notificationEntries: entries,
        isPreview
    };
}

const NOW = Date.now();
const at = (offsetSec: number): Date => new Date(NOW + offsetSec * 1000);

describe('NeedsAttentionWidget — identity', () => {
    const widget = new NeedsAttentionWidget();

    it('exposes stable widget metadata', () => {
        expect(widget.getDefaultColor()).toBe('yellow');
        expect(widget.getDisplayName()).toBe('Needs Attention');
        expect(widget.getCategory()).toBe('Session');
        expect(widget.supportsRawValue()).toBe(true);
        expect(widget.supportsColors({ id: 'n', type: 'needs-attention' })).toBe(true);
    });

    it('registers a single Notification hook with permission_prompt|idle_prompt matcher', () => {
        expect(widget.getHooks()).toEqual([
            { event: 'Notification', matcher: 'permission_prompt|idle_prompt' }
        ]);
    });
});

describe('truncateLabel', () => {
    it('returns input unchanged when within visible-char budget', () => {
        expect(truncateLabel('⚠ permission')).toBe('⚠ permission');
    });

    it('returns input unchanged at exactly the limit', () => {
        const exact = 'x'.repeat(20);
        expect(truncateLabel(exact)).toBe(exact);
    });

    it('truncates with ellipsis when over the limit (default 20)', () => {
        const longLabel = 'x'.repeat(21);
        const out = truncateLabel(longLabel);
        expect(out).toHaveLength(20);
        expect(out.endsWith('…')).toBe(true);
        expect(out.slice(0, 19)).toBe('x'.repeat(19));
    });
});

describe('formatNotificationElapsed', () => {
    it('returns "1s" for sub-second deltas (PRD AC-12 lower bound)', () => {
        expect(formatNotificationElapsed(new Date(0), new Date(500))).toBe('1s');
    });

    it('returns whole-second value for normal deltas', () => {
        expect(formatNotificationElapsed(new Date(0), new Date(12_000))).toBe('12s');
    });

    it('delegates to AgentActivity formatter for long deltas', () => {
        // Format follows AgentActivity.formatElapsed → "Nm Ss" beyond 60s.
        expect(formatNotificationElapsed(new Date(0), new Date((60 + 12) * 1000))).toBe('1m 12s');
    });
});

describe('NeedsAttentionWidget.render — visibility', () => {
    const widget = new NeedsAttentionWidget();
    const baseItem: WidgetItem = { id: 'n', type: 'needs-attention' };

    it('renders the permission label when permission is in TTL', () => {
        const ctx = makeContext([{ type: 'permission', timestamp: at(-5) }]);
        expect(widget.render(baseItem, ctx, DEFAULT_SETTINGS)).toBe('⚠ permission');
    });

    it('renders the idle label when only idle is in TTL', () => {
        const ctx = makeContext([{ type: 'idle', timestamp: at(-5) }]);
        expect(widget.render(baseItem, ctx, DEFAULT_SETTINGS)).toBe('◔ idle');
    });

    it('shows permission over idle when both are in TTL', () => {
        const ctx = makeContext([
            { type: 'idle', timestamp: at(-2) },
            { type: 'permission', timestamp: at(-10) }
        ]);
        expect(widget.render(baseItem, ctx, DEFAULT_SETTINGS)).toBe('⚠ permission');
    });

    it('falls back to idle when permission is past TTL but idle is in TTL', () => {
        const ctx = makeContext([
            { type: 'permission', timestamp: at(-DEFAULT_TTL_SEC - 5) },
            { type: 'idle', timestamp: at(-5) }
        ]);
        expect(widget.render(baseItem, ctx, DEFAULT_SETTINGS)).toBe('◔ idle');
    });

    it('returns null when nothing is active and hideWhenIdle defaults to true', () => {
        expect(widget.render(baseItem, makeContext([]), DEFAULT_SETTINGS)).toBeNull();
    });

    it('returns "⚠ none" when hideWhenIdle=false and rawValue=false', () => {
        const item: WidgetItem = { ...baseItem, metadata: { hideWhenIdle: 'false' } };
        expect(widget.render(item, makeContext([]), DEFAULT_SETTINGS)).toBe('⚠ none');
    });

    it('returns "" when hideWhenIdle=false and rawValue=true', () => {
        const item: WidgetItem = { ...baseItem, rawValue: true, metadata: { hideWhenIdle: 'false' } };
        expect(widget.render(item, makeContext([]), DEFAULT_SETTINGS)).toBe('');
    });
});

describe('NeedsAttentionWidget.render — mode filtering', () => {
    const widget = new NeedsAttentionWidget();

    it('mode=permission ignores idle events', () => {
        const item: WidgetItem = { id: 'n', type: 'needs-attention', metadata: { mode: 'permission' } };
        const ctx = makeContext([{ type: 'idle', timestamp: at(-5) }]);
        expect(widget.render(item, ctx, DEFAULT_SETTINGS)).toBeNull();
    });

    it('mode=idle ignores permission events', () => {
        const item: WidgetItem = { id: 'n', type: 'needs-attention', metadata: { mode: 'idle' } };
        const ctx = makeContext([{ type: 'permission', timestamp: at(-5) }]);
        expect(widget.render(item, ctx, DEFAULT_SETTINGS)).toBeNull();
    });
});

describe('NeedsAttentionWidget.render — TTL boundaries', () => {
    const widget = new NeedsAttentionWidget();
    const item: WidgetItem = { id: 'n', type: 'needs-attention' };

    it('renders at 44s with default ttl=45', () => {
        const ctx = makeContext([{ type: 'permission', timestamp: at(-44) }]);
        expect(widget.render(item, ctx, DEFAULT_SETTINGS)).toBe('⚠ permission');
    });

    it('drops at 45s with default ttl=45 (boundary excluded)', () => {
        const ctx = makeContext([{ type: 'permission', timestamp: at(-45) }]);
        expect(widget.render(item, ctx, DEFAULT_SETTINGS)).toBeNull();
    });

    it('drops at 46s with default ttl=45', () => {
        const ctx = makeContext([{ type: 'permission', timestamp: at(-46) }]);
        expect(widget.render(item, ctx, DEFAULT_SETTINGS)).toBeNull();
    });
});

describe('NeedsAttentionWidget.render — showElapsed', () => {
    const widget = new NeedsAttentionWidget();

    it('appends (Ns) when showElapsed=true', () => {
        const item: WidgetItem = {
            id: 'n',
            type: 'needs-attention',
            metadata: { showElapsed: 'true' }
        };
        const ctx = makeContext([{ type: 'permission', timestamp: at(-12) }]);
        const out = widget.render(item, ctx, DEFAULT_SETTINGS);
        expect(out).toMatch(/^⚠ permission \(1[12]s\)$/);
    });

    it('omits the (Ns) suffix when showElapsed=false (default)', () => {
        const item: WidgetItem = { id: 'n', type: 'needs-attention' };
        const ctx = makeContext([{ type: 'permission', timestamp: at(-12) }]);
        expect(widget.render(item, ctx, DEFAULT_SETTINGS)).toBe('⚠ permission');
    });
});

describe('NeedsAttentionWidget.render — custom labels', () => {
    const widget = new NeedsAttentionWidget();

    it('renders custom permission/idle labels when set in metadata', () => {
        const item: WidgetItem = {
            id: 'n',
            type: 'needs-attention',
            metadata: { labelPermission: '!perm!', labelIdle: '~idle~' }
        };
        const permCtx = makeContext([{ type: 'permission', timestamp: at(-1) }]);
        expect(widget.render(item, permCtx, DEFAULT_SETTINGS)).toBe('!perm!');
        const idleCtx = makeContext([{ type: 'idle', timestamp: at(-1) }]);
        expect(widget.render({ ...item, metadata: { ...item.metadata, mode: 'idle' } }, idleCtx, DEFAULT_SETTINGS)).toBe('~idle~');
    });

    it('truncates custom labels longer than 20 visible chars', () => {
        const tooLong = 'x'.repeat(21);
        const item: WidgetItem = {
            id: 'n',
            type: 'needs-attention',
            metadata: { labelPermission: tooLong }
        };
        const ctx = makeContext([{ type: 'permission', timestamp: at(-1) }]);
        const out = widget.render(item, ctx, DEFAULT_SETTINGS);
        expect(out).toHaveLength(20);
        expect(out?.endsWith('…')).toBe(true);
    });
});

describe('NeedsAttentionWidget.render — preview', () => {
    const widget = new NeedsAttentionWidget();

    it('preview defaults to ⚠ permission', () => {
        const out = widget.render(
            { id: 'n', type: 'needs-attention' },
            makeContext([], true),
            DEFAULT_SETTINGS
        );
        expect(out).toBe('⚠ permission');
    });

    it('preview reflects mode=idle', () => {
        const out = widget.render(
            { id: 'n', type: 'needs-attention', metadata: { mode: 'idle' } },
            makeContext([], true),
            DEFAULT_SETTINGS
        );
        expect(out).toBe('◔ idle');
    });

    it('preview includes elapsed (sample 12s) when showElapsed=true', () => {
        const out = widget.render(
            { id: 'n', type: 'needs-attention', metadata: { showElapsed: 'true' } },
            makeContext([], true),
            DEFAULT_SETTINGS
        );
        expect(out).toMatch(/^⚠ permission \(\d+s\)$/);
    });
});

describe('NeedsAttentionWidget.handleEditorAction', () => {
    const widget = new NeedsAttentionWidget();
    const base: WidgetItem = { id: 'n', type: 'needs-attention' };

    it('cycle-mode progresses both → permission → idle → both', () => {
        const a = widget.handleEditorAction('cycle-mode', base);
        expect(a?.metadata?.mode).toBe('permission');
        const b = widget.handleEditorAction('cycle-mode', a ?? base);
        expect(b?.metadata?.mode).toBe('idle');
        const c = widget.handleEditorAction('cycle-mode', b ?? base);
        expect(c?.metadata?.mode).toBe('both');
    });

    it('cycle-ttl progresses 45 → 60 → 120 → 300 → 30 → 45', () => {
        const start = widget.handleEditorAction('cycle-ttl', base);
        expect(start?.metadata?.ttl).toBe('60');
        const a = widget.handleEditorAction('cycle-ttl', start ?? base);
        expect(a?.metadata?.ttl).toBe('120');
        const b = widget.handleEditorAction('cycle-ttl', a ?? base);
        expect(b?.metadata?.ttl).toBe('300');
        const c = widget.handleEditorAction('cycle-ttl', b ?? base);
        expect(c?.metadata?.ttl).toBe('30');
        const d = widget.handleEditorAction('cycle-ttl', c ?? base);
        expect(d?.metadata?.ttl).toBe('45');
    });

    it('toggle-elapsed flips showElapsed metadata', () => {
        const a = widget.handleEditorAction('toggle-elapsed', base);
        expect(a?.metadata?.showElapsed).toBe('true');
        const b = widget.handleEditorAction('toggle-elapsed', a ?? base);
        expect(b?.metadata?.showElapsed).toBe('false');
    });

    it('toggle-hide-idle flips hideWhenIdle from default-true to false', () => {
        const a = widget.handleEditorAction('toggle-hide-idle', base);
        expect(a?.metadata?.hideWhenIdle).toBe('false');
        const b = widget.handleEditorAction('toggle-hide-idle', a ?? base);
        expect(b?.metadata?.hideWhenIdle).toBe('true');
    });

    it('returns null for unknown actions', () => {
        expect(widget.handleEditorAction('does-not-exist', base)).toBeNull();
    });

    it('returns null for label-edit actions (handled via renderEditor)', () => {
        expect(widget.handleEditorAction('edit-label-permission', base)).toBeNull();
        expect(widget.handleEditorAction('edit-label-idle', base)).toBeNull();
    });
});

describe('NeedsAttentionWidget.getCustomKeybinds', () => {
    const widget = new NeedsAttentionWidget();

    it('uses non-reserved keys (avoids ItemsEditor a/i/d/k/c/r/m/space)', () => {
        const RESERVED = new Set(['a', 'i', 'd', 'k', 'c', 'r', 'm', ' ']);
        for (const kb of widget.getCustomKeybinds()) {
            expect(RESERVED.has(kb.key)).toBe(false);
        }
    });

    it('exposes v/t/e/h/p/l (l replaces PRD-suggested i which conflicts with insert)', () => {
        const keys = widget.getCustomKeybinds().map(k => k.key);
        expect(keys).toEqual(['v', 't', 'e', 'h', 'p', 'l']);
    });
});

describe('NeedsAttentionWidget.getEditorDisplay', () => {
    const widget = new NeedsAttentionWidget();

    it('shows mode and default ttl', () => {
        const display = widget.getEditorDisplay({ id: 'n', type: 'needs-attention' });
        expect(display.displayText).toBe('Needs Attention');
        expect(display.modifierText).toBe('(both, ttl=45s)');
    });

    it('reflects custom mode and ttl', () => {
        const display = widget.getEditorDisplay({
            id: 'n',
            type: 'needs-attention',
            metadata: { mode: 'permission', ttl: '60' }
        });
        expect(display.modifierText).toBe('(permission, ttl=60s)');
    });

    it('marks elapsed and show-idle when toggled', () => {
        const display = widget.getEditorDisplay({
            id: 'n',
            type: 'needs-attention',
            metadata: { showElapsed: 'true', hideWhenIdle: 'false' }
        });
        expect(display.modifierText).toBe('(both, ttl=45s, elapsed, show idle)');
    });
});

describe('NeedsAttentionWidget — defensive parsing', () => {
    const widget = new NeedsAttentionWidget();
    const item: WidgetItem = { id: 'n', type: 'needs-attention' };

    it('falls back to default ttl when metadata.ttl is invalid', () => {
        const out1 = widget.render(
            { ...item, metadata: { ttl: 'abc' } },
            makeContext([{ type: 'permission', timestamp: at(-44) }]),
            DEFAULT_SETTINGS
        );
        expect(out1).toBe('⚠ permission');

        // negative TTL → clamp to default 45 → -44 stays in window
        const out2 = widget.render(
            { ...item, metadata: { ttl: '-5' } },
            makeContext([{ type: 'permission', timestamp: at(-44) }]),
            DEFAULT_SETTINGS
        );
        expect(out2).toBe('⚠ permission');
    });

    it('treats unknown mode metadata as "both"', () => {
        const ctx = makeContext([{ type: 'permission', timestamp: at(-1) }]);
        const out = widget.render(
            { ...item, metadata: { mode: 'bogus' } },
            ctx,
            DEFAULT_SETTINGS
        );
        expect(out).toBe('⚠ permission');
    });
});
