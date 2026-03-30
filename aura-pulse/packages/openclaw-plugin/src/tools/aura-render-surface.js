import { Type } from '@sinclair/typebox'

const CANONICAL_MESSAGE_ORDER = {
    surfaceUpdate: 0,
    dataModelUpdate: 1,
    beginRendering: 2,
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isStringValue(value) {
    return isPlainObject(value)
        && (
            typeof value.path === 'string'
            || typeof value.literalString === 'string'
            || typeof value.literal === 'string'
        )
}

/**
 * @param {number} index
 * @param {number} componentIndex
 * @param {Record<string, unknown>} component
 */
function validateBuiltInComponent(index, componentIndex, component) {
    const componentEntries = Object.entries(component)
    if (componentEntries.length !== 1) {
        throw new Error(
            `aura_render_surface.a2ui_messages[${index}].surfaceUpdate.components[${componentIndex}].component must contain exactly one component type.`
        )
    }

    const componentEntry = componentEntries[0]
    if (!componentEntry) {
        throw new Error(
            `aura_render_surface.a2ui_messages[${index}].surfaceUpdate.components[${componentIndex}].component must contain exactly one component type.`
        )
    }

    const [componentType, props] = componentEntry
    if (!isPlainObject(props)) {
        throw new Error(
            `aura_render_surface.a2ui_messages[${index}].surfaceUpdate.components[${componentIndex}].component.${componentType} must be an object.`
        )
    }

    if (componentType === 'Text' && !isStringValue(props.text)) {
        throw new Error(
            `aura_render_surface.a2ui_messages[${index}].surfaceUpdate.components[${componentIndex}].component.Text.text must be an A2UI string value object such as { literalString: "..." } or { path: "/field" }. Do not use Text.value.`
        )
    }
}

/**
 * @param {number} index
 * @param {string[]} keys
 * @returns {Error}
 */
function buildMalformedShapeError(index, keys) {
    return new Error(
        `aura_render_surface.a2ui_messages[${index}] is not a canonical A2UI message. `
        + `Each item must be exactly one of { surfaceUpdate: { ... } }, { dataModelUpdate: { ... } }, or { beginRendering: { ... } }. `
        + `Received keys: ${keys.join(', ') || '(none)'}. `
        + `Do not use wrapper shapes like { type: "a2ui.surfaceUpdate", data: { ... } } or { a2uiType: "surfaceUpdate", data: { ... } }.`
    )
}

/**
 * @param {string} surfaceId
 * @param {Record<string, unknown>[]} messages
 */
function validateA2UIMessages(surfaceId, messages) {
    const seenKinds = new Set()
    let highestOrder = -1

    messages.forEach((message, index) => {
        if (!isPlainObject(message)) {
            throw new Error(`aura_render_surface.a2ui_messages[${index}] must be an object.`)
        }

        const keys = Object.keys(message)
        const canonicalKinds = Object.keys(CANONICAL_MESSAGE_ORDER).filter((key) => key in message)
        if (canonicalKinds.length !== 1) {
            throw buildMalformedShapeError(index, keys)
        }

        const kind = /** @type {'surfaceUpdate' | 'dataModelUpdate' | 'beginRendering'} */ (canonicalKinds[0])
        const payload = message[kind]
        if (!isPlainObject(payload)) {
            throw new Error(`aura_render_surface.a2ui_messages[${index}].${kind} must be an object.`)
        }

        const order = CANONICAL_MESSAGE_ORDER[kind]
        if (order < highestOrder) {
            throw new Error(
                `aura_render_surface.a2ui_messages must be ordered as surfaceUpdate, dataModelUpdate, beginRendering. `
                + `Found ${kind} after a later message type at index ${index}.`
            )
        }
        highestOrder = order
        seenKinds.add(kind)

        if (payload.surfaceId !== surfaceId) {
            throw new Error(
                `aura_render_surface.a2ui_messages[${index}].${kind}.surfaceId must equal surface_id ${JSON.stringify(surfaceId)}.`
            )
        }

        if (kind === 'surfaceUpdate') {
            if (!Array.isArray(payload.components) || payload.components.length === 0) {
                throw new Error(
                    `aura_render_surface.a2ui_messages[${index}].surfaceUpdate.components must be a non-empty array of { id, component } objects.`
                )
            }

            payload.components.forEach((component, componentIndex) => {
                if (!isPlainObject(component) || typeof component.id !== 'string' || !isPlainObject(component.component)) {
                    throw new Error(
                        `aura_render_surface.a2ui_messages[${index}].surfaceUpdate.components[${componentIndex}] must contain string id and object component fields.`
                    )
                }

                validateBuiltInComponent(index, componentIndex, component.component)
            })
        }

        if (kind === 'dataModelUpdate' && !Array.isArray(payload.contents)) {
            throw new Error(
                `aura_render_surface.a2ui_messages[${index}].dataModelUpdate.contents must be an array.`
            )
        }

        if (kind === 'beginRendering') {
            if (typeof payload.root !== 'string' || payload.root.trim().length === 0) {
                throw new Error(
                    `aura_render_surface.a2ui_messages[${index}].beginRendering.root must be a non-empty string.`
                )
            }

            if (typeof payload.catalogId !== 'string' || payload.catalogId.trim().length === 0) {
                throw new Error(
                    `aura_render_surface.a2ui_messages[${index}].beginRendering.catalogId must be a non-empty string.`
                )
            }
        }
    })

    if (!seenKinds.has('surfaceUpdate') || !seenKinds.has('beginRendering')) {
        throw new Error(
            'aura_render_surface requires canonical A2UI messages that include at least one surfaceUpdate and one beginRendering entry.'
        )
    }
}

/**
 * @param {unknown} rawMessages
 * @returns {Record<string, unknown>[]}
 */
function normalizeA2UIMessages(rawMessages) {
    if (Array.isArray(rawMessages)) {
        return /** @type {Record<string, unknown>[]} */ (rawMessages)
    }

    if (typeof rawMessages !== 'string') {
        throw new Error('aura_render_surface.a2ui_messages must be array.')
    }

    let parsed
    try {
        parsed = JSON.parse(rawMessages)
    } catch {
        throw new Error('aura_render_surface.a2ui_messages string must contain valid JSON.')
    }

    if (!Array.isArray(parsed)) {
        throw new Error('aura_render_surface.a2ui_messages string must decode to an array.')
    }

    return /** @type {Record<string, unknown>[]} */ (parsed)
}

/**
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
 * @typedef {{
 *   surface_id: string,
 *   title?: string,
 *   summary?: string,
 *   voice_line?: string,
 *   surface_type?: 'workspace' | 'plan' | 'attention' | 'monitor' | 'brief',
 *   priority?: 'low' | 'normal' | 'high',
 *   collaborative?: boolean,
 *   icon?: string,
 *   a2ui_messages: Record<string, unknown>[] | string,
 * }} RenderSurfaceParams
 */

/**
 * aura_render_surface — presentation tool for the primary agent.
 * Sends a generic A2UI-driven interface to the Aura Pulse surface without creating a contract.
 * Use this for exploratory, informational, or conversational UI such as tables, dashboards,
 * lists, charts, or drill-down views. This is presentation only; do not use it for approvals,
 * deterministic workflow state, or anything that requires resume tokens. Those still belong in contracts.
 *
 * The a2ui_messages field must be a valid array of AG-UI/A2UI server-to-client messages.
 * In most cases that means sending the standard trio for a surface:
 * 1. surfaceUpdate
 * 2. dataModelUpdate
 * 3. beginRendering
 */
/**
 * @param {KernelSurfaceTransport} wsService
 * @returns {import('../types/plugin-types.js').RegisteredTool}
 */
export function buildRenderSurface(wsService) {
    return {
        name: 'aura_render_surface',
        description: 'ADVANCED: Low-level A2UI renderer. PREFER aura_surface instead for all common surfaces (dashboards, tables, metrics, summaries). Only use aura_render_surface when you need custom A2UI components not available in aura_surface sections. Requires hand-crafted canonical A2UI message arrays.',
        parameters: Type.Object({
            surface_id: Type.String({ description: 'Stable A2UI surface id, e.g. sales-last-week or inbox-summary' }),
            title: Type.Optional(Type.String({ description: 'Short title shown above the rendered interface' })),
            summary: Type.Optional(Type.String({ description: 'Brief explanatory text shown above the interface' })),
            voice_line: Type.Optional(Type.String({ description: 'Optional voice narration spoken when the surface appears' })),
            surface_type: Type.Optional(Type.Union([
                Type.Literal('workspace'),
                Type.Literal('plan'),
                Type.Literal('attention'),
                Type.Literal('monitor'),
                Type.Literal('brief'),
            ], { description: 'Optional Pulse workspace treatment for this panel. Use plan for working sessions, attention for urgent notices, and monitor for passive dashboards.' })),
            priority: Type.Optional(Type.Union([
                Type.Literal('low'),
                Type.Literal('normal'),
                Type.Literal('high'),
            ], { description: 'Optional visual priority used by Pulse panel chrome.' })),
            collaborative: Type.Optional(Type.Boolean({ description: 'Marks the panel as an actively collaborative workspace surface instead of a passive update.' })),
            icon: Type.Optional(Type.String({ description: 'Optional short icon label shown on minimized Pulse panel chips, e.g. GR or INV.' })),
            a2ui_messages: Type.Union([
                Type.Array(
                    Type.Record(Type.String(), Type.Unknown()),
                    {
                        minItems: 1,
                    },
                ),
                Type.String({ minLength: 2 }),
            ], {
                description: 'Canonical A2UI message objects for the same surface_id. Pass a native array value. Each item must be a real protocol object like { surfaceUpdate: { ... } }, { dataModelUpdate: { ... } }, or { beginRendering: { ... } }. Do not quote the array. Do not use type/data or a2uiType/data wrappers.',
            }),
        }),
        /**
         * @param {string} _id
         * @param {RenderSurfaceParams} params
         */
        async execute(_id, params) {
            const p = params
            const normalizedMessages = normalizeA2UIMessages(p.a2ui_messages)
            validateA2UIMessages(p.surface_id, normalizedMessages)

            const surface = {
                surfaceId: p.surface_id,
                a2uiMessages: normalizedMessages,
                ...(p.title ? { title: p.title } : {}),
                ...(p.summary ? { summary: p.summary } : {}),
                ...(p.voice_line ? { voiceLine: p.voice_line } : {}),
                ...(p.surface_type ? { surfaceType: p.surface_type } : {}),
                ...(p.priority ? { priority: p.priority } : {}),
                ...(typeof p.collaborative === 'boolean' ? { collaborative: p.collaborative } : {}),
                ...(p.icon ? { icon: p.icon } : {}),
            }
            wsService.pushKernelSurface(surface)

            return /** @type {import('../types/plugin-types.js').ToolResult} */ ({
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        surfaceId: p.surface_id,
                        status: 'rendered',
                        messageCount: normalizedMessages.length,
                    }),
                }],
            })
        },
    }
}
