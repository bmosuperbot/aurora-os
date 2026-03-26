import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { makeTempRuntime } from '../helpers/temp-db.js'

describe('connector state', () => {
    let storage, cleanup
    beforeEach(async () => {
        ;({ storage, cleanup } = makeTempRuntime())
        await storage.initialize()
    })
    afterEach(async () => { await storage.close(); cleanup() })

    function makeConnector(overrides = {}) {
        return {
            id: 'etsy',
            source: 'aura-connector',
            status: 'not-offered',
            capability_without: 'Agent cannot watch Etsy listings.',
            capability_with: 'Agent watches listings and surfaces price alerts.',
            never_resurface: false,
            updated_at: new Date().toISOString(),
            ...overrides,
        }
    }

    it('writes and reads a connector roundtrip', async () => {
        const c = makeConnector()
        await storage.writeConnector(c)
        const result = await storage.readConnector('etsy')
        expect(result?.id).toBe('etsy')
        expect(result?.status).toBe('not-offered')
        expect(result?.never_resurface).toBe(false)
    })

    it('upsert updates status on second write', async () => {
        await storage.writeConnector(makeConnector())
        const updated = makeConnector({ status: 'active', connected_at: new Date().toISOString() })
        await storage.writeConnector(updated)
        const result = await storage.readConnector('etsy')
        expect(result?.status).toBe('active')
        expect(result?.connected_at).toBeTruthy()
    })

    it('readConnectors returns all connectors', async () => {
        await storage.writeConnector(makeConnector({ id: 'etsy' }))
        await storage.writeConnector(makeConnector({ id: 'poshmark', source: 'aura-connector' }))
        const all = await storage.readConnectors()
        expect(all.length).toBe(2)
        expect(all.map(c => c.id).sort()).toEqual(['etsy', 'poshmark'])
    })

    it('readConnector returns null for unknown id', async () => {
        expect(await storage.readConnector('unknown')).toBeNull()
    })

    it('stores never_resurface as boolean not integer', async () => {
        await storage.writeConnector(makeConnector({ never_resurface: true }))
        const result = await storage.readConnector('etsy')
        expect(result?.never_resurface).toBe(true)
        expect(typeof result?.never_resurface).toBe('boolean')
    })

    it('stores optional encrypted token fields', async () => {
        const connector = makeConnector({
            id: 'gmail-agent',
            source: 'openclaw-channel',
            status: 'active',
            oauth_token_enc: 'enc:abc123',
            refresh_token_enc: 'enc:def456',
            expires_at: new Date(Date.now() + 3600_000).toISOString(),
        })
        await storage.writeConnector(connector)
        const result = await storage.readConnector('gmail-agent')
        expect(result?.oauth_token_enc).toBe('enc:abc123')
        expect(result?.refresh_token_enc).toBe('enc:def456')
        expect(result?.expires_at).toBeTruthy()
    })
})
