import {
    describe,
    expect,
    it
} from 'vitest';

import type { RenderContext } from '../../types/RenderContext';
import { DEFAULT_SETTINGS } from '../../types/Settings';
import type { WidgetItem } from '../../types/Widget';
import type { NotificationEvent } from '../../utils/notification';
import {
    NeedsAttentionWidget,
    formatAttentionElapsed,
    truncateLabel
} from '../NeedsAttention';

function render(item: WidgetItem, context: RenderContext): string | null {
    return new NeedsAttentionWidget().render(item, context, DEFAULT_SETTINGS);
}

function event(type: 'permission' | 'idle', secondsAgo: number, now: Date): NotificationEvent {
    return { type, timestamp: new Date(now.getTime() - secondsAgo * 1000) };
}

describe('NeedsAttentionWidget — identity', () => {
    const widget = new NeedsAttentionWidget();

    it('has stable widget metadata', () => {
        expect(widget.getDefaultColor()).toBe('yellow');
        expect(widget.getDisplayName()).toBe('Needs Attention');
        expect(widget.getCategory()).toBe('Session');
        expect(widget.supportsRawValue()).toBe(true);
        expect(widget.supportsColors({ id: 'na', type: 'needs-attention' })).toBe(true);
    });

    it('registers Notification hook with permission_prompt|idle_prompt matcher', () => {
        expect(widget.getHooks()).toEqual([
            { event: 'Notification', matcher: 'permission_prompt|idle_prompt' }
        ]);
    });
});

describe('truncateLabel', () => {
    it('passes through labels at or below the cap', () => {
        expect(truncateLabel('hello', 10)).toBe('hello');
        expect(truncateLabel('1234567890', 10)).toBe('1234567890');
    });

    it('truncates with an ellipsis sized to the cap', () => {
        expect(truncateLabel('1234567890abcd', 10)).toBe('123456789…');
    });

    it('counts code points, not utf-16 units', () => {
        expect(truncateLabel('⚠ permission alert', 12)).toBe('⚠ permissio…');
    });
});

describe('formatAttentionElapsed', () => {
    const ttl = 45;

    it('clamps elapsed to >= 1s when computed elapsed is sub-second', () => {
        const now = new Date(500);
        const ts = new Date(0);
        expect(formatAttentionElapsed(ts, ttl, now)).toBe('1s');
    });

    it('reports seconds within the TTL window', () => {
        const now = new Date(12_000);
        const ts = new Date(0);
        expect(formatAttentionElapsed(ts, ttl, now)).toBe('12s');
    });

    it('caps elapsed display to TTL when computed elapsed exceeds it', () => {
        const now = new Date(120_000);
        const ts = new Date(0);
        expect(formatAttentionElapsed(ts, ttl, now)).toBe('45s');
    });
});

