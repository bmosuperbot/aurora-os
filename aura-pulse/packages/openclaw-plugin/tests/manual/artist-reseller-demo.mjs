/**
 * Artist-reseller manual demo script.
 *
 * Connects to a live openclaw-plugin WebSocket, injects a synthetic
 * offer-received contract, and walks the full Resolver flow so a human
 * can verify end-to-end behaviour against real connectors.
 *
 * NOT run in CI.
 *
 * Usage:
 *   pnpm demo:artist
 *
 * Prerequisites:
 *   - openclaw-plugin running (pnpm start or inside openclaw)
 *   - WS_URL env var (default: ws://localhost:7701)
 *   - Gmail connector active (gog gmail configured)
 */

import WebSocket from 'ws'

const WS_URL = process.env.WS_URL ?? 'ws://localhost:7701'

const SYNTHETIC_OFFER = {
    type:    'offer-received',
    context: {
        platform:        'poshmark',
        listing_title:   'Vintage Levi 501 Denim Jacket',
        listing_price:   85,
        offer_amount:    60,
        buyer_id:        'buyer-demo-001',
        buyer_history:   'repeat buyer, 3 purchases, all 5-star',
        gmail_thread_id: 'thread-demo-manual-001',
        gmail_message_id: 'msg-demo-manual-001',
    },
}

function send(ws, msg) {
    ws.send(JSON.stringify(msg))
}

async function waitFor(ws, predicate, timeoutMs = 10_000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('waitFor timed out')), timeoutMs)
        ws.on('message', function handler(raw) {
            const msg = JSON.parse(raw.toString())
            if (predicate(msg)) {
                clearTimeout(timer)
                ws.off('message', handler)
                resolve(msg)
            }
        })
    })
}

async function run() {
    console.log(`Connecting to ${WS_URL} …`)
    const ws = new WebSocket(WS_URL)

    await new Promise((res, rej) => {
        ws.once('open', res)
        ws.once('error', rej)
    })
    console.log('Connected.')

    // Step 1: inject a synthetic offer contract
    console.log('\n[1] Injecting offer-received contract …')
    send(ws, { type: 'inject_contract', payload: SYNTHETIC_OFFER })

    // Step 2: wait for the decision surface card
    console.log('[2] Waiting for surface_update (decision) …')
    const decision = await waitFor(ws, (m) => m.type === 'surface_update' && m.payload?.card?.contract_type === 'offer-received')
    const { contractId, resumeToken } = decision.payload
    console.log(`    contractId: ${contractId}`)
    console.log(`    resumeToken: ${resumeToken}`)

    // Step 3: engage the Resolver
    console.log('\n[3] Engaging Resolver …')
    send(ws, { type: 'engage', payload: { contractId } })
    await waitFor(ws, (m) => m.type === 'surface_update' && m.payload?.resolver_active)
    console.log('    Resolver active.')

    // Step 4: resolve — counter at $70, send response via Gmail
    const counterAmount = 70
    console.log(`\n[4] Resolving: counter at $${counterAmount}, send_response=true …`)
    send(ws, {
        type:    'resolve',
        payload: {
            token:     resumeToken,
            action:    'counter',
            artifacts: {
                counter_amount: counterAmount,
                send_response:  true,
                response_body:  `Thanks for your offer! I can do $${counterAmount} — happy to bundle if you're interested.`,
            },
        },
    })

    // Step 5: wait for the clear (surface dismissed)
    console.log('[5] Waiting for surface clear …')
    await waitFor(ws, (m) => m.type === 'clear')
    console.log('    Surface cleared.')

    console.log('\nDemo complete. Check:')
    console.log('  • gog gmail reply was called with --thread-id thread-demo-manual-001')
    console.log('  • Engram received buyer_id:buyer-demo-001 + action:counter tags')
    console.log('  • autonomous_log contains email_response_sent entry')

    ws.close()
}

run().catch((err) => {
    console.error('Demo failed:', err.message)
    process.exit(1)
})
