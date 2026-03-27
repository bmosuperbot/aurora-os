/**
 * integration/connector.test.js
 *
 * Tests the full connector request → approval → decrypt round-trip
 * using the mock runtime + mock WebSocket service.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { makeMockStorage } from '../../src/test-support/mock-runtime.js'
import { buildQueryConnections }   from '../../src/tools/aura-query-connections.js'
import { buildRequestConnection }  from '../../src/tools/aura-request-connection.js'

function makeMockWs() {
    return { pushConnectorRequest: vi.fn() }
}

describe('Connector tools', () => {
    afterEach(() => vi.restoreAllMocks())

    it('aura_request_connection persists connector as pending', async () => {
        const { storage } = makeMockStorage()
        const ws          = makeMockWs()
        const tool        = buildRequestConnection(storage, ws)

        await tool.execute('call-1', {
            connector_id: 'github',
            display_name: 'GitHub',
            scopes:       ['repo'],
            reason:       'Need to read repos',
        })

        const connectors = await storage.readConnectors()
        expect(connectors).toHaveLength(1)
        expect(connectors[0]?.id).toBe('github')
        expect(connectors[0]?.status).toBe('pending')
    })

    it('aura_request_connection broadcasts to connected surfaces', async () => {
        const { storage } = makeMockStorage()
        const ws          = makeMockWs()
        const tool        = buildRequestConnection(storage, ws)

        await tool.execute('call-2', {
            connector_id: 'notion',
            display_name: 'Notion',
            reason:       'Access notes',
        })

        expect(ws.pushConnectorRequest).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'notion' })
        )
    })

    it('aura_query_connections returns connectors without encrypted token fields', async () => {
        const { storage, store } = makeMockStorage()
        store.connectors.set('linear', {
            id: 'linear',
            source: 'aura-connector',
            status: 'active',
            capability_without: 'without',
            capability_with: 'with',
            updated_at: new Date().toISOString(),
            oauth_token_enc: 'REDACT-ME',
            refresh_token_enc: 'REDACT-REFRESH',
        })

        const tool   = buildQueryConnections(storage)
        const result = await tool.execute('call-3', {})
        const parsed = JSON.parse(result.content[0].text)

        expect(parsed).toHaveLength(1)
        expect(parsed[0]).not.toHaveProperty('oauth_token_enc')
        expect(parsed[0]).not.toHaveProperty('refresh_token_enc')
        expect(parsed[0]?.id).toBe('linear')
    })

    it('aura_query_connections filters by status', async () => {
        const { storage, store } = makeMockStorage()
        store.connectors.set('a', { id: 'a', status: 'active' })
        store.connectors.set('b', { id: 'b', status: 'pending' })

        const tool   = buildQueryConnections(storage)
        const result = await tool.execute('call-4', { status: 'active' })
        const parsed = JSON.parse(result.content[0].text)

        expect(parsed).toHaveLength(1)
        expect(parsed[0]?.id).toBe('a')
    })
})
