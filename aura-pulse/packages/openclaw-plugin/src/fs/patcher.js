import { diff_match_patch } from 'diff-match-patch'

const MATCH_THRESHOLD   = 0.3  // Levenshtein tolerance (0 = exact, 1 = anything)
const MATCH_DISTANCE    = 500  // Character distance to search from expected location

/**
 * Apply a search-and-replace patch to text content.
 * Uses diff-match-patch to tolerate minor whitespace drift.
 *
 * Throws if the search block cannot be located with sufficient confidence.
 * This is an atomic failure — the original text is NEVER partially mutated.
 *
 * @param {string} original
 * @param {string} search
 * @param {string} replace
 * @returns {string}
 */
export function applyPatch(original, search, replace) {
    const dmp = new diff_match_patch()
    dmp.Match_Threshold = MATCH_THRESHOLD
    dmp.Match_Distance  = MATCH_DISTANCE

    const index = dmp.match_main(original, search, 0)
    if (index === -1) {
        throw new Error('Patch search block not found in file content')
    }

    // Verify the located region is a close match before committing
    const located = original.slice(index, index + search.length)
    const diffs   = dmp.diff_main(search, located)
    dmp.diff_cleanupSemantic(diffs)
    const levenshtein = dmp.diff_levenshtein(diffs)
    const maxEdits    = Math.ceil(search.length * MATCH_THRESHOLD)

    if (levenshtein > maxEdits) {
        throw new Error(`Patch search block match quality too low (${levenshtein} edits > ${maxEdits} allowed)`)
    }

    return original.slice(0, index) + replace + original.slice(index + located.length)
}

/**
 * Apply multiple ordered patches to a single text atomically.
 * If any patch fails, no changes are made.
 *
 * @param {string} original
 * @param {{ search: string, replace: string }[]} patches
 * @returns {string}
 */
export function applyPatches(original, patches) {
    let result = original
    for (const { search, replace } of patches) {
        result = applyPatch(result, search, replace)
    }
    return result
}
