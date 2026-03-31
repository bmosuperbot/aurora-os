import { Type } from '@sinclair/typebox'

const CATALOG_ID = 'https://aura-os.ai/a2ui/v1/aura-catalog.json'

// ---------------------------------------------------------------------------
// Section schemas — each section is a flat object the model fills in.
// The compiler converts these to canonical A2UI; the model never writes A2UI.
// ---------------------------------------------------------------------------

const MetricItemSchema = Type.Object({
    id: Type.String({ description: 'Stable metric identifier, e.g. revenue or orders' }),
    label: Type.String({ description: 'Display label shown on the tile' }),
    value: Type.Union([Type.String(), Type.Number()], {
        description: 'Metric value displayed prominently, e.g. "$482" or 3',
    }),
    detail: Type.Optional(Type.String({ description: 'Supporting detail line below the value, e.g. "+12% vs prior week"' })),
    tone: Type.Optional(Type.Union([
        Type.Literal('default'),
        Type.Literal('positive'),
        Type.Literal('negative'),
        Type.Literal('warning'),
        Type.Literal('info'),
        Type.Literal('critical'),
    ], { description: 'Colour tone for the tile' })),
})

const ColumnDefSchema = Type.Object({
    id: Type.String({ description: 'Column key used to look up each row value' }),
    label: Type.String({ description: 'Column header text' }),
    align: Type.Optional(Type.Union([
        Type.Literal('left'),
        Type.Literal('center'),
        Type.Literal('right'),
    ])),
})

const HeadingSection = Type.Object({
    type: Type.Literal('heading'),
    text: Type.String({ description: 'Headline or section title text' }),
})

const TextSection = Type.Object({
    type: Type.Literal('text'),
    text: Type.String({ description: 'Paragraph or body text' }),
})

const MetricsSection = Type.Object({
    type: Type.Literal('metrics'),
    title: Type.Optional(Type.String({ description: 'Optional heading above the metric tiles' })),
    items: Type.Array(MetricItemSchema, { minItems: 1, description: 'Metric tiles to render' }),
})

const TableSection = Type.Object({
    type: Type.Literal('table'),
    title: Type.Optional(Type.String({ description: 'Optional heading above the table' })),
    caption: Type.Optional(Type.String({ description: 'Optional caption line below the title, e.g. "Newest first"' })),
    columns: Type.Array(ColumnDefSchema, { minItems: 1, description: 'Column definitions' }),
    rows: Type.Array(
        Type.Record(Type.String(), Type.Union([Type.String(), Type.Number()])),
        { description: 'Row data objects. Each row must have an id field plus one field per column id.' }
    ),
})

const ActionSection = Type.Object({
    type: Type.Literal('action'),
    label: Type.String({ description: 'Button label visible to the owner' }),
    action_id: Type.String({ description: 'Stable action id sent back when the owner clicks, e.g. inspect_order or approve_quote' }),
    style: Type.Optional(Type.Union([Type.Literal('primary'), Type.Literal('secondary')])),
    context: Type.Record(Type.String(), Type.Union([Type.String(), Type.Number(), Type.Boolean()]), {
        description: 'REQUIRED key-value pairs sent back when clicked. Must include relevant identifiers (e.g. bean name, account, amount). Never leave empty.',
    }),
})

const SectionSchema = Type.Union([
    HeadingSection,
    TextSection,
    MetricsSection,
    TableSection,
    ActionSection,
])

// ---------------------------------------------------------------------------
// Compiler — converts flat section objects to canonical A2UI components
// ---------------------------------------------------------------------------

/**
 * @param {Record<string, unknown>} section
 * @param {number} index
 * @returns {{ id: string, component: Record<string, unknown> }}
 */
