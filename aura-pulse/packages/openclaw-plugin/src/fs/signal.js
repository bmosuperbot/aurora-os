import { writeFileSync } from 'node:fs'

/**
 * Touch the signal file so signal-watchers detect a change.
 *
 * @param {string} signalPath  Absolute path to the .signal file
 */
export function touchSignal(signalPath) {
    writeFileSync(signalPath, new Date().toISOString(), 'utf8')
}
