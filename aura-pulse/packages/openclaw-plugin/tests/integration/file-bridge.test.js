/**
 * integration/file-bridge.test.js
 *
 * Tests the FS tool suite: read, write, patch, move, delete, archive, list, search.
 * Uses a real temp directory so path-jail and fs operations work end-to-end.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { makeMockRuntime } from '../../src/test-support/mock-runtime.js'

import { buildFsRead }    from '../../src/tools/aura-fs-read.js'
import { buildFsWrite }   from '../../src/tools/aura-fs-write.js'
import { buildFsPatch }   from '../../src/tools/aura-fs-patch.js'
import { buildFsMove }    from '../../src/tools/aura-fs-move.js'
import { buildFsDelete }  from '../../src/tools/aura-fs-delete.js'
import { buildFsList }    from '../../src/tools/aura-fs-list.js'
import { buildFsArchive } from '../../src/tools/aura-fs-archive.js'
import { buildFsSearch }  from '../../src/tools/aura-fs-search.js'
import { LockManager }    from '../../src/fs/locks.js'

const AGENT_ID = 'test-agent'
const fakeLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }

function makeEnv() {
    const root       = mkdtempSync(join(tmpdir(), 'aura-fs-test-'))
    const archiveDir = join(root, 'archive')
    const trashDir   = join(root, '.trash')
    const auraPaths  = {
        projectsDir:  root,
        signalPath:   join(root, '.signal'),
        para: {
            projects:  root,
            areas:     join(root, 'areas'),
            resources: join(root, 'resources'),
            archive:   archiveDir,
            trash:     trashDir,
        },
    }
    const { runtime, storage, store } = makeMockRuntime()
    const locks                = new LockManager(storage, fakeLogger)
    const cleanup              = () => rmSync(root, { recursive: true, force: true })
    return { root, auraPaths, runtime, storage, store, locks, cleanup }
}

describe('aura_fs_write + aura_fs_read', () => {
    let cleanup = () => {}
    afterEach(() => cleanup())

    it('writes a file and reads it back', async () => {
        const env = makeEnv()
        cleanup   = env.cleanup

        const write = buildFsWrite(env.auraPaths, env.locks, env.runtime, AGENT_ID)
        const read  = buildFsRead(env.auraPaths, env.locks)

        await write.execute('w1', { path: 'note.md', content: '# Hello\n' })
        const result = await read.execute('r1', { path: 'note.md' })
        expect(result.content[0].text).toBe('# Hello\n')
    })

    it('creates parent directories automatically', async () => {
        const env = makeEnv()
        cleanup   = env.cleanup

        const write = buildFsWrite(env.auraPaths, env.locks, env.runtime, AGENT_ID)
        const read  = buildFsRead(env.auraPaths, env.locks)

        await write.execute('w2', { path: 'projects/sub/deep/note.txt', content: 'deep' })
        const result = await read.execute('r2', { path: 'projects/sub/deep/note.txt' })
        expect(result.content[0].text).toBe('deep')
    })

    it('rejects path traversal in write', async () => {
        const env = makeEnv()
        cleanup   = env.cleanup

        const write = buildFsWrite(env.auraPaths, env.locks, env.runtime, AGENT_ID)
        await expect(write.execute('w3', { path: '../escape.txt', content: 'evil' })).rejects.toThrow()
    })

    it('logs an autonomous action after write', async () => {
        const env = makeEnv()
        cleanup   = env.cleanup

        const write = buildFsWrite(env.auraPaths, env.locks, env.runtime, AGENT_ID)
        await write.execute('w4', { path: 'logged.md', content: 'x' })
        expect(env.store.autonomousLog.length).toBeGreaterThan(0)
        const entry = env.store.autonomousLog[0]
        expect(entry?.action).toBe('fs_write')
        expect(entry?.agent_id).toBe(AGENT_ID)
    })
})

describe('aura_fs_patch', () => {
    let cleanup = () => {}
    afterEach(() => cleanup())

    it('applies a search/replace patch to an existing file', async () => {
        const env = makeEnv()
        cleanup   = env.cleanup

        writeFileSync(join(env.root, 'doc.md'), '# Title\n\nHello world\n', 'utf8')
        const patch = buildFsPatch(env.auraPaths, env.locks, env.runtime, AGENT_ID)
        await patch.execute('p1', {
            path:    'doc.md',
            patches: [{ search: 'Hello world', replace: 'Goodbye world' }],
        })
        const read   = buildFsRead(env.auraPaths, env.locks)
        const result = await read.execute('r-p1', { path: 'doc.md' })
        expect(result.content[0].text).toContain('Goodbye world')
    })

    it('throws when no match found', async () => {
        const env = makeEnv()
        cleanup   = env.cleanup

        writeFileSync(join(env.root, 'doc2.md'), 'content here', 'utf8')
        const patch = buildFsPatch(env.auraPaths, env.locks, env.runtime, AGENT_ID)
        await expect(patch.execute('p2', {
            path:    'doc2.md',
            patches: [{ search: 'not present at all', replace: 'x' }],
        })).rejects.toThrow()
    })
})

describe('aura_fs_move', () => {
    let cleanup = () => {}
    afterEach(() => cleanup())

    it('moves a file to a new location', async () => {
        const env = makeEnv()
        cleanup   = env.cleanup

        writeFileSync(join(env.root, 'old.md'), 'content', 'utf8')
        const move = buildFsMove(env.auraPaths, env.locks, env.runtime, AGENT_ID)
        await move.execute('mv1', { source: 'old.md', destination: 'new.md' })

        const read = buildFsRead(env.auraPaths, env.locks)
        const r    = await read.execute('rv1', { path: 'new.md' })
        expect(r.content[0].text).toBe('content')
    })

    it('rejects moving outside the jail', async () => {
        const env = makeEnv()
        cleanup   = env.cleanup

        writeFileSync(join(env.root, 'src.md'), 'x', 'utf8')
        const move = buildFsMove(env.auraPaths, env.locks, env.runtime, AGENT_ID)
        await expect(move.execute('mv2', { source: 'src.md', destination: '../outside.md' })).rejects.toThrow()
    })
})

describe('aura_fs_delete', () => {
    let cleanup = () => {}
    afterEach(() => cleanup())

    it('moves a file to .trash instead of hard-deleting', async () => {
        const env = makeEnv()
        cleanup   = env.cleanup

        writeFileSync(join(env.root, 'gone.md'), 'bye', 'utf8')
        const del = buildFsDelete(env.auraPaths, env.locks, env.runtime, AGENT_ID)
        await del.execute('d1', { path: 'gone.md' })

        // Original should be gone
        const read = buildFsRead(env.auraPaths, env.locks)
        await expect(read.execute('r-d1', { path: 'gone.md' })).rejects.toThrow()

        // .trash should contain the file
        const list    = buildFsList(env.auraPaths)
        const trashPaths = /** @type {any[]} */ (JSON.parse((await list.execute('l-d1', { path: '.trash' })).content[0].text))
        expect(trashPaths.some(e => e.name.includes('gone.md'))).toBe(true)
    })
})

