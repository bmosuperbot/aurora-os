import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY_LEN   = 32
const IV_LEN    = 12
const TAG_LEN   = 16

/**
 * Derive a 256-bit key from the operator-provided master key string.
 * Uses scrypt with a fixed salt embedded in the ciphertext so decryption
 * remains deterministic across restarts while avoiding plain key storage.
 *
 * @param {string} masterKey
 * @param {Buffer} salt
 * @returns {Buffer}
 */
function deriveKey(masterKey, salt) {
    return scryptSync(masterKey, salt, KEY_LEN)
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns a base64 string: salt(16) + iv(12) + tag(16) + ciphertext.
 *
 * @param {string} plaintext
 * @param {string} masterKey
 * @returns {string}
 */
export function encrypt(plaintext, masterKey) {
    const salt = randomBytes(16)
    const iv   = randomBytes(IV_LEN)
    const key  = deriveKey(masterKey, salt)

    const cipher = createCipheriv(ALGORITHM, key, iv)
    const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const tag    = cipher.getAuthTag()

    return Buffer.concat([salt, iv, tag, enc]).toString('base64')
}

/**
 * Decrypt a base64 ciphertext produced by encrypt().
 *
 * @param {string} ciphertext
 * @param {string} masterKey
 * @returns {string}
 */
export function decrypt(ciphertext, masterKey) {
    const buf     = Buffer.from(ciphertext, 'base64')
    const salt    = buf.subarray(0, 16)
    const iv      = buf.subarray(16, 16 + IV_LEN)
    const tag     = buf.subarray(16 + IV_LEN, 16 + IV_LEN + TAG_LEN)
    const payload = buf.subarray(16 + IV_LEN + TAG_LEN)

    const key      = deriveKey(masterKey, salt)
    const decipher = createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(tag)

    return decipher.update(payload) + decipher.final('utf8')
}
