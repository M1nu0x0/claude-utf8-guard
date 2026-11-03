// What both hooks share: reading the hook input, the user's options, and where the plugin keeps its files.
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The hook input is UTF-8 JSON on stdin. Read it as UTF-8 explicitly: on Windows the default would be the ANSI
// code page, which turns Korean into mojibake before the hook even looks at it (anthropics/claude-code#96285).
export async function readInput() {
  process.stdin.setEncoding('utf8')
  let text = ''
  for await (const chunk of process.stdin) text += chunk
  return text.trim() ? JSON.parse(text) : {}
}

// userConfig options reach a hook as CLAUDE_PLUGIN_OPTION_<KEY>. Unset means the default, which is on.
export function option(key) {
  const value = process.env[`CLAUDE_PLUGIN_OPTION_${key.toUpperCase()}`]
  if (value === undefined || value.trim() === '') return true
  return !/^(false|0|no|off)$/i.test(value.trim())
}

// CLAUDE_PLUGIN_DATA survives plugin updates; without it (an older Claude Code) a folder in the temp directory.
export function dataDir() {
  const dir = process.env.CLAUDE_PLUGIN_DATA || join(tmpdir(), 'utf8-guard')
  mkdirSync(dir, { recursive: true })
  return dir
}

export const print = value => process.stdout.write(JSON.stringify(value) + '\n')