describe('aura_fs_list', () => {
    let cleanup = () => {}
    afterEach(() => cleanup())

    it('lists files in a directory', async () => {
        const env = makeEnv()
        cleanup   = env.cleanup

        writeFileSync(join(env.root, 'a.md'), '', 'utf8')
        writeFileSync(join(env.root, 'b.md'), '', 'utf8')
        const list   = buildFsList(env.auraPaths)
        const result = await list.execute('l1', {})
        const parsed = /** @type {any[]} */ (JSON.parse(result.content[0].text))
        const names  = parsed.map(e => e.name)
        expect(names).toContain('a.md')
        expect(names).toContain('b.md')
    })
})

describe('aura_fs_search', () => {
    let cleanup = () => {}
    afterEach(() => cleanup())

    it('finds text inside files', async () => {
        const env = makeEnv()
        cleanup   = env.cleanup

        writeFileSync(join(env.root, 'needle.md'), '# Chapter\n\nfind me please\n', 'utf8')
        const search = buildFsSearch(env.auraPaths)
        const result = await search.execute('s1', { query: 'find me please' })
        const parsed = JSON.parse(result.content[0].text)
        expect(parsed.length).toBeGreaterThan(0)
        expect(parsed[0].text).toContain('find me please')
    })

    it('supports regex search', async () => {
        const env = makeEnv()
        cleanup   = env.cleanup

        writeFileSync(join(env.root, 'nums.md'), 'alpha\nbeta 123\ngamma\n', 'utf8')
        const search = buildFsSearch(env.auraPaths)
        const result = await search.execute('s2', { query: '\\d+', use_regex: true })
        const parsed = JSON.parse(result.content[0].text)
        expect(parsed.some(m => m.text.includes('123'))).toBe(true)
    })
})

describe('aura_fs_archive', () => {
    let cleanup = () => {}
    afterEach(() => cleanup())

    it('moves file from projects to archive', async () => {
        const env = makeEnv()
        cleanup   = env.cleanup

        writeFileSync(join(env.root, 'done.md'), 'archived', 'utf8')
        const archive = buildFsArchive(env.auraPaths, env.locks, env.runtime, AGENT_ID)
        await archive.execute('a1', { path: 'done.md' })

        // Original gone
        const read = buildFsRead(env.auraPaths, env.locks)
        await expect(read.execute('r-a1', { path: 'done.md' })).rejects.toThrow()
    })
})
