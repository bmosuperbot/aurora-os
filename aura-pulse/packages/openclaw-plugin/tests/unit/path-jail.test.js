import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { jailPath, tryJailPath } from '../../src/fs/path-jail.js'

function makeTempDir() {
    return mkdtempSync(join(tmpdir(), 'aura-jail-test-'))
}

describe('jailPath', () => {
    it('resolves a simple relative path within the root', () => {
        const root = makeTempDir()
        try {
            const result = jailPath(root, 'projects/note.md')
            expect(result).toBe(join(root, 'projects', 'note.md'))
        } finally {
            rmSync(root, { recursive: true, force: true })
        }
    })

    it('throws on path traversal with ..', () => {
        const root = makeTempDir()
        try {
            expect(() => jailPath(root, '../etc/passwd')).toThrow()
        } finally {
            rmSync(root, { recursive: true, force: true })
        }
    })

    it('throws on deeply nested traversal', () => {
        const root = makeTempDir()
        try {
            expect(() => jailPath(root, 'a/b/../../../../../../etc/hosts')).toThrow()
        } finally {
            rmSync(root, { recursive: true, force: true })
        }
    })

    it('allows nested paths that stay within root', () => {
        const root = makeTempDir()
        try {
            const result = jailPath(root, 'a/b/c/../../d/file.txt')
            expect(result).toBe(join(root, 'a', 'd', 'file.txt'))
        } finally {
            rmSync(root, { recursive: true, force: true })
        }
    })

    it('rejects symlinks pointing outside root', () => {
        const root   = makeTempDir()
        const outer  = makeTempDir()
        try {
            mkdirSync(join(root, 'sub'), { recursive: true })
            symlinkSync(outer, join(root, 'sub', 'link'))
            expect(() => jailPath(root, 'sub/link/secret.txt')).toThrow()
        } finally {
            rmSync(root, { recursive: true, force: true })
            rmSync(outer, { recursive: true, force: true })
        }
    })
})

describe('tryJailPath', () => {
    it('returns the resolved path on success', () => {
        const root = makeTempDir()
        try {
            const result = tryJailPath(root, 'file.md')
            expect(result).toBe(join(root, 'file.md'))
        } finally {
            rmSync(root, { recursive: true, force: true })
        }
    })

    it('returns null on traversal instead of throwing', () => {
        const root = makeTempDir()
        try {
            const result = tryJailPath(root, '../escape.txt')
            expect(result).toBeNull()
        } finally {
            rmSync(root, { recursive: true, force: true })
        }
    })
})
