import type { WidgetItem } from './Widget';

/**
 * The fork's curated default statusline layout.
 *
 * Used as the Zod schema default for `Settings.lines` (see ./Settings.ts), so
 * a fresh install with no ~/.config/ccstatusline/settings.json — or a config
 * recovery — renders this multi-line layout out of the box instead of the
 * upstream single-row default.
 *
 * Mirrors the maintainer's personal configuration. Widget ids are preserved
 * verbatim (UUIDs and human-readable ids alike); an id only needs to be unique
 * within the layout and carries no behavioural meaning.
 */
export const DEFAULT_LINES: WidgetItem[][] = [
    [
        {
            id: '2b7ef27b-d26f-4abf-8844-3c364d4226c3',
            type: 'custom-symbol',
            customSymbol: '🤖'
        },
        {
            id: 'fa1120d6-b352-4f6a-98fd-12bb5e962ace',
            type: 'separator'
        },
        {
            id: '1',
            type: 'model',
            color: 'brightRed',
            rawValue: true
        },
        {
            id: 'ce3e6689-e648-4438-a161-90dd01733ec4',
            type: 'separator'
        },
        {
            id: '3',
            type: 'thinking-effort',
            color: 'white',
            rawValue: false
        },
        {
            id: '18644863-eec4-4c02-9411-3616dd8203ca',
            type: 'separator'
        },
        {
            id: '114aad14-869d-47ba-a869-4fe693aa99e1',
            type: 'custom-symbol',
            customSymbol: '⏰'
        },
        {
            id: '605a85a5-c3b7-4dfb-a558-e562c0383369',
            type: 'custom-text',
            customText: ' '
        },
        {
            id: '9764b2e1-dd01-4624-ba47-8292acf44d53',
            type: 'session-clock',
            rawValue: true
        },
        {
            id: '2d566315-7e11-4537-ac79-3d3e4877afdd',
            type: 'separator'
        },
        {
            id: '8183c7f6-c865-4681-9aed-06ed675e50af',
            type: 'custom-symbol',
            customSymbol: '💰'
        },
        {
            id: '9b75ab7d-4c83-4c49-9912-40494497f177',
            type: 'custom-text',
            customText: ' '
        },
        {
            id: '37d079f2-4278-4300-ae68-3b1e636ac5b1',
            type: 'session-cost',
            color: 'yellow',
            rawValue: true
        },
        {
            id: '8f7d2a14-0a11-4e2d-9a6e-2c4b1e3a5d01',
            type: 'separator'
        },
        {
            id: '57de49f4-10a5-499b-b116-85916ef7d21c',
            type: 'output-style',
            color: 'white'
        }
    ],
    [
        {
            id: 'd6a2bc9f-4f4a-4b3d-9c1e-70a9f1c8e2b3',
            type: 'custom-symbol',
            customSymbol: '📁'
        },
        {
            id: 'f3c1b0e5-7d82-4d48-87a1-2a51fc6d03aa',
            type: 'separator'
        },
        {
            id: '4d592ff8-a2f7-4f07-a850-68216223d5db',
            type: 'current-working-dir',
            color: 'cyan',
            rawValue: true
        },
        {
            id: '9b40e7c2-2f16-4b57-8a0b-cdbb4f8a0e11',
            type: 'separator'
        },
        {
            id: '5',
            type: 'git-branch',
            color: 'magenta'
        },
        {
            id: 'b6f10113-037c-45de-9182-46a200018668',
            type: 'custom-text',
            customText: ' '
        },
        {
            id: '7',
            type: 'git-changes',
            color: 'yellow',
            metadata: { hideNoGit: 'false' }
        }
    ],
    [
        {
            id: 'line2-emoji',
            type: 'custom-symbol',
            customSymbol: '🧠'
        },
        {
            id: 'ea2c583e-05b0-44f4-a179-5c4637a2545b',
            type: 'separator'
        },
        {
            id: '62b14498-c94d-4c15-a204-ec790f209529',
            type: 'claude-session-id',
            color: 'brightBlack',
            rawValue: true
        },
        {
            id: '0376793c-166a-416d-9e37-90e4af492960',
            type: 'separator'
        },
        {
            id: 'fea7f2ec-0431-4b38-ae44-09e557e3e107',
            type: 'context-bar',
            metadata: { display: 'progress' }
        }
    ],
    [
        {
            id: 'b4312ff5-35e0-4e14-8310-7ea0418f58af',
            type: 'custom-symbol',
            customSymbol: '⚡️'
        },
        {
            id: '7d565ebe-de9b-49a0-9c26-3987283bb846',
            type: 'separator'
        },
        {
            id: 'e61d2f95-0189-4908-bab5-1ad3886cb174',
            type: 'custom-text',
            color: 'brightCyan',
            bold: true,
            customText: 'Token Speed: '
        },
        {
            id: '14ee1605-3d23-4981-8740-a82e96ba1681',
            type: 'input-speed',
            color: 'brightCyan',
            metadata: { windowSeconds: '60' }
        },
        {
            id: '308adfe5-9e7a-439f-8905-d3681a62cdbc',
            type: 'separator'
        },
        {
            id: '813239e2-66b0-462b-85ee-a8d5caeec252',
            type: 'output-speed',
            color: 'brightCyan',
            metadata: { windowSeconds: '60' }
        },
        {
            id: 'be5f93cc-f84d-4ac5-a881-17fbe0e869fa',
            type: 'separator'
        },
        {
            id: '57fc761c-e908-4133-b03d-a8e4759c8ce9',
            type: 'total-speed',
            color: 'brightCyan',
            rawValue: false
        },
        {
            id: '0c1baccf-e997-4545-a2fe-0870336f0a42',
            type: 'separator'
        },
        {
            id: 'c4e74a2b-89eb-43d2-96c5-7b0e05b8ebb9',
            type: 'tokens-cached',
            color: 'brightCyan',
            rawValue: false
        }
    ],
    [
        {
            id: 'line3-emoji',
            type: 'custom-symbol',
            customSymbol: '📊'
        },
        {
            id: 'line3-sep',
            type: 'separator'
        },
        {
            id: 'f90f1d37-c548-46af-afdd-ab628de0d090',
            type: 'custom-text',
            color: 'brightBlue',
            customText: 'Usage: '
        },
        {
            id: '378f1b6d-73de-4156-a778-7bccf90e2f86',
            type: 'session-usage',
            rawValue: true,
            metadata: {
                display: 'progress-short',
                invert: 'false'
            }
        },
        {
            id: 'efea29a2-3d82-4cb8-84f4-63d51041aa6c',
            type: 'custom-text',
            customText: ' (resets in '
        },
        {
            id: '6595682e-6c8c-4f22-ad57-cca0bb493944',
            type: 'reset-timer',
            color: 'green',
            rawValue: true,
            metadata: { compact: 'false' }
        },
        {
            id: 'd44984f7-2a12-4da9-9241-c63f9be36305',
            type: 'custom-text',
            customText: ')'
        },
        {
            id: 'd7b5dfcc-5215-4c47-8108-1e039b55eaa5',
            type: 'separator'
        },
        {
            id: 'afae9fd7-2352-450b-b0e7-fff3775ee37b',
            type: 'weekly-usage',
            merge: true,
            metadata: { display: 'progress-short' }
        },
        {
            id: 'a2078383-c296-4122-a95b-07c1a6e247fe',
            type: 'custom-text',
            customText: ' (resets in '
        },
        {
            id: '37c12efc-8c30-4c9f-a99f-3ef774e89967',
            type: 'weekly-reset-timer',
            color: 'green',
            rawValue: true,
            merge: 'no-padding',
            metadata: {
                display: 'time',
                hours: 'false',
                compact: 'false'
            }
        },
        {
            id: 'e81e2b78-8577-44eb-aa31-5a51ee20f550',
            type: 'custom-text',
            customText: ')'
        }
    ],
    [
        {
            id: 'line5-emoji',
            type: 'custom-symbol',
            customSymbol: '🛠️',
            hideWhenAlone: true
        },
        {
            id: 'line5-sep',
            type: 'separator'
        },
        {
            id: 'cf158400-205f-4c28-80f6-f86a97255b98',
            type: 'tool-count',
            metadata: {
                mode: 'activity',
                hideWhenEmpty: 'true'
            }
        }
    ],
    [
        {
            id: 'line-tasks-emoji',
            type: 'custom-symbol',
            customSymbol: '📋',
            hideWhenAlone: true
        },
        {
            id: 'line-tasks-sep1',
            type: 'separator'
        },
        {
            id: '19926564-9978-4d53-99e9-c061183242ad',
            type: 'agent-activity',
            color: 'brightGreen',
            rawValue: false,
            metadata: {
                mode: 'summary',
                hideElapsed: 'false',
                hideWhenEmpty: 'true',
                hideDescription: 'false',
                hideModel: 'false'
            }
        },
        {
            id: 'line-tasks-sep2',
            type: 'separator'
        },
        {
            id: 'c92b5b34-cb93-44c3-a734-33a4c1a63738',
            type: 'todo-progress',
            metadata: {
                hideWhenEmpty: 'true',
                hideProgress: 'false',
                hideContent: 'false',
                mode: 'status'
            }
        },
        {
            id: 'line-tasks-sep3',
            type: 'separator'
        },
        {
            id: '0c106719-c704-4200-adc2-4eafafe893c2',
            type: 'skills',
            rawValue: false,
            metadata: {
                mode: 'activity',
                hideWhenEmpty: 'true'
            }
        }
    ]
];