function compileSection(section, index) {
    const id = `s${index}`

    switch (section.type) {
        case 'heading':
        case 'text': {
            return {
                id,
                component: {
                    Text: {
                        text: { literalString: /** @type {string} */ (section.text) },
                    },
                },
            }
        }

        case 'metrics': {
            const items = Array.isArray(section.items) ? section.items : []
            /** @type {Record<string, unknown>} */
            const grid = {
                metrics: /** @type {Array<Record<string, unknown>>} */ (items).map((item, idx) => ({
                    id: item.id || `m${idx}`,
                    label: item.label || `Metric ${idx + 1}`,
                    value: item.value ?? '',
                    ...(item.detail != null ? { detail: item.detail } : {}),
                    ...(item.tone ? { tone: item.tone } : {}),
                })),
            }
            if (section.title) grid.title = section.title
            return { id, component: { MetricGrid: grid } }
        }

        case 'table': {
            const columns = Array.isArray(section.columns) ? section.columns : []
            const rows = Array.isArray(section.rows) ? section.rows : []
            /** @type {Record<string, unknown>} */
            const table = { columns, rows }
            if (section.title) table.title = section.title
            if (section.caption) table.caption = section.caption
            if (rows.length === 0) {
                return { id, component: { Text: { text: { literalString: section.title ? `${section.title}: No data available` : 'No data available' } } } }
            }
            return { id, component: { DataTable: table } }
        }

        case 'action': {
            /** @type {Record<string, unknown>} */
            const btn = {
                label: section.label,
                actionId: section.action_id,
            }
            if (section.style) btn.style = section.style
            // Guarantee non-empty context: use provided values or derive from action_id/label
            const ctx = (section.context && typeof section.context === 'object' && Object.keys(section.context).length > 0)
                ? section.context
                : { action: section.action_id, label: section.label }
            btn.actionContext = ctx
            return { id, component: { ActionButton: btn } }
        }

        default:
            throw new Error(`aura_surface: unknown section type "${String(section.type)}"`)
    }
}

/**
 * Compile flat section descriptors into the canonical A2UI trio:
 * surfaceUpdate → dataModelUpdate → beginRendering.
 *
 * @param {string} surfaceId
 * @param {Array<Record<string, unknown>>} sections
 * @returns {Array<Record<string, unknown>>}
 */
function buildA2UIMessages(surfaceId, sections) {
    if (!Array.isArray(sections) || sections.length === 0) {
        throw new Error('aura_surface.sections must be a non-empty array of section objects')
    }

    const sectionComponents = sections.map((section, index) => compileSection(section, index))
    const childIds = sectionComponents.map((c) => c.id)

    const rootComponent = {
        id: 'root',
        component: {
            Column: {
                children: { explicitList: childIds },
            },
        },
    }

    return [
        {
            surfaceUpdate: {
                surfaceId,
                components: [rootComponent, ...sectionComponents],
            },
        },
        {
            dataModelUpdate: {
                surfaceId,
                contents: [],
            },
        },
        {
            beginRendering: {
                surfaceId,
                root: 'root',
                catalogId: CATALOG_ID,
            },
        },
    ]
}

// ---------------------------------------------------------------------------
// Normalization — small models often serialize arrays as JSON strings
// ---------------------------------------------------------------------------

/**
 * @param {unknown} raw
 * @returns {Array<Record<string, unknown>>}
 */
function normalizeSections(raw) {
    if (Array.isArray(raw)) {
        return /** @type {Array<Record<string, unknown>>} */ (raw)
    }

    if (typeof raw === 'string') {
        let parsed
        try {
            parsed = JSON.parse(raw)
        } catch {
            const start = raw.indexOf('[')
            const end = raw.lastIndexOf(']')
            if (start !== -1 && end > start) {
                try {
                    parsed = JSON.parse(raw.slice(start, end + 1))
                } catch { /* fall through to error */ }
            }
            if (!parsed) {
                throw new Error('aura_surface.sections string must contain valid JSON array.')
            }
        }

        if (!Array.isArray(parsed)) {
            throw new Error('aura_surface.sections string must decode to an array.')
        }

        return /** @type {Array<Record<string, unknown>>} */ (parsed)
    }

    throw new Error('aura_surface.sections must be an array.')
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   pushKernelSurface(surface: {
 *     surfaceId: string,
 *     title?: string,
 *     summary?: string,
 *     voiceLine?: string,
 *     surfaceType?: 'workspace' | 'plan' | 'attention' | 'monitor' | 'brief',
 *     priority?: 'low' | 'normal' | 'high',
 *     collaborative?: boolean,
 *     icon?: string,
 *     a2uiMessages: Record<string, unknown>[],
 *   }): void,
 * }} KernelSurfaceTransport
 */

