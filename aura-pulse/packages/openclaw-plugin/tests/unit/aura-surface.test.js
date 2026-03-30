import { describe, expect, it, vi } from 'vitest'

import { buildSurface } from '../../src/tools/aura-surface.js'

function makeTool() {
    const wsService = { pushKernelSurface: vi.fn() }
    const tool = buildSurface(wsService)
    return { tool, wsService }
}

describe('buildSurface', () => {
    it('compiles a heading section into a valid A2UI surface', async () => {
        const { tool, wsService } = makeTool()

        const result = await tool.execute('call-1', {
            surface_id: 'test-heading',
            title: 'Test',
            sections: [{ type: 'heading', text: 'Hello Pulse' }],
        })

        expect(wsService.pushKernelSurface).toHaveBeenCalledTimes(1)
        const pushed = wsService.pushKernelSurface.mock.calls[0][0]
        expect(pushed.surfaceId).toBe('test-heading')
        expect(pushed.title).toBe('Test')

        const [surfaceUpdate, dataModelUpdate, beginRendering] = pushed.a2uiMessages
        expect(surfaceUpdate.surfaceUpdate.surfaceId).toBe('test-heading')
        expect(surfaceUpdate.surfaceUpdate.components[0].id).toBe('root')
        expect(surfaceUpdate.surfaceUpdate.components[1].component.Text.text.literalString).toBe('Hello Pulse')
        expect(dataModelUpdate.dataModelUpdate.contents).toEqual([])
        expect(beginRendering.beginRendering.root).toBe('root')
        expect(beginRendering.beginRendering.catalogId).toContain('aura-os.ai')

        expect(result.content[0].text).toContain('"status":"rendered"')
    })

    it('compiles a metrics section into a MetricGrid component', async () => {
        const { tool, wsService } = makeTool()

        await tool.execute('call-2', {
            surface_id: 'test-metrics',
            sections: [{
                type: 'metrics',
                title: 'Overview',
                items: [
                    { id: 'revenue', label: 'Revenue', value: '$482', detail: '+12%', tone: 'positive' },
                    { id: 'orders', label: 'Orders', value: 3 },
                ],
            }],
        })

        const pushed = wsService.pushKernelSurface.mock.calls[0][0]
        const metricsComponent = pushed.a2uiMessages[0].surfaceUpdate.components[1]
        expect(metricsComponent.component.MetricGrid.title).toBe('Overview')
        expect(metricsComponent.component.MetricGrid.metrics).toHaveLength(2)
        expect(metricsComponent.component.MetricGrid.metrics[0].tone).toBe('positive')
        expect(metricsComponent.component.MetricGrid.metrics[1].value).toBe(3)
    })

    it('compiles a table section into a DataTable component', async () => {
        const { tool, wsService } = makeTool()

        await tool.execute('call-3', {
            surface_id: 'test-table',
            sections: [{
                type: 'table',
                title: 'Orders',
                caption: 'Newest first',
                columns: [
                    { id: 'order', label: 'Order' },
                    { id: 'gross', label: 'Gross', align: 'right' },
                ],
                rows: [
                    { id: 'r1', order: 'A-104', gross: '$182' },
                    { id: 'r2', order: 'A-103', gross: '$160' },
                ],
            }],
        })

        const pushed = wsService.pushKernelSurface.mock.calls[0][0]
        const tableComponent = pushed.a2uiMessages[0].surfaceUpdate.components[1]
        expect(tableComponent.component.DataTable.title).toBe('Orders')
        expect(tableComponent.component.DataTable.caption).toBe('Newest first')
        expect(tableComponent.component.DataTable.columns).toHaveLength(2)
        expect(tableComponent.component.DataTable.rows).toHaveLength(2)
    })

    it('compiles an action section into an ActionButton component', async () => {
        const { tool, wsService } = makeTool()

        await tool.execute('call-4', {
            surface_id: 'test-action',
            sections: [{
                type: 'action',
                label: 'Inspect Order',
                action_id: 'inspect_order',
                style: 'primary',
                context: { orderId: 'A-104', gross: 182 },
            }],
        })

        const pushed = wsService.pushKernelSurface.mock.calls[0][0]
        const btn = pushed.a2uiMessages[0].surfaceUpdate.components[1].component.ActionButton
        expect(btn.label).toBe('Inspect Order')
        expect(btn.actionId).toBe('inspect_order')
        expect(btn.style).toBe('primary')
        expect(btn.actionContext.orderId).toBe('A-104')
    })

    it('compiles a full multi-section surface with correct Column root', async () => {
        const { tool, wsService } = makeTool()

        await tool.execute('call-5', {
            surface_id: 'sales-last-week',
            sections: [
                { type: 'heading', text: 'Sales Last Week' },
                { type: 'metrics', items: [{ id: 'rev', label: 'Revenue', value: '$482' }] },
                { type: 'action', label: 'View Details', action_id: 'view_details' },
            ],
        })

        const pushed = wsService.pushKernelSurface.mock.calls[0][0]
        const components = pushed.a2uiMessages[0].surfaceUpdate.components
        expect(components[0].id).toBe('root')
        expect(components[0].component.Column.children.explicitList).toEqual(['s0', 's1', 's2'])
        expect(components[1].id).toBe('s0')
        expect(components[2].id).toBe('s1')
        expect(components[3].id).toBe('s2')
    })

    it('passes through surface metadata fields', async () => {
        const { tool, wsService } = makeTool()

        await tool.execute('call-6', {
            surface_id: 'meta-test',
            title: 'My Panel',
            summary: 'A summary',
            voice_line: 'Panel ready',
            surface_type: 'workspace',
            priority: 'high',
            collaborative: true,
            icon: 'MP',
            sections: [{ type: 'text', text: 'Body' }],
        })

        const pushed = wsService.pushKernelSurface.mock.calls[0][0]
        expect(pushed.title).toBe('My Panel')
        expect(pushed.summary).toBe('A summary')
        expect(pushed.voiceLine).toBe('Panel ready')
        expect(pushed.surfaceType).toBe('workspace')
        expect(pushed.priority).toBe('high')
        expect(pushed.collaborative).toBe(true)
        expect(pushed.icon).toBe('MP')
    })

    it('normalizes stringified sections from small models', async () => {
        const { tool, wsService } = makeTool()

        const sections = [
            { type: 'heading', text: 'Stringified Test' },
            { type: 'action', label: 'Click', action_id: 'test_click' },
        ]

        await tool.execute('call-str', {
            surface_id: 'string-normalize-test',
            sections: JSON.stringify(sections),
        })

        expect(wsService.pushKernelSurface).toHaveBeenCalledTimes(1)
        const pushed = wsService.pushKernelSurface.mock.calls[0][0]
        expect(pushed.surfaceId).toBe('string-normalize-test')
        expect(pushed.a2uiMessages[0].surfaceUpdate.components).toHaveLength(3)
    })

    it('returns error result when sections is empty', async () => {
        const { tool } = makeTool()

        const result = await tool.execute('call-7', {
            surface_id: 'empty-test',
            sections: [],
        })
        expect(result.isError).toBe(true)
        expect(result.content[0].text).toMatch(/non-empty array/)
    })

    it('returns error result for an unknown section type', async () => {
        const { tool } = makeTool()

        const result = await tool.execute('call-8', {
            surface_id: 'unknown-test',
            sections: [{ type: 'chart', data: [] }],
        })
        expect(result.isError).toBe(true)
        expect(result.content[0].text).toMatch(/unknown section type/)
    })

    it('extracts JSON array from string with trailing garbage', async () => {
        const { tool, wsService } = makeTool()

        const mangled = '[{"type":"heading","text":"Test"}], "action": "extra")'

        await tool.execute('call-mangle', {
            surface_id: 'mangle-test',
            sections: mangled,
        })

        expect(wsService.pushKernelSurface).toHaveBeenCalledTimes(1)
        const pushed = wsService.pushKernelSurface.mock.calls[0][0]
        expect(pushed.surfaceId).toBe('mangle-test')
        expect(pushed.a2uiMessages).toHaveLength(3)
    })
})
