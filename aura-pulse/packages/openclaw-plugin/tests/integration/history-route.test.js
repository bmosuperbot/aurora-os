import { describe, expect, it, vi } from 'vitest'

import { registerHistoryRoute } from '../../setup-entry.js'

function createResponseCapture() {
    let statusCode = 0
    let headers = {}
    let body = ''

    return {
        writeHead(code, nextHeaders) {
            statusCode = code
            headers = nextHeaders
        },
        end(chunk = '') {
            body = String(chunk)
        },
        getResult() {
            return { statusCode, headers, body }
        },
    }
}

describe('registerHistoryRoute', () => {
    it('registers the history route and returns paginated results from storage', async () => {
        /** @type {import('../../src/types/plugin-types.d.ts').RegisteredHttpRoute | null} */
        let route = null
        const api = {
            registerHttpRoute(params) {
                route = params
            },
        }
        const storage = {
            query: vi.fn(async () => ([
                {
                    id: 'offer-1',
                    type: 'offer-received',
                    status: 'complete',
                    intent: { goal: 'Approve the freelance design offer' },
                    clarifications: [],
                    created_at: '2026-03-27T10:00:00.000Z',
                    updated_at: '2026-03-27T10:10:00.000Z',
                },
                {
                    id: 'offer-2',
                    type: 'offer-received',
                    status: 'failed',
                    intent: { goal: 'Decline the backup vendor offer' },
                    clarifications: [],
                    created_at: '2026-03-27T11:00:00.000Z',
                    updated_at: '2026-03-27T11:10:00.000Z',
                },
            ])),
        }

        registerHistoryRoute(api, storage)

        expect(route).toBeTruthy()
        expect(route.path).toBe('/aura/history')
        expect(route.auth).toBe('plugin')
        expect(route.match).toBe('exact')

        const res = createResponseCapture()
        await route.handler({ url: '/aura/history?limit=1&offset=1&type=offer-received' }, res)

        expect(storage.query).toHaveBeenCalledWith({
            status: ['complete', 'failed'],
            type: 'offer-received',
        })

        const result = res.getResult()
        expect(result.statusCode).toBe(200)
        expect(result.headers['Content-Type']).toBe('application/json')

        const payload = JSON.parse(result.body)
        expect(payload.total).toBe(2)
        expect(payload.hasMore).toBe(false)
        expect(payload.contracts).toHaveLength(1)
        expect(payload.contracts[0].id).toBe('offer-2')
    })

    it('returns an internal_error payload when storage query fails', async () => {
        /** @type {import('../../src/types/plugin-types.d.ts').RegisteredHttpRoute | null} */
        let route = null
        const api = {
            registerHttpRoute(params) {
                route = params
            },
        }
        const storage = {
            query: vi.fn(async () => {
                throw new Error('boom')
            }),
        }

        registerHistoryRoute(api, storage)

        const res = createResponseCapture()
        await route.handler({ url: '/aura/history' }, res)

        const result = res.getResult()
        expect(result.statusCode).toBe(500)
        expect(JSON.parse(result.body)).toEqual({ error: 'internal_error' })
    })
})