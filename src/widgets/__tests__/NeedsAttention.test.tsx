import {
    describe,
    expect,
    it
} from 'vitest';

import { DEFAULT_SETTINGS } from '../../types/Settings';
import type { WidgetItem } from '../../types/Widget';
import type { NotificationLatest } from '../../utils/notification';
import {
    NeedsAttentionWidget,
    computeNeedsAttentionOutput,
    getEffectiveLabel,
    getMode,
    getTtl,
    isHideWhenIdle,
    isShowElapsed
} from '../NeedsAttention';

const FIXED_NOW = new Date('2026-04-26T12:00:00.000Z');

function buildItem(overrides: Partial<WidgetItem> = {}): WidgetItem {
    return {
        id: 'needs-attention',
        type: 'needs-attention',
        ...overrides
    };
}

function compute(item: WidgetItem, latest: NotificationLatest | null, now: Date = FIXED_NOW): string | null {
    return computeNeedsAttentionOutput(item, latest, now);
}

describe('NeedsAttentionWidget — identity', () => {
    const widget = new NeedsAttentionWidget();

    it('has stable widget metadata', () => {
        expect(widget.getDefaultColor()).toBe('yellow');
        expect(widget.getDisplayName()).toBe('Needs Attention');
        expect(widget.getCategory()).toBe('Session');
        expect(widget.supportsRawValue()).toBe(true);
        expect(widget.supportsColors(buildItem())).toBe(true);
    });

    it('registers a single Notification hook with the permission|idle matcher', () => {
        expect(widget.getHooks()).toEqual([
            { event: 'Notification', matcher: 'permission_prompt|idle_prompt' }
        ]);
    });
});

describe('NeedsAttentionWidget — metadata helpers', () => {
    it('defaults mode to both, ttl to 45, showElapsed off, hideWhenIdle on', () => {
        const item = buildItem();
        expect(getMode(item)).toBe('both');
        expect(getTtl(item)).toBe(45);
        expect(isShowElapsed(item)).toBe(false);
        expect(isHideWhenIdle(item)).toBe(true);
    });

    it('clamps ttl to 5..600 range and falls back on garbage', () => {
        expect(getTtl(buildItem({ metadata: { ttl: '0' } }))).toBe(5);
        expect(getTtl(buildItem({ metadata: { ttl: '999' } }))).toBe(600);
        expect(getTtl(buildItem({ metadata: { ttl: 'abc' } }))).toBe(45);
    });

    it('truncates user labels longer than 20 visible characters with an ellipsis', () => {
        const longLabel = 'a'.repeat(21);
        const item = buildItem({ metadata: { labelPermission: longLabel } });
        const rendered = getEffectiveLabel(item, 'permission');
        expect(Array.from(rendered).length).toBe(20);
        expect(rendered.endsWith('…')).toBe(true);
    });

    it('falls back to defaults when label metadata is empty or missing', () => {
        expect(getEffectiveLabel(buildItem(), 'permission')).toBe('⚠ permission');
        expect(getEffectiveLabel(buildItem(), 'idle')).toBe('◔ idle');
        expect(getEffectiveLabel(buildItem({ metadata: { labelPermission: '' } }), 'permission')).toBe('⚠ permission');
    });
});

