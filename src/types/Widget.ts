import { z } from 'zod';

import type { RenderContext } from './RenderContext';
import type { Settings } from './Settings';

// Widget item schema - accepts any string type for forward compatibility
export const WidgetItemSchema = z.object({
    id: z.string(),
    type: z.string(),
    color: z.string().optional(),
    backgroundColor: z.string().optional(),
    bold: z.boolean().optional(),
    character: z.string().optional(),
    rawValue: z.boolean().optional(),
    customText: z.string().optional(),
    customSymbol: z.string().optional(),
    commandPath: z.string().optional(),
    maxWidth: z.number().optional(),
    preserveColors: z.boolean().optional(),
    timeout: z.number().optional(),
    merge: z.union([z.boolean(), z.literal('no-padding')]).optional(),
    hide: z.boolean().optional(),
    // When true, the renderer treats this widget as decorative: the row is
    // suppressed entirely if no *non-decorative, non-separator* widget on the
    // same row has content. Typical use: an emoji prefix that should vanish
    // when all its companion widgets are hidden (hideWhenEmpty).
    hideWhenAlone: z.boolean().optional(),
    metadata: z.record(z.string(), z.string()).optional()
});

// Inferred types from Zod schemas
export type WidgetItem = z.infer<typeof WidgetItemSchema>;
export type WidgetItemType = string; // Allow any string for forward compatibility

export interface WidgetEditorDisplay {
    displayText: string;
    modifierText?: string;
}

export interface Widget {
    getDefaultColor(): string;
    getDescription(): string;
    getDisplayName(): string;
    getCategory(): string;
    getEditorDisplay(item: WidgetItem): WidgetEditorDisplay;
    render(item: WidgetItem, context: RenderContext, settings: Settings): string | null;
    getCustomKeybinds?(item?: WidgetItem): CustomKeybind[];
    renderEditor?(props: WidgetEditorProps): React.ReactElement | null;
    supportsRawValue(): boolean;
    supportsColors(item: WidgetItem): boolean;
    handleEditorAction?(action: string, item: WidgetItem): WidgetItem | null;
    getNumericValue?(context: RenderContext, item: WidgetItem): number | null;
}

export interface WidgetEditorProps {
    widget: WidgetItem;
    onComplete: (updatedWidget: WidgetItem) => void;
    onCancel: () => void;
    action?: string;
}

export interface CustomKeybind {
    key: string;
    label: string;
    action: string;
}
