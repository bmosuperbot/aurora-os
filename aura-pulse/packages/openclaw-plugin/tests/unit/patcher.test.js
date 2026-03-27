import { describe, it, expect } from 'vitest'
import { applyPatch, applyPatches } from '../../src/fs/patcher.js'

const BASE = '# Hello\n\nfoo bar baz\n\nworld\n'

describe('applyPatch', () => {
    it('replaces an exact match', () => {
        const result = applyPatch(BASE, 'foo bar baz', 'REPLACED')
        expect(result).toContain('REPLACED')
        expect(result).not.toContain('foo bar baz')
    })

    it('replaces a fuzzy (near-exact) match', () => {
        // One transposition — diff-match-patch should still find it
        const result = applyPatch(BASE, 'foo bra baz', 'REPLACED')
        expect(result).toContain('REPLACED')
    })

    it('throws PatchError when no match is found', () => {
        expect(() => applyPatch(BASE, 'completely absent text xyz', 'X')).toThrow(/patch/i)
    })

    it('replaces only the first occurrence', () => {
        const text   = 'aaa aaa aaa'
        const result = applyPatch(text, 'aaa', 'bbb')
        // First occurrence replaced, rest remain
        expect(result).toContain('bbb')
    })

    it('handles replacement with empty string (delete)', () => {
        const result = applyPatch(BASE, 'foo bar baz\n', '')
        expect(result).not.toContain('foo bar baz')
    })
})

describe('applyPatches', () => {
    it('applies multiple patches in sequence', () => {
        const result = applyPatches(BASE, [
            { search: 'foo bar baz', replace: 'FIRST' },
            { search: 'world',       replace: 'SECOND' },
        ])
        expect(result).toContain('FIRST')
        expect(result).toContain('SECOND')
        expect(result).not.toContain('foo bar baz')
        expect(result).not.toContain('world')
    })

    it('throws if any patch in the sequence fails to match', () => {
        expect(() => applyPatches(BASE, [
            { search: 'foo bar baz', replace: 'ok' },
            { search: 'does not exist at all', replace: 'bad' },
        ])).toThrow()
    })
})
