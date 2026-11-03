// @ts-check
// The state of anthropics/claude-code#83033, the bug this plugin works around, cached in the plugin's data folder.
// The SessionStart hook only reads the cache, so a session never waits on the network. When the cache is a day old
// it starts this file as a background process, which asks GitHub once and writes the answer for the next session.
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const ISSUE = 83033
export const ISSUE_URL = `https://github.com/anthropics/claude-code/issues/${ISSUE}`
const DAY_MS = 24 * 60 * 60 * 1000

// UTF8_GUARD_ISSUE_API exists for the tests, which point it at a local server.
const api = () => process.env.UTF8_GUARD_ISSUE_API || `https://api.github.com/repos/anthropics/claude-code/issues/${ISSUE}`

/**
 * What the cache file holds. state and stateReason are GitHub's; error is the last failed request's.
 * @typedef {{ issue: number, state?: string, stateReason?: string | null, closedAt?: string | null, checkedAt: string, error?: string }} Cache
 */

/** @param {string} dir */
export const cacheFile = dir => join(dir, 'upstream.json')

/** @param {string} dir @returns {Cache | null} */
export function readCache(dir) {
  try {
    return JSON.parse(readFileSync(cacheFile(dir), 'utf8'))
  } catch {
    return null
  }
}

// No checkedAt, or one that does not parse, gives NaN, which is never less than a day: stale.
/** @param {Partial<Cache> | null} cache @param {number} [now] @returns {boolean} */
export const isStale = (cache, now = Date.now()) => !cache || !(now - Date.parse(cache.checkedAt ?? '') < DAY_MS)

// Closed as completed is the only state that means fixed. Closed as not planned or stale says nothing about the bug.
/** @param {Partial<Cache> | null} cache @returns {boolean} */
export const isFixed = cache => cache?.state === 'closed' && cache?.stateReason === 'completed'

// Asks GitHub and writes the cache. A failed request still records when it tried, so it waits a day before the
// next try; the last known state is kept.
/** @param {string} dir @param {Date} [now] @returns {Promise<Cache>} */
export async function refresh(dir, now = new Date()) {
  const before = readCache(dir) ?? {}
  /** @type {Cache} */
  let next
  try {
    const res = await fetch(api(), {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'utf8-guard' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const issue = await res.json()
    next = { issue: ISSUE, state: issue.state, stateReason: issue.state_reason ?? null, closedAt: issue.closed_at ?? null, checkedAt: now.toISOString() }
  } catch (err) {
    next = { ...before, issue: ISSUE, checkedAt: now.toISOString(), error: String(/** @type {Error | undefined} */ (err)?.message ?? err) }
  }
  const tmp = cacheFile(dir) + '.tmp'
  writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n')
  renameSync(tmp, cacheFile(dir))
  return next
}

// node upstream.mjs <data dir>: the background refresh.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await refresh(/** @type {string} */ (process.argv[2]))
