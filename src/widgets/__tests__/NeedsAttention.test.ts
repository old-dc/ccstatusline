import {
    describe,
    expect,
    it
} from 'vitest';

import type { NotificationEntry } from '../../types/NotificationState';
import type { RenderContext } from '../../types/RenderContext';
import { DEFAULT_SETTINGS } from '../../types/Settings';
import type { WidgetItem } from '../../types/Widget';
import {
    NeedsAttentionWidget,
    formatElapsedSeconds
} from '../NeedsAttention';

const widget = new NeedsAttentionWidget();

function isoMinusSeconds(now: Date, seconds: number): string {
    return new Date(now.getTime() - seconds * 1000).toISOString();
}

function ctx(entries: NotificationEntry[]): RenderContext {
    return {
        notificationEntries: entries,
        isPreview: false
    };
}

function previewCtx(): RenderContext {
    return { isPreview: true };
}

function makeItem(metadata?: Record<string, string>, rawValue = false): WidgetItem {
    const item: WidgetItem = { id: 'na', type: 'needs-attention' };
    if (metadata)
        item.metadata = metadata;
    if (rawValue)
        item.rawValue = true;
    return item;
}

function render(item: WidgetItem, context: RenderContext): string | null {
    return widget.render(item, context, DEFAULT_SETTINGS);
}

describe('NeedsAttentionWidget — metadata and editor', () => {
    it('declares Notification hook with combined matcher', () => {
        expect(widget.getHooks()).toEqual([
            { event: 'Notification', matcher: 'permission_prompt|idle_prompt' }
        ]);
    });

    it('lists Session category and yellow default color', () => {
        expect(widget.getCategory()).toBe('Session');
        expect(widget.getDefaultColor()).toBe('yellow');
    });

    it('cycles mode both → permission → idle → both', () => {
        const base = makeItem();
        const next1 = widget.handleEditorAction('cycle-mode', base) ?? base;
        const next2 = widget.handleEditorAction('cycle-mode', next1) ?? next1;
        const next3 = widget.handleEditorAction('cycle-mode', next2) ?? next2;
        expect(next1.metadata?.mode).toBe('permission');
        expect(next2.metadata?.mode).toBe('idle');
        expect(next3.metadata?.mode).toBe('both');
    });

    it('cycles ttl 45 → 60 → 120 → 300 → 30 → 45', () => {
        let item = makeItem();
        const seen: string[] = [];
        for (let i = 0; i < 5; i++) {
            const next = widget.handleEditorAction('cycle-ttl', item);
            seen.push(next?.metadata?.ttl ?? '');
            item = next ?? item;
        }
        expect(seen).toEqual(['60', '120', '300', '30', '45']);
    });

    it('toggles showElapsed and hideWhenIdle independently', () => {
        const base = makeItem();
        const elapsedOn = widget.handleEditorAction('toggle-show-elapsed', base) ?? base;
        expect(elapsedOn.metadata?.showElapsed).toBe('true');
        const elapsedOff = widget.handleEditorAction('toggle-show-elapsed', elapsedOn) ?? elapsedOn;
        expect(elapsedOff.metadata?.showElapsed).toBe('false');

        const hideOff = widget.handleEditorAction('toggle-hide-when-idle', base) ?? base;
        expect(hideOff.metadata?.hideWhenIdle).toBe('false');
        const hideOn = widget.handleEditorAction('toggle-hide-when-idle', hideOff) ?? hideOff;
        expect(hideOn.metadata?.hideWhenIdle).toBe('true');
    });

    it('keybinds avoid the i key (reserved for ItemsEditor insert)', () => {
        const keys = widget.getCustomKeybinds().map(k => k.key);
        expect(keys).not.toContain('i');
        expect(keys).toEqual(expect.arrayContaining(['v', 't', 'e', 'h', 'p', 'l']));
    });

    it('describes mode/ttl modifiers in the editor display', () => {
        const display = widget.getEditorDisplay(makeItem({ mode: 'idle', ttl: '60', showElapsed: 'true' }));
        expect(display.displayText).toBe('Needs Attention');
        expect(display.modifierText).toBe('(idle, ttl=60s, elapsed)');
    });

    it('flags non-default labels and disabled hideWhenIdle in the editor display', () => {
        const display = widget.getEditorDisplay(makeItem({
            labelPermission: '⚠ approve',
            hideWhenIdle: 'false'
        }));
        expect(display.modifierText).toContain('show idle frame');
        expect(display.modifierText).toContain('custom perm');
    });
});

