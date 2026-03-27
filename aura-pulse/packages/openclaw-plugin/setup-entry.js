import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createReadStream, statSync } from 'node:fs'

/**
 * @import { OpenClawPluginApi } from './src/types/plugin-types.d.ts'
 * @import { ContractStorage }   from '@aura/contract-runtime'
 */

const __dirname = dirname(fileURLToPath(import.meta.url))

const MIME_MAP = /** @type {Record<string, string>} */ ({
    '.html': 'text/html',
    '.js':   'application/javascript',
    '.css':  'text/css',
    '.json': 'application/json',
    '.ico':  'image/x-icon',
    '.png':  'image/png',
    '.svg':  'image/svg+xml',
})

/**
 * Register the static Pulse HTTP route with the OpenClaw gateway.
 * Serves the built PWA files from staticDir under /pulse/*.
 *
 * @param {OpenClawPluginApi} api
 * @param {string | null} [staticDirOverride]
 * @returns {void}
 */
export function registerStaticRoute(api, staticDirOverride) {
    const staticDir = staticDirOverride ?? join(__dirname, 'public')
    const staticRoot = resolve(staticDir)

    api.registerHttpRoute({
        path: '/pulse',
        auth: 'plugin',
        match: 'prefix',
        handler(req, res) {
            const r   = /** @type {any} */ (req)
            const w   = /** @type {any} */ (res)
            const rawUrl = /** @type {string} */ (r.url ?? '/pulse/index.html')
            const pathname = rawUrl.split('?')[0]?.split('#')[0] ?? '/pulse/index.html'

            const relPath = (pathname.replace(/^\/pulse/, '') || '/index.html').replace(/^\//, '')
            const ext     = relPath.match(/\.[^.]+$/)?.[0] ?? ''
            const mime    = MIME_MAP[ext] ?? 'application/octet-stream'
            const filePath = resolve(staticRoot, relPath)
            const rel = relative(staticRoot, filePath)
            if (rel.startsWith('..') || rel.startsWith('/')) {
                w.writeHead(403, { 'Content-Type': 'text/plain' })
                w.end('Forbidden')
                return
            }

            try {
                const stat = statSync(filePath)
                if (!stat.isFile()) throw new Error('not a file')
                w.writeHead(200, {
                    'Content-Type':  mime,
                    'Cache-Control': 'no-cache',
                })
                createReadStream(filePath).pipe(w)
            } catch {
                w.writeHead(200, { 'Content-Type': 'text/html' })
                w.end('<html><body><h1>Aura Pulse</h1><p>Phase 3 PWA coming soon.</p></body></html>')
            }
        },
    })
}

/**
 * Register the GET /aura/history JSON route with the OpenClaw gateway.
 * Returns paginated completed and failed contracts from storage.
 *
 * Query params: limit (default 50, max 200), offset (default 0), type (optional)
 *
 * @param {OpenClawPluginApi} api
 * @param {ContractStorage} storage
 * @returns {void}
 */
export function registerHistoryRoute(api, storage) {
    api.registerHttpRoute({
        path: '/aura/history',
        auth: 'plugin',
        match: 'exact',
        async handler(req, res) {
            const r = /** @type {any} */ (req)
            const w = /** @type {any} */ (res)

            try {
                const rawUrl     = /** @type {string} */ (r.url ?? '/aura/history')
                const qs         = new URL(rawUrl, 'http://localhost').searchParams
                const limit      = Math.min(Math.max(parseInt(qs.get('limit')  ?? '50', 10), 1), 200)
                const offset     = Math.max(parseInt(qs.get('offset') ?? '0', 10), 0)
                const typeFilter = qs.get('type') ?? undefined

                const filter = /** @type {any} */ ({
                    status: ['complete', 'failed'],
                    ...(typeFilter ? { type: typeFilter } : {}),
                })

                const all     = await storage.query(filter)
                const page    = all.slice(offset, offset + limit)
                const hasMore = offset + page.length < all.length

                w.writeHead(200, {
                    'Content-Type':                'application/json',
                    'Cache-Control':               'no-store',
                    'Access-Control-Allow-Origin': '*',
                })
                w.end(JSON.stringify({ contracts: page, hasMore, total: all.length }))
            } catch {
                w.writeHead(500, { 'Content-Type': 'application/json' })
                w.end(JSON.stringify({ error: 'internal_error' }))
            }
        },
    })
}