describe('NeedsAttentionWidget — render', () => {
    const baseItem: WidgetItem = { id: 'na', type: 'needs-attention' };

    it('renders the default permission label when a permission_prompt is in TTL', () => {
        const events = [event('permission', 10, new Date())];
        const context: RenderContext = { notificationEvents: events };
        const result = render({ ...baseItem, metadata: { ttl: '120' } }, context);
        expect(result).toBe('⚠ permission');
    });

    it('renders the default idle label when only an idle_prompt is in TTL', () => {
        const events = [event('idle', 10, new Date())];
        const context: RenderContext = { notificationEvents: events };
        expect(render({ ...baseItem, metadata: { ttl: '120' } }, context)).toBe('◔ idle');
    });

    it('prefers permission over idle when both are within TTL', () => {
        const realNow = new Date();
        const events = [
            event('idle', 5, realNow),
            event('permission', 30, realNow)
        ];
        const context: RenderContext = { notificationEvents: events };
        expect(render({ ...baseItem, metadata: { ttl: '120' } }, context)).toBe('⚠ permission');
    });

    it('falls back to idle once permission has aged out of TTL', () => {
        // Anchor to real now so the TTL filter inside render() agrees with our
        // age values; using a fixed NOW would put timestamps in the future or
        // unboundedly far in the past depending on when the test runs.
        const realNow = new Date();
        const events = [
            event('permission', 90, realNow),
            event('idle', 10, realNow)
        ];
        const context: RenderContext = { notificationEvents: events };
        expect(render({ ...baseItem, metadata: { ttl: '60' } }, context)).toBe('◔ idle');
    });

    it('TTL boundary at 45s: 44 renders, 45 renders, 46 does not (and hides by default)', () => {
        const item: WidgetItem = { ...baseItem, metadata: { ttl: '45' } };
        const realNow = new Date();
        const recentlyWithin: RenderContext = { notificationEvents: [event('permission', 44, realNow)] };
        const recentlyOnEdge: RenderContext = { notificationEvents: [event('permission', 45, realNow)] };
        const recentlyOutside: RenderContext = { notificationEvents: [event('permission', 46, realNow)] };

        expect(render(item, recentlyWithin)).toBe('⚠ permission');
        expect(render(item, recentlyOnEdge)).toBe('⚠ permission');
        // hideWhenIdle=true (default) so an out-of-TTL state hides the widget entirely.
        expect(render(item, recentlyOutside)).toBeNull();
    });

    it('mode=permission ignores idle_prompt events even when they are in TTL', () => {
        const events = [event('idle', 10, new Date())];
        const context: RenderContext = { notificationEvents: events };
        expect(render({
            ...baseItem,
            metadata: { mode: 'permission', ttl: '120', hideWhenIdle: 'false' }
        }, context)).toBe('⚠ none');
    });

    it('mode=idle ignores permission_prompt events even when they are in TTL', () => {
        const events = [event('permission', 10, new Date())];
        const context: RenderContext = { notificationEvents: events };
        expect(render({
            ...baseItem,
            metadata: { mode: 'idle', ttl: '120', hideWhenIdle: 'false' }
        }, context)).toBe('⚠ none');
    });

    it('hides entirely when no attention is active and hideWhenIdle is on (default)', () => {
        const context: RenderContext = { notificationEvents: [] };
        expect(render(baseItem, context)).toBeNull();
    });

    it('shows ⚠ none when no attention is active and hideWhenIdle=false', () => {
        const context: RenderContext = { notificationEvents: [] };
        expect(render({
            ...baseItem,
            metadata: { hideWhenIdle: 'false' }
        }, context)).toBe('⚠ none');
    });

    it('rawValue and non-rawValue produce the same active label', () => {
        const events = [event('permission', 10, new Date())];
        const context: RenderContext = { notificationEvents: events };
        const active: WidgetItem = { ...baseItem, metadata: { ttl: '120' } };
        expect(render(active, context)).toBe('⚠ permission');
        expect(render({ ...active, rawValue: true }, context)).toBe('⚠ permission');
    });

    it('rawValue=true outputs empty string when idle and hideWhenIdle=false', () => {
        const context: RenderContext = { notificationEvents: [] };
        expect(render({
            ...baseItem,
            rawValue: true,
            metadata: { hideWhenIdle: 'false' }
        }, context)).toBe('');
    });

    it('uses a custom permission label when metadata.labelPermission is set', () => {
        const events = [event('permission', 5, new Date())];
        const context: RenderContext = { notificationEvents: events };
        expect(render({
            ...baseItem,
            metadata: { ttl: '120', labelPermission: '🚨 ACT' }
        }, context)).toBe('🚨 ACT');
    });

    it('truncates user-supplied labels longer than 20 visible chars', () => {
        const events = [event('permission', 5, new Date())];
        const context: RenderContext = { notificationEvents: events };
        // 25-character label should truncate to 19 chars + ellipsis.
        const label = '01234567890123456789ABCDE';
        const result = render({
            ...baseItem,
            metadata: { ttl: '120', labelPermission: label }
        }, context);
        expect(result).toBe('0123456789012345678…');
    });

    it('appends an elapsed suffix when showElapsed is enabled', () => {
        const events = [event('permission', 12, new Date())];
        const context: RenderContext = { notificationEvents: events };
        const result = render({
            ...baseItem,
            metadata: { ttl: '120', showElapsed: 'true' }
        }, context);
        // Elapsed is approximately 12s; allow off-by-one for clock drift in tests.
        expect(result === '⚠ permission (12s)' || result === '⚠ permission (11s)' || result === '⚠ permission (13s)').toBe(true);
    });

    it('cycles modes via handleEditorAction: both -> permission -> idle -> both', () => {
        const widget = new NeedsAttentionWidget();
        const start: WidgetItem = { ...baseItem };
        const a = widget.handleEditorAction('cycle-mode', start);
        const b = widget.handleEditorAction('cycle-mode', a ?? start);
        const c = widget.handleEditorAction('cycle-mode', b ?? start);
        expect(a?.metadata?.mode).toBe('permission');
        expect(b?.metadata?.mode).toBe('idle');
        expect(c?.metadata?.mode).toBe('both');
    });

    it('cycles TTL through 30/45/60/120/300 starting from the default 45', () => {
        const widget = new NeedsAttentionWidget();
        let item: WidgetItem = { ...baseItem };
        const seen: string[] = [];
        for (let i = 0; i < 6; i++) {
            const next = widget.handleEditorAction('cycle-ttl', item);
            if (!next)
                break;
            seen.push(next.metadata?.ttl ?? '');
            item = next;
        }
        // Default ttl is 45, so the first press advances to 60 and wraps from there.
        expect(seen).toEqual(['60', '120', '300', '30', '45', '60']);
    });

    it('toggles showElapsed and hideWhenIdle independently', () => {
        const widget = new NeedsAttentionWidget();
        const start: WidgetItem = { ...baseItem };
        const a = widget.handleEditorAction('toggle-show-elapsed', start);
        expect(a?.metadata?.showElapsed).toBe('true');

        const b = widget.handleEditorAction('toggle-hide-when-idle', start);
        expect(b?.metadata?.hideWhenIdle).toBe('false');
        const c = widget.handleEditorAction('toggle-hide-when-idle', b ?? start);
        expect(c?.metadata?.hideWhenIdle).toBe('true');
    });

    it('exposes ttl/mode/elapsed in the editor display modifier text', () => {
        const widget = new NeedsAttentionWidget();
        const display = widget.getEditorDisplay({
            ...baseItem,
            metadata: { mode: 'permission', ttl: '60', showElapsed: 'true' }
        });
        expect(display.displayText).toBe('Needs Attention');
        expect(display.modifierText).toBe('(permission, ttl=60s, elapsed)');
    });

    it('renders preview output deterministically for permission mode', () => {
        const widget = new NeedsAttentionWidget();
        const result = widget.render(
            { ...baseItem, metadata: { ttl: '60' } },
            { isPreview: true },
            DEFAULT_SETTINGS
        );
        expect(result).toBe('⚠ permission');
    });

    it('renders preview with elapsed when showElapsed is on', () => {
        const widget = new NeedsAttentionWidget();
        const result = widget.render(
            { ...baseItem, metadata: { ttl: '60', showElapsed: 'true' } },
            { isPreview: true },
            DEFAULT_SETTINGS
        );
        expect(result).toBe('⚠ permission (12s)');
    });
});
