import { describe, it, expect } from 'vitest'
import { encrypt, decrypt } from '../../src/connectors/crypto.js'

const MASTER_KEY = 'super-secret-master-key-for-testing-only'

describe('encrypt / decrypt', () => {
    it('round-trips a plaintext string', () => {
        const plaintext = 'my-super-secret-token'
        const ciphertext = encrypt(plaintext, MASTER_KEY)
        expect(ciphertext).not.toBe(plaintext)
        expect(decrypt(ciphertext, MASTER_KEY)).toBe(plaintext)
    })

    it('produces different ciphertexts for the same plaintext (random IV)', () => {
        const pt  = 'same-plaintext'
        const ct1 = encrypt(pt, MASTER_KEY)
        const ct2 = encrypt(pt, MASTER_KEY)
        expect(ct1).not.toBe(ct2)
        // Both should decrypt correctly
        expect(decrypt(ct1, MASTER_KEY)).toBe(pt)
        expect(decrypt(ct2, MASTER_KEY)).toBe(pt)
    })

    it('throws on ciphertext tampered in the auth tag', () => {
        const ct     = encrypt('sensitive', MASTER_KEY)
        const bytes  = Buffer.from(ct, 'base64')
        // Auth tag starts at byte 28: salt(16) + iv(12)
        bytes[28] = bytes[28] ^ 0xff
        const tampered = bytes.toString('base64')
        expect(() => decrypt(tampered, MASTER_KEY)).toThrow()
    })

    it('throws on a completely invalid ciphertext', () => {
        expect(() => decrypt('not-a-valid-ciphertext', MASTER_KEY)).toThrow()
    })

    it('throws when decrypting with a different master key', () => {
        const ct = encrypt('secret', MASTER_KEY)
        expect(() => decrypt(ct, 'wrong-key')).toThrow()
    })

    it('handles empty-string plaintext', () => {
        const ct = encrypt('', MASTER_KEY)
        expect(decrypt(ct, MASTER_KEY)).toBe('')
    })

    it('handles unicode / multi-byte plaintext', () => {
        const pt = '日本語テスト 🌸 — aura'
        const ct = encrypt(pt, MASTER_KEY)
        expect(decrypt(ct, MASTER_KEY)).toBe(pt)
    })
})