/**
 * aura_surface — high-level Pulse surface tool for the primary agent.
 *
 * The model describes what to show using flat business-friendly fields
 * (headings, metric tiles, data tables, action buttons). The tool compiles
 * those into canonical A2UI and pushes the surface to Pulse. The model never
 * writes raw A2UI JSON.
 *
 * Use this instead of aura_render_surface for all common business surfaces.
 *
 * @param {KernelSurfaceTransport} wsService
 * @returns {import('../types/plugin-types.js').RegisteredTool}
 */
export function buildSurface(wsService) {
    return {
        name: 'aura_surface',
        description: 'Show information in Aura Pulse as a structured business interface. Use this to display dashboards, sales data, tables, metrics, or summaries with optional action buttons. Describe what you want to show using the sections array: heading, text, metrics, table, or action. The tool compiles your description into the correct Pulse format automatically. Use this for any informative or exploratory UI instead of aura_render_surface.',
        parameters: Type.Object({
            surface_id: Type.String({
                description: 'Stable id for this view, e.g. sales-last-week or inbox-summary. Use the same id to update a surface already shown.',
            }),
            title: Type.Optional(Type.String({ description: 'Short title shown above the panel' })),
            summary: Type.Optional(Type.String({ description: 'Brief explanatory text shown above the panel' })),
            voice_line: Type.Optional(Type.String({ description: 'Optional voice narration spoken when the surface appears' })),
            surface_type: Type.Optional(Type.Union([
                Type.Literal('workspace'),
                Type.Literal('plan'),
                Type.Literal('attention'),
                Type.Literal('monitor'),
                Type.Literal('brief'),
            ], { description: 'Optional Pulse panel treatment' })),
            priority: Type.Optional(Type.Union([
                Type.Literal('low'),
                Type.Literal('normal'),
                Type.Literal('high'),
            ])),
            collaborative: Type.Optional(Type.Boolean({
                description: 'Mark the panel as a collaborative workspace surface',
            })),
            icon: Type.Optional(Type.String({ description: 'Short icon label shown on minimized panel chips, e.g. GR or INV' })),
            sections: Type.Array(SectionSchema, {
                description: 'Ordered list of sections to display. Each section must have a "type" field: "heading" (+ "text"), "text" (+ "text"), "metrics" (+ "items" array), "table" (+ "columns" and "rows"), or "action" (+ "label" and "action_id").',
                minItems: 1,
            }),
        }),

        /**
         * @param {string} _id
         * @param {Record<string, unknown>} params
         */
        async execute(_id, params) {
            try {
                const surfaceId = /** @type {string} */ (params.surface_id)
                const sections = /** @type {Array<Record<string, unknown>>} */ (normalizeSections(params.sections))

                const a2uiMessages = buildA2UIMessages(surfaceId, sections)

                /** @type {Parameters<KernelSurfaceTransport['pushKernelSurface']>[0]} */
                const surface = { surfaceId, a2uiMessages }
                if (typeof params.title === 'string') surface.title = params.title
                if (typeof params.summary === 'string') surface.summary = params.summary
                if (typeof params.voice_line === 'string') surface.voiceLine = params.voice_line
                if (typeof params.surface_type === 'string') surface.surfaceType = /** @type {any} */ (params.surface_type)
                if (typeof params.priority === 'string') surface.priority = /** @type {any} */ (params.priority)
                if (typeof params.collaborative === 'boolean') surface.collaborative = params.collaborative
                if (typeof params.icon === 'string') surface.icon = params.icon

                wsService.pushKernelSurface(surface)

                return /** @type {import('../types/plugin-types.js').ToolResult} */ ({
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            surfaceId,
                            status: 'rendered',
                            sectionCount: sections.length,
                            messageCount: a2uiMessages.length,
                            instruction: 'Surface is now visible in Pulse. Reply to the owner with a brief summary of what you displayed. Do not call any more tools.',
                        }),
                    }],
                })
            } catch (/** @type {any} */ err) {
                return /** @type {import('../types/plugin-types.js').ToolResult} */ ({
                    content: [{
                        type: 'text',
                        text: `aura_surface error: ${err?.message ?? String(err)}`,
                    }],
                    isError: true,
                })
            }
        },
    }
}