describe('NeedsAttentionWidget — render', () => {
    it('returns null when there is no attention and hideWhenIdle is on', () => {
        expect(compute(buildItem(), { permission: null, idle: null })).toBeNull();
    });

    it('shows ⚠ none when hideWhenIdle is off and no attention is active (labeled mode)', () => {
        expect(compute(
            buildItem({ metadata: { hideWhenIdle: 'false' } }),
            { permission: null, idle: null }
        )).toBe('⚠ none');
    });

    it('returns empty string when hideWhenIdle is off, rawValue is on, and no attention is active', () => {
        expect(compute(
            buildItem({ rawValue: true, metadata: { hideWhenIdle: 'false' } }),
            { permission: null, idle: null }
        )).toBe('');
    });

    it('renders the permission label when permission is fresh', () => {
        expect(compute(buildItem(), {
            permission: new Date(FIXED_NOW.getTime() - 5_000),
            idle: null
        })).toBe('⚠ permission');
    });

    it('renders the idle label when idle is fresh', () => {
        expect(compute(buildItem(), {
            permission: null,
            idle: new Date(FIXED_NOW.getTime() - 5_000)
        })).toBe('◔ idle');
    });

    it('prioritises permission over idle when both are within TTL', () => {
        expect(compute(buildItem(), {
            permission: new Date(FIXED_NOW.getTime() - 10_000),
            idle: new Date(FIXED_NOW.getTime() - 1_000)
        })).toBe('⚠ permission');
    });

    it('falls back to idle once permission has expired but idle is still fresh', () => {
        expect(compute(buildItem(), {
            permission: new Date(FIXED_NOW.getTime() - 60_000),
            idle: new Date(FIXED_NOW.getTime() - 10_000)
        })).toBe('◔ idle');
    });

    it('respects mode=permission by ignoring idle entries', () => {
        expect(compute(
            buildItem({ metadata: { mode: 'permission' } }),
            {
                permission: null,
                idle: new Date(FIXED_NOW.getTime() - 5_000)
            }
        )).toBeNull();
    });

    it('respects mode=idle by ignoring permission entries', () => {
        expect(compute(
            buildItem({ metadata: { mode: 'idle', hideWhenIdle: 'false' } }),
            {
                permission: new Date(FIXED_NOW.getTime() - 5_000),
                idle: null
            }
        )).toBe('⚠ none');
    });

    it('renders at the TTL boundary: 44s and 45s show, 46s hides', () => {
        const at = (offsetMs: number): NotificationLatest => ({
            permission: new Date(FIXED_NOW.getTime() - offsetMs),
            idle: null
        });

        expect(compute(buildItem(), at(44_000))).toBe('⚠ permission');
        expect(compute(buildItem(), at(45_000))).toBe('⚠ permission');
        expect(compute(buildItem(), at(46_000))).toBeNull();
    });

    it('treats a null notificationLatest like no attention (silent drop)', () => {
        expect(compute(buildItem(), null)).toBeNull();
    });

    it('renders via the Widget interface using context.notificationLatest', () => {
        const widget = new NeedsAttentionWidget();
        const context = {
            notificationLatest: {
                permission: new Date(Date.now() - 5_000),
                idle: null
            }
        };
        expect(widget.render(buildItem(), context, DEFAULT_SETTINGS)).toBe('⚠ permission');
    });

    it('appends elapsed time when showElapsed is on', () => {
        expect(compute(
            buildItem({ metadata: { showElapsed: 'true' } }),
            {
                permission: new Date(FIXED_NOW.getTime() - 12_000),
                idle: null
            }
        )).toBe('⚠ permission (12s)');
    });

    it('clamps elapsed at 1s minimum (events < 1s old still show as 1s)', () => {
        expect(compute(
            buildItem({ metadata: { showElapsed: 'true' } }),
            {
                permission: new Date(FIXED_NOW.getTime() - 100),
                idle: null
            }
        )).toBe('⚠ permission (1s)');
    });

    it('produces the same body for raw and labeled modes when an attention is active', () => {
        const latest: NotificationLatest = {
            permission: new Date(FIXED_NOW.getTime() - 5_000),
            idle: null
        };
        expect(compute(buildItem({ rawValue: true }), latest))
            .toBe(compute(buildItem(), latest));
    });
});

describe('NeedsAttentionWidget — preview', () => {
    it('shows a permission sample in both/permission modes', () => {
        const widget = new NeedsAttentionWidget();
        const item = buildItem();
        expect(widget.render(item, { isPreview: true }, DEFAULT_SETTINGS)).toBe('⚠ permission');
    });

    it('shows an idle sample with elapsed when configured', () => {
        const widget = new NeedsAttentionWidget();
        const item = buildItem({ metadata: { mode: 'idle', showElapsed: 'true' } });
        const result = widget.render(item, { isPreview: true }, DEFAULT_SETTINGS);
        expect(result).toBe('◔ idle (12s)');
    });
});

describe('NeedsAttentionWidget — editor actions', () => {
    const widget = new NeedsAttentionWidget();

    it('cycles mode both -> permission -> idle -> both', () => {
        let item = buildItem();
        item = widget.handleEditorAction('cycle-mode', item) ?? item;
        expect(item.metadata?.mode).toBe('permission');
        item = widget.handleEditorAction('cycle-mode', item) ?? item;
        expect(item.metadata?.mode).toBe('idle');
        item = widget.handleEditorAction('cycle-mode', item) ?? item;
        expect(item.metadata?.mode).toBe('both');
    });

    it('cycles ttl through 30/45/60/120/300', () => {
        let item = buildItem({ metadata: { ttl: '30' } });
        item = widget.handleEditorAction('cycle-ttl', item) ?? item;
        expect(item.metadata?.ttl).toBe('45');
        item = widget.handleEditorAction('cycle-ttl', item) ?? item;
        expect(item.metadata?.ttl).toBe('60');
        item = widget.handleEditorAction('cycle-ttl', item) ?? item;
        expect(item.metadata?.ttl).toBe('120');
        item = widget.handleEditorAction('cycle-ttl', item) ?? item;
        expect(item.metadata?.ttl).toBe('300');
        item = widget.handleEditorAction('cycle-ttl', item) ?? item;
        expect(item.metadata?.ttl).toBe('30');
    });

    it('toggles showElapsed and hideWhenIdle metadata', () => {
        const widget = new NeedsAttentionWidget();
        const elapsedOn = widget.handleEditorAction('toggle-elapsed', buildItem());
        expect(elapsedOn?.metadata?.showElapsed).toBe('true');

        const hideOff = widget.handleEditorAction('toggle-hide-when-idle', buildItem());
        expect(hideOff?.metadata?.hideWhenIdle).toBe('false');
        const hideOn = widget.handleEditorAction('toggle-hide-when-idle', hideOff ?? buildItem());
        expect(hideOn?.metadata?.hideWhenIdle).toBe('true');
    });

    it('reflects modifiers in the editor display text', () => {
        const widget = new NeedsAttentionWidget();
        const display = widget.getEditorDisplay(buildItem(
            { metadata: { mode: 'permission', ttl: '60', showElapsed: 'true' } }
        ));
        expect(display.displayText).toBe('Needs Attention');
        expect(display.modifierText).toBe('(permission, ttl=60s, elapsed)');
    });
});