describe('NeedsAttentionWidget — render', () => {
    it('AC-4: hideWhenIdle (default) returns null when no active notification', () => {
        expect(render(makeItem(), ctx([]))).toBeNull();
    });

    it('AC-4: hideWhenIdle returns null with rawValue=true too', () => {
        expect(render(makeItem(undefined, true), ctx([]))).toBeNull();
    });

    it('hideWhenIdle=false renders ⚠ none when no attention', () => {
        const out = render(makeItem({ hideWhenIdle: 'false' }), ctx([]));
        expect(out).toBe('⚠ none');
    });

    it('hideWhenIdle=false rawValue=true renders empty string when no attention', () => {
        const out = render(makeItem({ hideWhenIdle: 'false' }, true), ctx([]));
        expect(out).toBe('');
    });

    it('AC-1: permission_prompt within TTL renders ⚠ permission', () => {
        const now = new Date();
        const entries: NotificationEntry[] = [{
            timestamp: isoMinusSeconds(now, 5),
            session_id: 'sess-1',
            notification_type: 'permission_prompt'
        }];
        const out = render(makeItem(), ctx(entries));
        expect(out).toBe('⚠ permission');
    });

    it('AC-2: idle_prompt within TTL renders ◔ idle', () => {
        const now = new Date();
        const entries: NotificationEntry[] = [{
            timestamp: isoMinusSeconds(now, 5),
            session_id: 'sess-1',
            notification_type: 'idle_prompt'
        }];
        const out = render(makeItem(), ctx(entries));
        expect(out).toBe('◔ idle');
    });

    it('AC-7: permission overrides idle when both are within TTL', () => {
        const now = new Date();
        const entries: NotificationEntry[] = [
            { timestamp: isoMinusSeconds(now, 2), session_id: 's', notification_type: 'idle_prompt' },
            { timestamp: isoMinusSeconds(now, 5), session_id: 's', notification_type: 'permission_prompt' }
        ];
        expect(render(makeItem(), ctx(entries))).toBe('⚠ permission');
    });

    it('AC-8: falls back to idle when permission is past TTL', () => {
        const now = new Date();
        const entries: NotificationEntry[] = [
            { timestamp: isoMinusSeconds(now, 60), session_id: 's', notification_type: 'permission_prompt' },
            { timestamp: isoMinusSeconds(now, 10), session_id: 's', notification_type: 'idle_prompt' }
        ];
        expect(render(makeItem(), ctx(entries))).toBe('◔ idle');
    });

    it('AC-10: mode=permission ignores idle prompts', () => {
        const now = new Date();
        const entries: NotificationEntry[] = [{
            timestamp: isoMinusSeconds(now, 5),
            session_id: 's',
            notification_type: 'idle_prompt'
        }];
        expect(render(makeItem({ mode: 'permission' }), ctx(entries))).toBeNull();
    });

    it('AC-10: mode=idle ignores permission prompts', () => {
        const now = new Date();
        const entries: NotificationEntry[] = [{
            timestamp: isoMinusSeconds(now, 5),
            session_id: 's',
            notification_type: 'permission_prompt'
        }];
        expect(render(makeItem({ mode: 'idle' }), ctx(entries))).toBeNull();
    });

    it('AC-12: showElapsed appends the elapsed seconds', () => {
        const now = new Date();
        const entries: NotificationEntry[] = [{
            timestamp: isoMinusSeconds(now, 12),
            session_id: 's',
            notification_type: 'permission_prompt'
        }];
        const out = render(makeItem({ showElapsed: 'true' }), ctx(entries));
        expect(out).toMatch(/^⚠ permission \(1[12]s\)$/);
    });

    it('AC-13: custom label longer than 20 chars truncates to 20 visible chars + …', () => {
        const longLabel = 'A'.repeat(21);
        const now = new Date();
        const entries: NotificationEntry[] = [{
            timestamp: isoMinusSeconds(now, 1),
            session_id: 's',
            notification_type: 'permission_prompt'
        }];
        const out = render(makeItem({ labelPermission: longLabel }), ctx(entries));
        expect(out).toBe('A'.repeat(19) + '…');
        const visibleChars = Array.from(out ?? '');
        expect(visibleChars.length).toBe(20);
    });

    it('AC-13: empty labelPermission falls back to default', () => {
        const now = new Date();
        const entries: NotificationEntry[] = [{
            timestamp: isoMinusSeconds(now, 1),
            session_id: 's',
            notification_type: 'permission_prompt'
        }];
        const out = render(makeItem({ labelPermission: '' }), ctx(entries));
        expect(out).toBe('⚠ permission');
    });

    it('AC-16 / AC-11 rawValue: output matches non-raw label text', () => {
        const now = new Date();
        const entries: NotificationEntry[] = [{
            timestamp: isoMinusSeconds(now, 1),
            session_id: 's',
            notification_type: 'permission_prompt'
        }];
        const out = render(makeItem({}, true), ctx(entries));
        expect(out).toBe('⚠ permission');
    });

    it('AC-3 boundary: 44s elapsed renders, 46s elapsed disappears', () => {
        const now = new Date();
        const at44: NotificationEntry[] = [{
            timestamp: isoMinusSeconds(now, 44),
            session_id: 's',
            notification_type: 'permission_prompt'
        }];
        const at46: NotificationEntry[] = [{
            timestamp: isoMinusSeconds(now, 46),
            session_id: 's',
            notification_type: 'permission_prompt'
        }];
        expect(render(makeItem(), ctx(at44))).not.toBeNull();
        expect(render(makeItem(), ctx(at46))).toBeNull();
    });

    it('AC-6: missing notification_type entries are ignored upstream and produce idle/null', () => {
        const out = render(makeItem(), ctx([]));
        expect(out).toBeNull();
    });

    it('uses configured ttl when overriding the default', () => {
        const now = new Date();
        const entries: NotificationEntry[] = [{
            timestamp: isoMinusSeconds(now, 50),
            session_id: 's',
            notification_type: 'permission_prompt'
        }];
        expect(render(makeItem({ ttl: '60' }), ctx(entries))).toBe('⚠ permission');
        expect(render(makeItem({ ttl: '30' }), ctx(entries))).toBeNull();
    });
});

describe('NeedsAttentionWidget — preview', () => {
    it('AC-15: preview shows permission sample by default', () => {
        expect(render(makeItem(), previewCtx())).toBe('⚠ permission');
    });

    it('AC-15: preview reflects mode=idle', () => {
        expect(render(makeItem({ mode: 'idle' }), previewCtx())).toBe('◔ idle');
    });

    it('AC-15: preview adds elapsed when showElapsed is on', () => {
        expect(render(makeItem({ mode: 'idle', showElapsed: 'true' }), previewCtx()))
            .toBe('◔ idle (12s)');
    });
});

describe('formatElapsedSeconds', () => {
    it('floors below 1s to 1s', () => {
        expect(formatElapsedSeconds(100)).toBe('1s');
    });

    it('shows seconds under 60s', () => {
        expect(formatElapsedSeconds(12_400)).toBe('12s');
    });

    it('rolls over to minutes', () => {
        expect(formatElapsedSeconds(62_000)).toBe('1m02s');
    });

    it('rolls over to hours', () => {
        expect(formatElapsedSeconds(3_780_000)).toBe('1h03m');
    });
});
