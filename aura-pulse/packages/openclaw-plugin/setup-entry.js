import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createReadStream, statSync } from 'node:fs'

/**
 * @import { OpenClawPluginApi } from './src/types/plugin-types.js'
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
 * Serves a placeholder index.html for Phase 2. Full Vue 3 PWA belongs to Phase 3.
 *
 * Uses auth: "plugin" so Aura manages its own session validation.
 * Uses match: "prefix" so all paths under /pulse/* are served.
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

            // Strip the /pulse prefix
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
