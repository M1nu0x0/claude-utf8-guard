// SessionStart: tells the model to write non-ASCII text in tool calls as UTF-8, never as \uXXXX escapes, and tells
// the person when the upstream bug is fixed so they can turn this plugin off.
import { spawn } from 'node:child_process'
import { readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { dataDir, option, print, readInput } from './common.mjs'
import { ISSUE, ISSUE_URL, isFixed, isStale, readCache } from './upstream.mjs'

// The workaround the reporter of anthropics/claude-code#83033 verified: every run told to write literal UTF-8 kept
// its Hangul intact, and every run that wrote escapes broke some of it.
const INSTRUCTION =
  'When a tool-call parameter contains Korean, Japanese, Chinese or any other non-ASCII text, write each character ' +
  'as itself in UTF-8. Never write it as a \\uXXXX escape: hand-written escapes have turned into wrong characters ' +
  `(anthropics/claude-code#${ISSUE}). An escape that is part of code or data you are copying exactly, such as ` +
  '"\\u200b" in a source file, stays as it is.'

function fixedNotice(cache) {
  const when = cache.closedAt ? ` on ${cache.closedAt.slice(0, 10)}` : ''
  return (
    `utf8-guard: anthropics/claude-code#${ISSUE} was closed as fixed${when} (${ISSUE_URL}). ` +
    'If Claude no longer writes broken \\uXXXX escapes, turn this plugin off with "claude plugin disable utf8-guard". ' +
    'To stop this notice, turn off "Notify when fixed upstream" in /config.'
  )
}

const input = await readInput()
const dir = dataDir()
const out = { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: INSTRUCTION } }

if (option('upstream_check')) {
  const cache = readCache(dir)
  // Once per session, not again on resume, clear or compact.
  if ((input.source ?? 'startup') === 'startup' && isFixed(cache)) out.systemMessage = fixedNotice(cache)
  if (isStale(cache)) {
    const upstream = join(fileURLToPath(new URL('.', import.meta.url)), 'upstream.mjs')
    spawn(process.execPath, [upstream, dir], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  }
}

// The PreToolUse hook's per-session lists of held-back calls; a week is longer than any session.
for (const name of readdirSync(dir)) {
  const file = join(dir, name)
  if (name.startsWith('held-') && Date.now() - statSync(file).mtimeMs > 7 * 24 * 60 * 60 * 1000) rmSync(file, { force: true })
}

print(out)
