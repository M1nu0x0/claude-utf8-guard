import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { findProblems, reason, strings } from '../hooks/check.mjs'
import { COMMON_HANGUL } from '../hooks/hangul.mjs'
import { isFixed, isStale, readCache, refresh } from '../hooks/upstream.mjs'

// Not import.meta.dirname, which needs Node 20.11: the hooks support Node 18.
const HOOKS = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks')

// Runs a hook the way Claude Code does: JSON on stdin, the plugin's data folder and options in the environment.
function run(hook, input, { data, env = {} } = {}) {
  const e = { ...process.env, CLAUDE_PLUGIN_DATA: data, ...env }
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k]
  const r = spawnSync(process.execPath, [join(HOOKS, hook)], { input: JSON.stringify(input), encoding: 'utf8', env: e })
  assert.equal(r.status, 0, r.stderr)
  return r.stdout.trim() ? JSON.parse(r.stdout) : null
}

function withData(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'utf8-guard-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const kinds = problems => problems.map(p => p.kind)

// The broken words quoted in anthropics/claude-code#83033 and its comments, each beside what was meant.
const REPORTED = [
  ['점검도 완료된', '점깔도 완릷된'],
  ['코딩하기', '코딅하기'],
  ['멀쩡하게', '멀잩하게'],
  ['잡히지', '잡힐지'],
]

test('the table is exactly the 2,350 syllables EUC-KR encodes', () => {
  const bytes = []
  for (let lead = 0xb0; lead <= 0xc8; lead++) for (let trail = 0xa1; trail <= 0xfe; trail++) bytes.push(lead, trail)
  const decoded = new TextDecoder('euc-kr').decode(new Uint8Array(bytes))
  assert.equal(Array.from(COMMON_HANGUL).length, 2350)
  assert.equal(COMMON_HANGUL, decoded)
})

test('ordinary Korean, Japanese and Chinese pass', () => {
  for (const text of ['점검도 완료된 코드입니다.', '日本語の文章です。', '这是中文句子。', '這是繁體中文。', 'mixed 한글 and ASCII'])
    assert.deepEqual(findProblems('AskUserQuestion', { question: text }), [], text)
})

test('the broken syllables reported in #83033 are caught when they fall outside KS X 1001', () => {
  const caught = REPORTED.filter(([, broken]) => findProblems('TodoWrite', { todos: [{ content: broken }] }).length)
  assert.deepEqual(caught.map(([, b]) => b), ['점깔도 완릷된', '코딅하기', '멀잩하게'])
  // 힐 in 잡힐지 is a common syllable: a wrong digit that lands on a real word cannot be told apart.
  for (const [meant] of REPORTED) assert.deepEqual(findProblems('TodoWrite', { todos: [{ content: meant }] }), [], meant)
})

test('the reason names the syllable, its code point and the word around it', () => {
  const problems = findProblems('AskUserQuestion', { questions: [{ question: '점깔도 완릷된 상태인가요?' }] })
  assert.deepEqual(kinds(problems), ['rare-hangul'])
  assert.match(problems[0].items[0], /^릷 \(U\+B9B7\) in ".*완릷된.*"$/)
  assert.match(reason('AskUserQuestion', problems), /#83033[\s\S]*send the same call again unchanged/)
})

test('a lone surrogate is caught in every tool that writes, code included', () => {
  for (const tool of ['AskUserQuestion', 'Write', 'Bash', 'mcp__notion__update'])
    assert.deepEqual(kinds(findProblems(tool, { text: 'a\uD83Ab' }, { hangul: false })), ['lone-surrogate'], tool)
  // A pair is a real character.
  assert.deepEqual(findProblems('Write', { content: 'emoji 😀' }), [])
})

test('U+FFFD is caught', () => {
  assert.deepEqual(kinds(findProblems('Write', { content: '한�글' })), ['replacement'])
})

test('a \\uXXXX written out as text is caught outside code, and only when it stands for CJK', () => {
  assert.deepEqual(kinds(findProblems('AskUserQuestion', { question: '\\uc810\\uac80' })), ['literal-escape'])
  assert.match(findProblems('mcp__jira__edit', { body: 'x \\u3042 y' })[0].items[0], /\\u3042 \(あ\)/)
  // In code it can be meant, and outside CJK it is left alone.
  assert.deepEqual(findProblems('Write', { content: 'const s = "\\uc810"' }), [])
  assert.deepEqual(findProblems('Edit', { new_string: '"\\u200b"' }), [])
  assert.deepEqual(findProblems('AskUserQuestion', { question: 'zero width \\u200b' }), [])
})

test('tools that only read are not checked', () => {
  assert.deepEqual(findProblems('Grep', { pattern: '릷\uD83A' }), [])
})

test('the Korean check can be turned off; the others stay on', () => {
  assert.deepEqual(findProblems('TodoWrite', { todos: [{ content: '완릷된' }] }, { hangul: false }), [])
  assert.deepEqual(kinds(findProblems('TodoWrite', { todos: [{ content: '�' }] }, { hangul: false })), ['replacement'])
})

test('strings are collected from nested objects and arrays', () => {
  assert.deepEqual(strings({ a: ['x', { b: 'y' }], c: 1, d: null }), ['x', 'y'])
})

test('PreToolUse holds a broken call back once and lets the same call through the second time', () => {
  withData(data => {
    const input = { session_id: 's1', tool_name: 'AskUserQuestion', tool_input: { question: '완릷된' } }
    const first = run('pre-tool-use.mjs', input, { data })
    assert.equal(first.hookSpecificOutput.permissionDecision, 'deny')
    assert.match(first.hookSpecificOutput.permissionDecisionReason, /릷/)
    assert.match(first.systemMessage, /utf8-guard held back one AskUserQuestion call/)
    assert.equal(run('pre-tool-use.mjs', input, { data }), null)
    // A changed call is a new call.
    const changed = { ...input, tool_input: { question: '완릷된!' } }
    assert.equal(run('pre-tool-use.mjs', changed, { data }).hookSpecificOutput.permissionDecision, 'deny')
    // Another session starts over.
    assert.equal(run('pre-tool-use.mjs', { ...input, session_id: 's2' }, { data }).hookSpecificOutput.permissionDecision, 'deny')
  })
})

test('PreToolUse prints nothing for a clean call', () => {
  withData(data => {
    assert.equal(run('pre-tool-use.mjs', { session_id: 's', tool_name: 'Write', tool_input: { content: '정상 문장' } }, { data }), null)
    assert.equal(existsSync(join(data, 'held-s.txt')), false)
  })
})

test('PreToolUse reads the Korean option from CLAUDE_PLUGIN_OPTION_HANGUL_CHECK', () => {
  withData(data => {
    const input = { session_id: 's', tool_name: 'TodoWrite', tool_input: { todos: [{ content: '완릷된' }] } }
    assert.equal(run('pre-tool-use.mjs', input, { data, env: { CLAUDE_PLUGIN_OPTION_HANGUL_CHECK: 'false' } }), null)
    assert.notEqual(run('pre-tool-use.mjs', input, { data, env: { CLAUDE_PLUGIN_OPTION_HANGUL_CHECK: 'true' } }), null)
  })
})

// A cache that is fresh, so the hook does not start a refresh during the test.
const fresh = (state, stateReason) => ({ issue: 83033, state, stateReason, closedAt: '2026-12-01T00:00:00Z', checkedAt: new Date().toISOString() })

test('SessionStart adds the instruction for the model on every source', () => {
  withData(data => {
    writeFileSync(join(data, 'upstream.json'), JSON.stringify(fresh('open', null)))
    for (const source of ['startup', 'resume', 'clear', 'compact']) {
      const out = run('session-start.mjs', { source }, { data })
      assert.match(out.hookSpecificOutput.additionalContext, /as itself in UTF-8\. Never write it as a \\uXXXX escape/)
      assert.equal(out.systemMessage, undefined)
    }
  })
})

test('SessionStart tells the person at startup once the issue is closed as fixed', () => {
  withData(data => {
    writeFileSync(join(data, 'upstream.json'), JSON.stringify(fresh('closed', 'completed')))
    const out = run('session-start.mjs', { source: 'startup' }, { data })
    assert.match(out.systemMessage, /#83033 was closed as fixed on 2026-12-01.*claude plugin disable utf8-guard.*\/config/)
    assert.equal(run('session-start.mjs', { source: 'compact' }, { data }).systemMessage, undefined)
    const off = run('session-start.mjs', { source: 'startup' }, { data, env: { CLAUDE_PLUGIN_OPTION_UPSTREAM_CHECK: 'false' } })
    assert.equal(off.systemMessage, undefined)
  })
})

test('closed as not planned is not a fix, so it says nothing', () => {
  withData(data => {
    writeFileSync(join(data, 'upstream.json'), JSON.stringify(fresh('closed', 'not_planned')))
    assert.equal(run('session-start.mjs', { source: 'startup' }, { data }).systemMessage, undefined)
  })
})

test('SessionStart removes held-back lists older than a week', () => {
  withData(data => {
    writeFileSync(join(data, 'upstream.json'), JSON.stringify(fresh('open', null)))
    const old = join(data, 'held-old.txt'), recent = join(data, 'held-new.txt')
    writeFileSync(old, 'x\n')
    writeFileSync(recent, 'y\n')
    const eightDaysAgo = (Date.now() - 8 * 24 * 60 * 60 * 1000) / 1000
    utimesSync(old, eightDaysAgo, eightDaysAgo)
    run('session-start.mjs', { source: 'startup' }, { data })
    assert.deepEqual([existsSync(old), existsSync(recent)], [false, true])
  })
})

test('the cache is stale after a day, and only closed as completed counts as fixed', () => {
  const now = Date.parse('2026-11-03T00:00:00Z')
  assert.equal(isStale(null, now), true)
  assert.equal(isStale({ checkedAt: '2026-11-02T01:00:00Z' }, now), false)
  assert.equal(isStale({ checkedAt: '2026-11-01T23:00:00Z' }, now), true)
  assert.equal(isStale({ checkedAt: 'garbage' }, now), true)
  assert.equal(isFixed({ state: 'closed', stateReason: 'completed' }), true)
  assert.equal(isFixed({ state: 'closed', stateReason: 'not_planned' }), false)
  assert.equal(isFixed({ state: 'open', stateReason: null }), false)
})

// A local stand-in for the GitHub API.
async function withServer(handler, fn) {
  const server = createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  process.env.UTF8_GUARD_ISSUE_API = `http://127.0.0.1:${server.address().port}/issue`
  try {
    return await fn()
  } finally {
    delete process.env.UTF8_GUARD_ISSUE_API
    server.close()
  }
}

test('refresh writes the issue state, and a failed request keeps the last known state', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'utf8-guard-'))
  try {
    await withServer(
      (req, res) => res.end(JSON.stringify({ state: 'closed', state_reason: 'completed', closed_at: '2026-12-01T00:00:00Z' })),
      () => refresh(dir),
    )
    assert.equal(isFixed(readCache(dir)), true)
    await withServer((req, res) => { res.statusCode = 403; res.end('{}') }, () => refresh(dir))
    const cache = readCache(dir)
    assert.deepEqual([cache.state, cache.stateReason, cache.error], ['closed', 'completed', 'HTTP 403'])
    assert.equal(isStale(cache), false)
    assert.ok(JSON.parse(readFileSync(join(dir, 'upstream.json'), 'utf8')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
