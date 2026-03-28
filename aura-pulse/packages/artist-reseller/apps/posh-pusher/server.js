import Fastify from 'fastify'

const app = Fastify({ logger: true })
const port = Number(process.env['PORT'] ?? 3456)
const gatewayUrl = process.env['AURA_GATEWAY_URL'] ?? 'http://localhost:18789'
const hookPath = process.env['AURA_HOOK_PATH'] ?? 'wake'
const hookToken = process.env['OPENCLAW_HOOK_TOKEN'] ?? ''

app.get('/health', async () => ({ ok: true }))

app.post('/notify', async (request, reply) => {
    const payload = /** @type {Record<string, unknown>} */ (request.body ?? {})
    const response = await fetch(`${gatewayUrl}/hooks/${hookPath}`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            ...(hookToken ? { authorization: `Bearer ${hookToken}` } : {}),
        },
        body: JSON.stringify({
            path: 'posh-offer',
            platform: 'poshmark',
            ...payload,
        }),
    })

    if (!response.ok) {
        reply.code(502)
        return { ok: false, status: response.status }
    }

    return { ok: true }
})

await app.listen({ port, host: '0.0.0.0' })