// @ts-check
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
import { COMMON_KANJI } from '../hooks/kanji.mjs'
import { isFixed, isStale, readCache, refresh } from '../hooks/upstream.mjs'

// Not import.meta.dirname, which needs Node 20.11: the hooks support Node 18.
const HOOKS = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks')

// Runs a hook the way Claude Code does: JSON on stdin, the plugin's data folder and options in the environment.
/**
 * @param {string} hook
 * @param {Record<string, unknown>} input
 * @param {{ data?: string, env?: NodeJS.ProcessEnv }} [options]
 * @returns {any} the hook's JSON output, or null when it printed nothing
 */
function run(hook, input, { data, env = {} } = {}) {
  /** @type {NodeJS.ProcessEnv} */
  const e = { ...process.env, CLAUDE_PLUGIN_DATA: data, ...env }
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k]
  const r = spawnSync(process.execPath, [join(HOOKS, hook)], { input: JSON.stringify(input), encoding: 'utf8', env: e })
  assert.equal(r.status, 0, r.stderr)
  return r.stdout.trim() ? JSON.parse(r.stdout) : null
}

/** @template T @param {(dir: string) => T} fn @returns {T} */
function withData(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'utf8-guard-'))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** @param {import('../hooks/check.mjs').Problem[]} problems */
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

// Wrong kanji reported in anthropics/claude-code#54051 (Notion MCP) and #59649 (AskUserQuestion), each beside what
// was meant, in a sentence with kana so the check knows it is Japanese.
const REPORTED_JA = [
  ['表記を揃えますか', '表記を諿えますか'],
  ['処分しますか', '処勭しますか'],
  ['側に寄せますか', '侧に寄せますか'],
  ['1億を超えますか', '1亿を超えますか'],
  ['嬉しいですか', '嫌しいですか'],
  ['付いてくる', '跟いてくる'],
  ['モグラ叩きですか', 'モグラ鯰しですか'],
  ['再起動しますか', '在控しますか'],
  ['鳴るノイズですか', '鳥るノイズですか'],
]

test('the JIS X 0208 table is exactly the 6,355 kanji EUC-JP encodes in levels 1 and 2', () => {
  const bytes = []
  for (let lead = 0xb0; lead <= 0xf4; lead++) for (let trail = 0xa1; trail <= 0xfe; trail++) bytes.push(lead, trail)
  const decoded = Array.from(new TextDecoder('euc-jp').decode(new Uint8Array(bytes))).filter(c => {
    const cp = /** @type {number} */ (c.codePointAt(0))
    return cp >= 0x4e00 && cp <= 0x9fff
  })
  assert.equal(Array.from(COMMON_KANJI).length, 6355)
  assert.deepEqual(new Set(COMMON_KANJI), new Set(decoded))
})

test('the wrong kanji reported for Japanese are caught when they fall outside JIS X 0208', () => {
  const caught = REPORTED_JA.filter(([, broken]) => findProblems('AskUserQuestion', { question: broken }).length)
  assert.deepEqual(caught.map(([, b]) => b), ['表記を諿えますか', '処勭しますか', '侧に寄せますか', '1亿を超えますか'])
  // 嫌, 跟, 鯰, 在控 and 鳥 are kanji Japanese uses: a wrong character that is itself common cannot be told apart.
  for (const [meant] of REPORTED_JA) assert.deepEqual(findProblems('AskUserQuestion', { question: meant }), [], meant)
  assert.match(findProblems('AskUserQuestion', { question: '表記を諿えますか' })[0].items[0], /^諿 \(U\+8AFF\) in ".*諿.*"$/)
})

test('kanji are checked only in text with kana, so Chinese is left alone', () => {
  for (const text of ['这是简体中文，包括侧和亿。', '這是繁體中文。', '侧亿'])
    assert.deepEqual(findProblems('mcp__notion__update', { content: text }), [], text)
})

test('kanji Japanese uses that JIS X 0208 lacks pass: 2010 joyo additions and 髙', () => {
  assert.deepEqual(findProblems('AskUserQuestion', { question: '剝がす、頰、装塡、髙橋さん' }), [])
})

test('the Japanese check can be turned off; the Korean one does not depend on it', () => {
  assert.deepEqual(findProblems('AskUserQuestion', { question: '表記を諿えますか' }, { kanji: false }), [])
  assert.deepEqual(kinds(findProblems('AskUserQuestion', { question: '완릷된' }, { kanji: false })), ['rare-hangul'])
})

test('the hook sources keep escapes as escapes, not the characters they stand for', () => {
  // A tool that decodes \uXXXX in file content (anthropics/claude-code#72957) once wrote U+FFFD and Hangul ranges
  // into check.mjs as raw characters. They worked, but nobody could read them.
  for (const file of ['check.mjs', 'common.mjs', 'pre-tool-use.mjs', 'session-start.mjs', 'upstream.mjs']) {
    const code = readFileSync(join(HOOKS, file), 'utf8')
    assert.doesNotMatch(code, /[\uFFFD\u200B]/, file)
    assert.doesNotMatch(code, /\/\[[^\]\x00-\x7F]/, `${file}: a regular expression class starts with a raw character`)
  }
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
  assert.deepEqual(kinds(findProblems('Write', { content: '한\uFFFD글' })), ['replacement'])
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
  assert.deepEqual(kinds(findProblems('TodoWrite', { todos: [{ content: '\uFFFD' }] }, { hangul: false })), ['replacement'])
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
/** @param {string} state @param {string | null} stateReason */
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
/** @template T @param {import('node:http').RequestListener} handler @param {() => Promise<T>} fn @returns {Promise<T>} */
async function withServer(handler, fn) {
  const server = createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(undefined)))
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address())
  process.env.UTF8_GUARD_ISSUE_API = `http://127.0.0.1:${port}/issue`
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
    assert.ok(cache)
    assert.deepEqual([cache.state, cache.stateReason, cache.error], ['closed', 'completed', 'HTTP 403'])
    assert.equal(isStale(cache), false)
    assert.ok(JSON.parse(readFileSync(join(dir, 'upstream.json'), 'utf8')))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
