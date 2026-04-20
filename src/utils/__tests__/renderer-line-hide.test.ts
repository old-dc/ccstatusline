import {
    describe,
    expect,
    it
} from 'vitest';

import type { WidgetItem } from '../../types/Widget';
import type { PreRenderedWidget } from '../renderer';
import { lineHasMeaningfulContent } from '../renderer';

function pre(widget: WidgetItem, content = ''): PreRenderedWidget {
    return {
        content,
        plainLength: content.length,
        widget
    };
}

describe('lineHasMeaningfulContent', () => {
    it('returns false for an empty line', () => {
        expect(lineHasMeaningfulContent([])).toBe(false);
    });

    it('returns false when only separators are present', () => {
        const line = [
            pre({ id: 's1', type: 'separator' }),
            pre({ id: 's2', type: 'flex-separator' })
        ];
        expect(lineHasMeaningfulContent(line)).toBe(false);
    });

    it('returns true when a non-decorative widget produced output', () => {
        const line = [
            pre({ id: 'w1', type: 'model' }, 'sonnet-4-6')
        ];
        expect(lineHasMeaningfulContent(line)).toBe(true);
    });

    it('returns false when a non-decorative widget produced empty output', () => {
        const line = [
            pre({ id: 'w1', type: 'agent-activity' }, '')
        ];
        expect(lineHasMeaningfulContent(line)).toBe(false);
    });

    it('returns false when only a hideWhenAlone widget has content', () => {
        const line = [
            pre({ id: 'emoji', type: 'custom-symbol', customSymbol: '📋', hideWhenAlone: true }, '📋')
        ];
        expect(lineHasMeaningfulContent(line)).toBe(false);
    });

    it('returns false when hideWhenAlone widget is the only thing with content, rest empty', () => {
        const line = [
            pre({ id: 'emoji', type: 'custom-symbol', customSymbol: '📋', hideWhenAlone: true }, '📋'),
            pre({ id: 'sep', type: 'separator' }),
            pre({ id: 'agents', type: 'agent-activity' }, ''),
            pre({ id: 'sep2', type: 'separator' }),
            pre({ id: 'todo', type: 'todo-progress' }, '')
        ];
        expect(lineHasMeaningfulContent(line)).toBe(false);
    });

    it('returns true when a companion widget has content even if hideWhenAlone widget is present', () => {
        const line = [
            pre({ id: 'emoji', type: 'custom-symbol', customSymbol: '📋', hideWhenAlone: true }, '📋'),
            pre({ id: 'sep', type: 'separator' }),
            pre({ id: 'agents', type: 'agent-activity' }, 'Agents: ◐ Running ×2'),
            pre({ id: 'sep2', type: 'separator' }),
            pre({ id: 'todo', type: 'todo-progress' }, '')
        ];
        expect(lineHasMeaningfulContent(line)).toBe(true);
    });

    it('treats hideWhenAlone:false / undefined as regular content-bearing widget', () => {
        const withFalse = [
            pre({ id: 'w', type: 'custom-symbol', customSymbol: '★', hideWhenAlone: false }, '★')
        ];
        const withUndefined = [
            pre({ id: 'w', type: 'custom-symbol', customSymbol: '★' }, '★')
        ];
        expect(lineHasMeaningfulContent(withFalse)).toBe(true);
        expect(lineHasMeaningfulContent(withUndefined)).toBe(true);
    });
});