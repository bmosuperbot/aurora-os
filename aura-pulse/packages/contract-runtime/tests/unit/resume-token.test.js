import { describe, it, expect } from 'vitest'
import { generateResumeToken, isTokenExpired } from '../../src/runtime/resume-token.js'

describe('generateResumeToken', () => {
    it('returns a token and expiresAt', () => {
        const result = generateResumeToken()
        expect(result.token).toBeTruthy()
        expect(result.expiresAt).toBeTruthy()
    })

    it('token matches UUID v4 format', () => {
        const { token } = generateResumeToken()
        expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    })

    it('expiresAt is approximately 24 hours from now', () => {
        const before = Date.now()
        const { expiresAt } = generateResumeToken()
        const after = Date.now()
        const exp = new Date(expiresAt).getTime()
        expect(exp).toBeGreaterThanOrEqual(before + 23 * 60 * 60 * 1000)
        expect(exp).toBeLessThanOrEqual(after + 25 * 60 * 60 * 1000)
    })

    it('generates unique tokens on every call', () => {
        const tokens = new Set(Array.from({ length: 100 }, () => generateResumeToken().token))
        expect(tokens.size).toBe(100)
    })
})

describe('isTokenExpired', () => {
    it('returns false for a future expiry', () => {
        const future = new Date(Date.now() + 60_000).toISOString()
        expect(isTokenExpired(future)).toBe(false)
    })

    it('returns true for a past expiry', () => {
        const past = new Date(Date.now() - 1000).toISOString()
        expect(isTokenExpired(past)).toBe(true)
    })
})
