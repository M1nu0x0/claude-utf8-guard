// @ts-check
// What the PreToolUse hook looks for in a tool call's input. Pure functions, so the tests call them directly.
//
// Claude Code hands the hook the input after it has decoded the model's JSON, so a \uXXXX escape the model wrote
// has already become a character here. The hook cannot see the escape, only what it turned into: a lone surrogate,
// U+FFFD, a Hangul syllable Korean text almost never uses, a kanji Japanese text almost never uses, or, when the
// model escaped the backslash too, the escape itself as text. The two character checks look at the result, so they
// also catch a wrong character the model wrote without any escape.
import { COMMON_HANGUL } from './hangul.mjs'
import { COMMON_KANJI } from './kanji.mjs'

const COMMON = new Set(COMMON_HANGUL)

// JIS X 0208 plus the kanji Japanese text uses that it lacks: three of the 2010 joyo additions (剝 頰 塡; the fourth,
// 𠮟, is outside the BMP and never checked) and 髙, common in names.
const COMMON_JA = new Set(COMMON_KANJI + '剝頰塡髙')

// Tools whose input is code or a shell command, where a literal \uXXXX in the text can be meant.
const CODE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell'])

// Tools that only look things up: nothing in their input is written or sent anywhere.
const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'WebSearch', 'ToolSearch'])

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g
const HANGUL_SYLLABLE = /[\uAC00-\uD7A3]/g
const LITERAL_ESCAPE = /\\u([0-9a-fA-F]{4})/g
const KANJI = /[\u4E00-\u9FFF]/g
// Hiragana or katakana: the string is Japanese, so its kanji can be checked against JIS X 0208. A string of hanzi
// with no kana may be Chinese, where simplified and traditional forms outside JIS are normal, so it is left alone.
const KANA = /[\u3041-\u3096\u30A1-\u30FA]/

// Hangul, CJK ideographs, kana and CJK punctuation: what a literal \uXXXX should never stand for in plain text.
/** @param {number} cp */
const isCjk = cp =>
  (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x3000 && cp <= 0x30ff) ||
  (cp >= 0x3130 && cp <= 0x318f) || (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x4e00 && cp <= 0x9fff) ||
  (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xff00 && cp <= 0xffef)

/** @param {string} c */
const hex = c => 'U+' + /** @type {number} */ (c.codePointAt(0)).toString(16).toUpperCase().padStart(4, '0')

// Every string value in the input, however deeply nested (AskUserQuestion and MCP tools nest them).
/** @param {unknown} value @param {string[]} [out] @returns {string[]} */
export function strings(value, out = []) {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) for (const v of value) strings(v, out)
  else if (value && typeof value === 'object') for (const v of Object.values(value)) strings(v, out)
  return out
}

// A few characters either side of a match, so the model can find the word it broke.
/** @param {string} text @param {number} index @param {number} length */
function around(text, index, length) {
  const chars = Array.from(text.slice(Math.max(0, index - 6), index + length + 6))
  return chars.join('').replace(/\s+/g, ' ').trim()
}

/**
 * @typedef {'lone-surrogate' | 'replacement' | 'literal-escape' | 'rare-hangul' | 'rare-kanji'} Kind
 * @typedef {{ kind: Kind, items: string[] }} Problem
 */

// Returns a list of { kind, items } for the problems in one tool call's input; an empty list means let it through.
/**
 * @param {string} toolName
 * @param {unknown} input
 * @param {{ hangul?: boolean, kanji?: boolean }} [options]
 * @returns {Problem[]}
 */
export function findProblems(toolName, input, { hangul = true, kanji = true } = {}) {
  if (READ_TOOLS.has(toolName)) return []
  const texts = strings(input)
  /** @type {Problem[]} */
  const problems = []

  const lone = new Map()
  for (const t of texts) for (const m of t.matchAll(LONE_SURROGATE)) lone.set(hex(m[0]), around(t, m.index, 1))
  if (lone.size) problems.push({ kind: 'lone-surrogate', items: [...lone].map(([c, at]) => `${c} near "${at}"`) })

  const fffd = new Map()
  for (const t of texts) for (let i = t.indexOf('\uFFFD'); i !== -1; i = t.indexOf('\uFFFD', i + 1)) fffd.set(around(t, i, 1), true)
  if (fffd.size) problems.push({ kind: 'replacement', items: [...fffd.keys()].map(at => `U+FFFD in "${at}"`) })

  if (!CODE_TOOLS.has(toolName)) {
    const literal = new Map()
    for (const t of texts)
      for (const m of t.matchAll(LITERAL_ESCAPE)) {
        const cp = parseInt(m[1], 16)
        if (isCjk(cp)) literal.set(m[0], String.fromCodePoint(cp))
      }
    if (literal.size) problems.push({ kind: 'literal-escape', items: [...literal].map(([e, c]) => `${e} (${c})`) })
  }

  if (hangul) {
    const rare = new Map()
    for (const t of texts)
      for (const m of t.matchAll(HANGUL_SYLLABLE)) if (!COMMON.has(m[0])) rare.set(m[0], around(t, m.index, 1))
    if (rare.size) problems.push({ kind: 'rare-hangul', items: [...rare].map(([c, at]) => `${c} (${hex(c)}) in "${at}"`) })
  }

  if (kanji) {
    const rare = new Map()
    for (const t of texts) {
      if (!KANA.test(t)) continue
      for (const m of t.matchAll(KANJI)) if (!COMMON_JA.has(m[0])) rare.set(m[0], around(t, m.index, 1))
    }
    if (rare.size) problems.push({ kind: 'rare-kanji', items: [...rare].map(([c, at]) => `${c} (${hex(c)}) in "${at}"`) })
  }

  return problems
}

/** @type {Record<Kind, string>} */
const HEADINGS = {
  'lone-surrogate': 'Half of a UTF-16 surrogate pair, which the API rejects and which can stop the session',
  replacement: 'The replacement character U+FFFD, left where a character failed to decode',
  'literal-escape': 'A \\uXXXX escape written out as text instead of the character it stands for',
  'rare-hangul': 'Hangul syllables Korean text almost never uses, the usual result of a \\uXXXX escape with a wrong hex digit',
  'rare-kanji': 'Kanji in Japanese text that are outside JIS X 0208, such as a simplified Chinese form or a rare neighbour of the intended character',
}

// The reason the model reads when the call is held back.
/** @param {string} toolName @param {Problem[]} problems @returns {string} */
export function reason(toolName, problems) {
  const lines = [`utf8-guard held this ${toolName} call back once. Its input may contain broken characters, often from a \\uXXXX escape with a wrong hex digit (anthropics/claude-code#83033):`]
  for (const p of problems) lines.push(`- ${HEADINGS[p.kind]}: ${p.items.slice(0, 8).join(', ')}${p.items.length > 8 ? ', ...' : ''}`)
  lines.push(
    'Check those characters against what you meant, then send the call again with every non-ASCII character written as itself in UTF-8, never as a \\uXXXX escape.',
    'If the input is already exactly what you meant, send the same call again unchanged and it will go through.',
  )
  return lines.join('\n')
}

// One line for the person, so a held-back call is not a surprise.
/** @param {string} toolName @param {Problem[]} problems @returns {string} */
export function notice(toolName, problems) {
  const first = problems.map(p => p.items[0].split(' ')[0]).slice(0, 3).join(', ')
  return `utf8-guard held back one ${toolName} call for suspicious characters (${first}); Claude will check and resend it.`
}
