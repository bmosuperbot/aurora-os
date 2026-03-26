import { randomUUID } from 'node:crypto'

/** Token lifetime: 24 hours */
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000

/**
 * @import { ResumeToken } from './resume-token.js'
 */

/**
 * Generate a new single-use resume token.
 * @returns {ResumeToken}
 */
export function generateResumeToken() {
    return {
        token: randomUUID(),
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
    }
}

/**
 * Check whether a token's expiry has passed.
 *
 * @param {string} expiresAt - ISO-8601
 * @returns {boolean}
 */
export function isTokenExpired(expiresAt) {
    return new Date(expiresAt) < new Date()
}
