import { mkdirSync } from 'node:fs'

/**
 * @import { AuraPaths } from '../config/paths.js'
 */

/**
 * Idempotently create the PARA directory scaffold for the given paths.
 * Called on first service startup. Safe to call multiple times.
 *
 * @param {AuraPaths} paths
 * @returns {void}
 */
export function bootstrapPara(paths) {
    const roots = paths.para
    mkdirSync(roots.projects,  { recursive: true })
    mkdirSync(roots.areas,     { recursive: true })
    mkdirSync(roots.resources, { recursive: true })
    mkdirSync(roots.archive,   { recursive: true })
    mkdirSync(roots.trash,     { recursive: true })
}
