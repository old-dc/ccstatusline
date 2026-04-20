import {
    describe,
    expect,
    it
} from 'vitest';

import {
    DEFAULT_SETTINGS,
    type Settings
} from '../../types/Settings';
import type { WidgetItem } from '../../types/Widget';
import { getVisibleText } from '../ansi';
import {
    calculateMaxWidthsFromPreRendered,
    preRenderAllWidgets,
    renderStatusLine
} from '../renderer';

function settings(): Settings {
    // Leave defaultSeparator undefined: tests use explicit separator widgets
    // and don't want the renderer's auto-between-elements separator on top.
    return {
        ...DEFAULT_SETTINGS,
        defaultPadding: '',
        powerline: { ...DEFAULT_SETTINGS.powerline, enabled: false }
    };
}

function text(id: string, value: string): WidgetItem {
    // CustomTextWidget.render returns item.customText ?? '', so passing '' or
    // omitting customText yields an "empty" widget for testing purposes.
    return { id, type: 'custom-text', customText: value };
}

function sep(id: string): WidgetItem {
    return { id, type: 'separator' };
}

function plain(line: string): string {
    return getVisibleText(line);
}

function render(widgets: WidgetItem[]): string {
    const s = settings();
    const ctx = {};
    const pre = preRenderAllWidgets([widgets], s, ctx);
    const widths = calculateMaxWidthsFromPreRendered(pre, s);
    return plain(renderStatusLine(widgets, s, ctx, pre[0] ?? [], widths));
}

describe('renderStatusLine — separator suppression around empty widgets', () => {
    it('suppresses the separator on the empty side of a null widget (mid-row)', () => {
        // Layout: [A] | [empty] | [B]  → expected: A | B (single separator)
        const out = render([
            text('a', 'A'),
            sep('s1'),
            text('e', ''),
            sep('s2'),
            text('b', 'B')
        ]);
        expect(out.trim()).toBe('A | B');
    });

    it('suppresses both surrounding separators when the middle of three widgets is null', () => {
        // [A] | [empty] | [empty] | [B] → A | B
        const out = render([
            text('a', 'A'),
            sep('s1'),
            text('e1', ''),
            sep('s2'),
            text('e2', ''),
            sep('s3'),
            text('b', 'B')
        ]);
        expect(out.trim()).toBe('A | B');
    });

    it('suppresses leading separator when first content widget is null', () => {
        // [empty] | [B]  → B
        const out = render([
            text('e', ''),
            sep('s1'),
            text('b', 'B')
        ]);
        expect(out.trim()).toBe('B');
    });

    it('suppresses trailing separator when last content widget is null', () => {
        // [A] | [empty]  → A
        const out = render([
            text('a', 'A'),
            sep('s1'),
            text('e', '')
        ]);
        expect(out.trim()).toBe('A');
    });

    it('keeps the separator when both sides have content', () => {
        const out = render([
            text('a', 'A'),
            sep('s1'),
            text('b', 'B')
        ]);
        expect(out.trim()).toBe('A | B');
    });

    it('does not introduce double separator when adjacent widgets all have content', () => {
        const out = render([
            text('a', 'A'),
            sep('s1'),
            text('b', 'B'),
            sep('s2'),
            text('c', 'C')
        ]);
        expect(out.trim()).toBe('A | B | C');
    });
});