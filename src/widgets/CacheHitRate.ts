import type { RenderContext } from '../types/RenderContext';
import type { Settings } from '../types/Settings';
import type {
    Widget,
    WidgetEditorDisplay,
    WidgetItem
} from '../types/Widget';

import { formatRawOrLabeledValue } from './shared/raw-or-labeled';

export class CacheHitRateWidget implements Widget {
    getDefaultColor(): string { return 'cyan'; }
    getDescription(): string { return 'Shows prompt cache hit rate (cache reads / all input tokens) for the current session'; }
    getDisplayName(): string { return 'Cache Hit Rate'; }
    getCategory(): string { return 'Tokens'; }
    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay {
        return { displayText: this.getDisplayName() };
    }

    render(item: WidgetItem, context: RenderContext, settings: Settings): string | null {
        if (context.isPreview) {
            return formatRawOrLabeledValue(item, 'Cache Hit: ', '94.1%');
        }

        const rate = context.sessionStats?.cacheHitRate;
        if (rate === undefined || rate === null) {
            return null;
        }
        return formatRawOrLabeledValue(item, 'Cache Hit: ', `${rate.toFixed(1)}%`);
    }

    supportsRawValue(): boolean { return true; }
    supportsColors(item: WidgetItem): boolean { return true; }
}
