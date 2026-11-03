// PreToolUse: holds a tool call back once when its input looks broken by a \uXXXX escape, and tells the model why.
// The same call sent again unchanged goes through, so a rare syllable that was meant (a name, slang) costs one
// round trip and never blocks the work.
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { findProblems, notice, reason } from './check.mjs'
import { dataDir, option, print, readInput } from './common.mjs'

const input = await readInput()
const tool = input.tool_name ?? ''
const problems = findProblems(tool, input.tool_input ?? {}, { hangul: option('hangul_check') })
if (problems.length === 0) process.exit(0)

// Calls held back in this session, one hash per line.
const session = String(input.session_id ?? 'no-session').replace(/[^\w-]/g, '_')
const file = join(dataDir(), `held-${session}.txt`)
const key = createHash('sha256').update(tool).update('\0').update(JSON.stringify(input.tool_input ?? {})).digest('hex')
const held = existsSync(file) ? readFileSync(file, 'utf8').split('\n') : []

// Sent again unchanged: the model has looked and means it.
if (held.includes(key)) process.exit(0)

appendFileSync(file, key + '\n')
print({
  systemMessage: notice(tool, problems),
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: reason(tool, problems),
  },
})
