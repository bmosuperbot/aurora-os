import { describe, expect, it, vi } from 'vitest'

import { buildRenderSurface } from '../../src/tools/aura-render-surface.js'

function buildCanonicalMessages(surfaceId = 'grant-radar-skill-test') {
    return [{
        surfaceUpdate: {
            surfaceId,
            components: [{
                id: 'root',
                component: {
                    Column: {
                        children: {
                            explicitList: ['body'],
                        },
                    },
                },
            }, {
                id: 'body',
                component: {
                    Text: {
                        text: {
                            literalString: 'Grant radar loaded.',
                        },
                    },
                },
            }],
        },
    }, {
        dataModelUpdate: {
            surfaceId,
            contents: [],
        },
    }, {
        beginRendering: {
            surfaceId,
            root: 'root',
            catalogId: 'https://aura-os.ai/a2ui/v1/aura-catalog.json',
        },
    }]
}

describe('buildRenderSurface', () => {
    it('pushes canonical A2UI messages to the websocket transport', async () => {
        const wsService = {
            pushKernelSurface: vi.fn(),
        }
        const tool = buildRenderSurface(wsService)

        const result = await tool.execute('call-1', {
            surface_id: 'grant-radar-skill-test',
            title: 'Grant Radar Skill Test',
            a2ui_messages: buildCanonicalMessages(),
        })

        expect(wsService.pushKernelSurface).toHaveBeenCalledTimes(1)
        expect(wsService.pushKernelSurface).toHaveBeenCalledWith(expect.objectContaining({
            surfaceId: 'grant-radar-skill-test',
            title: 'Grant Radar Skill Test',
        }))
        expect(result.content[0].text).toContain('"status":"rendered"')
    })

    it('parses stringified canonical A2UI arrays before validation', async () => {
        const wsService = {
            pushKernelSurface: vi.fn(),
        }
        const tool = buildRenderSurface(wsService)

        const result = await tool.execute('call-1', {
            surface_id: 'grant-radar-skill-test',
            title: 'Grant Radar Skill Test',
            a2ui_messages: JSON.stringify(buildCanonicalMessages()),
        })

        expect(wsService.pushKernelSurface).toHaveBeenCalledTimes(1)
        expect(wsService.pushKernelSurface).toHaveBeenCalledWith(expect.objectContaining({
            surfaceId: 'grant-radar-skill-test',
            a2uiMessages: buildCanonicalMessages(),
        }))
        expect(result.content[0].text).toContain('"status":"rendered"')
    })

    it('rejects pseudo-A2UI wrapper payloads', async () => {
        const wsService = {
            pushKernelSurface: vi.fn(),
        }
        const tool = buildRenderSurface(wsService)

        await expect(tool.execute('call-1', {
            surface_id: 'grant-radar-skill-test-3',
            title: 'Grant Radar Skill Test 3',
            a2ui_messages: [{
                type: 'a2ui.surfaceUpdate',
                title: 'Grant Radar Skill Test 3',
                summary: 'Follow Plan',
                message: 'Grant radar surface displayed.',
                rows: [['Loading...', 'OK']],
                data: {
                    message: 'Task table: Review, Check, Discuss.',
                },
            }, {
                type: 'a2ui.surfaceUpdate',
                messageId: '2',
                data: {
                    message: 'Grid complete.',
                },
            }],
        })).rejects.toThrow(/canonical A2UI message/)

        expect(wsService.pushKernelSurface).not.toHaveBeenCalled()
    })

    it('rejects object-map components instead of component arrays', async () => {
        const wsService = {
            pushKernelSurface: vi.fn(),
        }
        const tool = buildRenderSurface(wsService)

        await expect(tool.execute('call-1', {
            surface_id: 'grant-radar-skill-test-4',
            a2ui_messages: [{
                surfaceUpdate: {
                    surfaceId: 'grant-radar-skill-test-4',
                    components: {
                        root: {
                            component: {
                                Text: {
                                    value: 'Wrong shape',
                                },
                            },
                        },
                    },
                },
            }, {
                beginRendering: {
                    surfaceId: 'grant-radar-skill-test-4',
                    root: 'root',
                    catalogId: 'https://aura-os.ai/a2ui/v1/aura-catalog.json',
                },
            }],
        })).rejects.toThrow(/components must be a non-empty array/)

        expect(wsService.pushKernelSurface).not.toHaveBeenCalled()
    })

    it('rejects built-in Text nodes that use value instead of text', async () => {
        const wsService = {
            pushKernelSurface: vi.fn(),
        }
        const tool = buildRenderSurface(wsService)

        await expect(tool.execute('call-1', {
            surface_id: 'grant-radar-skill-test-5',
            a2ui_messages: [{
                surfaceUpdate: {
                    surfaceId: 'grant-radar-skill-test-5',
                    components: [{
                        id: 'root',
                        component: {
                            Column: {
                                children: {
                                    explicitList: ['headline'],
                                },
                            },
                        },
                    }, {
                        id: 'headline',
                        component: {
                            Text: {
                                value: 'Wrong built-in prop',
                            },
                        },
                    }],
                },
            }, {
                dataModelUpdate: {
                    surfaceId: 'grant-radar-skill-test-5',
                    contents: [],
                },
            }, {
                beginRendering: {
                    surfaceId: 'grant-radar-skill-test-5',
                    root: 'root',
                    catalogId: 'https://aura-os.ai/a2ui/v1/aura-catalog.json',
                },
            }],
        })).rejects.toThrow(/Do not use Text.value/)

        expect(wsService.pushKernelSurface).not.toHaveBeenCalled()
    })
})