# claude-utf8-guard

[![release](https://img.shields.io/github/v/release/M1nu0x0/claude-utf8-guard)](https://github.com/M1nu0x0/claude-utf8-guard/releases)
[![CI](https://github.com/M1nu0x0/claude-utf8-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/M1nu0x0/claude-utf8-guard/actions/workflows/ci.yml)
[![license](https://img.shields.io/github/license/M1nu0x0/claude-utf8-guard)](LICENSE)
[![anthropics/claude-code#83033](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/83033?label=anthropics%2Fclaude-code%2383033)](https://github.com/anthropics/claude-code/issues/83033)

[한국어](README.md) | **English** | [日本語](README.ja.md)

A Claude Code plugin that stops Claude from turning Korean, Japanese and Chinese in tool calls into wrong characters by writing them as `\uXXXX` escapes.

In tool calls such as AskUserQuestion, TodoWrite or a Notion or Jira MCP tool, Claude sometimes writes Korean as `\uXXXX` escapes instead of the characters. When it spells the hex wrong, the escape decodes to another real syllable, so nothing looks broken until someone reads it. Japanese is reported to break the same way, such as `揃え` written as `諿え` and `側` as the simplified Chinese `侧`. At session start this plugin tells Claude to write UTF-8, and before each tool call it holds the call back once if its text looks broken. When the upstream issue is fixed, it tells you at session start that you can turn it off.

**[Website](https://m1nu0x0.github.io/claude-utf8-guard/) · [Releases](https://github.com/M1nu0x0/claude-utf8-guard/releases) · [Changelog](CHANGELOG.md)**

| Tool input Claude wrote | What shows on screen |
| --- | --- |
| `{"content": "\uc810\uae54\ub3c4 \uc644\ub9b7\ub41c"}` (escapes, hex spelled wrong) | 점**깔**도 완**릷**된 |
| `{"content": "점검도 완료된"}` (UTF-8, as this plugin asks) | 점검도 완료된 |

## Why

Because of [anthropics/claude-code#83033](https://github.com/anthropics/claude-code/issues/83033) (*Sonnet 5 writes Korean tool-call parameters as \uXXXX escapes and mis-spells the hex*).

Its reporter compared runs made to write a Korean tool call as escapes with runs made to write it in UTF-8. Every run that wrote escapes, 45 of 45, broke some of its Hangul (about 3 to 5% of the syllables); the UTF-8 runs broke 1 of 30 and 0 of 30. The broken characters are all real Hangul, such as `점검` → `점깔` and `코딩` → `코딅`, so they do not stand out the way U+FFFD does. Comments report the same with Opus 5 and with Notion and Jira MCP write tools.

Japanese is affected too. [#54051](https://github.com/anthropics/claude-code/issues/54051) reported `揃え` → `諿え`, `処分` → `処勭`, `側` → `侧` and `億` → `亿` (both simplified Chinese) in Notion MCP calls, and [#59649](https://github.com/anthropics/claude-code/issues/59649) reported `叩き` → `鯰し`, `再起動` → `在控` and `鳴る` → `鳥る` in AskUserQuestion. Neither confirms that escapes caused them, so this plugin checks the result, not the cause.

The answer on the Claude Code side was that the CLI decodes the escapes faithfully and cannot repair a wrong code point, and that the issue went to the model team. Most other reports of the same symptom were closed without a fix (see Related issues). Once #83033 is closed as fixed this plugin is no longer needed, and the repository will be archived. The plugin checks #83033 at session start, and CI checks it every day.

## Install

At the Claude Code terminal prompt:

```
/plugin install utf8-guard --marketplace M1nu0x0/claude-utf8-guard
```

Answer `y` to `Add marketplace?` and choose the user scope. From a shell:

```sh
claude plugin install utf8-guard --marketplace M1nu0x0/claude-utf8-guard
```

In Claude Desktop, click `+` next to the prompt box → Plugins → Add marketplace, enter `M1nu0x0/claude-utf8-guard`, then add `utf8-guard`.

The hooks run on Node.js, so Node.js 18 or later must be on your `PATH`. It applies from the next session.

## How it works

1. **Session start (`SessionStart`)**: adds one instruction for Claude (`additionalContext`): write every non-ASCII character in a tool call as itself in UTF-8, never as a `\uXXXX` escape, except an escape that is part of code it is copying exactly (such as `"\u200b"` in a source file). This is the workaround #83033 verified. It is added again on startup, resume, clear and compact.
2. **Before a tool call (`PreToolUse`)**: checks every string in the input (table below). On a hit it denies the call, tells Claude which characters and where, and shows you one line (`systemMessage`). The same call sent again unchanged in the same session goes through, so a rare word you meant costs one round trip and never blocks the work.
3. **The upstream issue**: the session-start hook only reads a cache in the plugin's data folder (`CLAUDE_PLUGIN_DATA`), so it never waits on the network. When the cache is a day old, a background process asks the GitHub API for the state of #83033 once and saves it for the next session. When #83033 is closed as **completed**, a new session (startup) shows this. Closed as not planned or stale does not mean fixed, so it says nothing then.

   ```
   utf8-guard: anthropics/claude-code#83033 was closed as fixed on 2026-12-01 (...). If Claude no longer writes
   broken \uXXXX escapes, turn this plugin off with "claude plugin disable utf8-guard". To stop this notice, turn off
   "Notify when fixed upstream" in /config.
   ```

Claude Code decodes the JSON the model wrote before it hands the input to a hook. A hook therefore never sees the escape itself, only what it turned into, which is why the checks ask "does this look like a broken result" and not "was an escape written".

## What it catches and what it does not

| Symptom | Example | Check | This plugin |
| --- | --- | --- | --- |
| A wrong hex digit lands on a rare syllable | `완료` → `완릷`, `코딩` → `코딅`, `멀쩡` → `멀잩` | Hangul syllables outside the 2,350 of KS X 1001 (EUC-KR) | Catches about 70% of single wrong digits |
| A wrong kanji lands on a rare kanji | `揃え` → `諿え`, `処分` → `処勭`, `側` → `侧` (simplified) | In text with kana, kanji outside the 6,355 of JIS X 0208 (Shift_JIS) | Catches about 66% of single wrong digits. Text with no kana (which may be Chinese) is not checked |
| Half a surrogate pair | a lone `\uD83A`, which the API rejects with a 400 that stops the session | An unpaired U+D800 to U+DFFF | Catches |
| A failed decode | `한�글` | U+FFFD | Catches |
| An escape left as text | AskUserQuestion shows `\uc810\uac80` | `\uXXXX` text for Hangul, kana or CJK, in tools that are not code tools | Catches |
| A wrong hex digit lands on a common syllable | `잡히지` → `잡힐지`, `점검` → `점깔` | No way to tell | Does not; the instruction only prevents |
| A wrong kanji lands on a common kanji | `鳴る` → `鳥る`, `再起動` → `在控`, wrong hanzi in Chinese text | Another real character | Does not; the instruction only prevents |
| A glitch mid-escape breaks the JSON | #79339 | Claude Code rejects the call before any hook runs (#93311) | Does not; the instruction only prevents |
| A wrong syllable with no escape | `새벽` → `새벅` (#83033, 0.3 to 0.4% of runs) | Caught only outside KS X 1001 | Some |

The rare-syllable check also stops on real words such as `똠`, `햏`, `뷁` or `쌰`, and the kanji check on name kanji outside JIS X 0208. The 2010 joyo additions `剝`, `頰` and `塡`, and `髙`, common in names, are allowed in advance. Claude then reads why and sends the same call again, which goes through, or you can turn this one check off below. Tools that only read, such as Read, Glob and Grep, are not checked. In tools that handle code, such as Write, Edit and Bash, a `\uXXXX` written as text is taken as meant and not checked.

## Settings and turning it off

Change them under utf8-guard in `/config` (or `/plugin`). They are saved under `pluginConfigs` in `settings.json`.

| Setting | Default | When off |
| --- | --- | --- |
| Notify when fixed upstream (`upstream_check`) | On | Does not ask GitHub, and shows no notice when the issue is fixed |
| Check Korean syllables (`hangul_check`) | On | Only the rare-syllable check stops; the surrogate, U+FFFD and escape-as-text checks and the session-start instruction stay |
| Check Japanese kanji (`kanji_check`) | On | Only the rare-kanji check in Japanese text stops |

To turn the whole plugin off run `claude plugin disable utf8-guard`; to remove it, `claude plugin uninstall utf8-guard`.

## Related issues

Badges show each issue's current state (open/closed).

**The cause**

| Issue | State | What |
| --- | --- | --- |
| [anthropics/claude-code#83033](https://github.com/anthropics/claude-code/issues/83033) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/83033?label=) | Claude writes Korean tool-call parameters as `\uXXXX` and spells the hex wrong. The reason for this plugin, and the condition for removing it |

**Reports of the same symptom**

| Issue | State | What |
| --- | --- | --- |
| [anthropics/claude-code#80009](https://github.com/anthropics/claude-code/issues/80009) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/80009?label=) | Corrupted Korean syllables in AskUserQuestion input, confirmed in the session log. #83033 names the same cause |
| [anthropics/claude-code#78996](https://github.com/anthropics/claude-code/issues/78996) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/78996?label=) | Long Korean sessions degrade into ill-formed Hangul. #83033 names the same cause |
| [anthropics/claude-code#57981](https://github.com/anthropics/claude-code/issues/57981) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/57981?label=) | Wrong but valid Korean syllables in AskUserQuestion, now and then |
| [anthropics/claude-code#53665](https://github.com/anthropics/claude-code/issues/53665) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/53665?label=) | Korean garbled in tool_use JSON parameters on Opus 4.7 |
| [anthropics/claude-code#82588](https://github.com/anthropics/claude-code/issues/82588) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/82588?label=) | Opus 5 writes wrong Hangul syllables |
| [anthropics/claude-code#79339](https://github.com/anthropics/claude-code/issues/79339) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/79339?label=) | A `\` and a raw CJK character in the middle of an escape make the whole tool input unparsable |
| [anthropics/claude-code#61670](https://github.com/anthropics/claude-code/issues/61670) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/61670?label=) | A lone `\uD83A` and garbled Korean in AskUserQuestion end the session |
| [anthropics/claude-code#69522](https://github.com/anthropics/claude-code/issues/69522) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/69522?label=) | Long escaped tool arguments fail to parse as JSON |
| [anthropics/claude-code#54051](https://github.com/anthropics/claude-code/issues/54051) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/54051?label=) | Wrong kanji, some simplified Chinese, in Japanese written through Notion MCP tools (`揃え` → `諿え`, `側` → `侧`). Escapes are only a guess at the cause |
| [anthropics/claude-code#56003](https://github.com/anthropics/claude-code/issues/56003) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/56003?label=) | Japanese shown as raw `\uXXXX` in AskUserQuestion |
| [anthropics/claude-code#78568](https://github.com/anthropics/claude-code/issues/78568) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/78568?label=) | Wrong characters in Traditional Chinese output |
| [anthropics/claude-code#59649](https://github.com/anthropics/claude-code/issues/59649) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/59649?label=) | Similar-looking but wrong kanji in AskUserQuestion (`叩き` → `鯰し`, `再起動` → `在控`); the reporter saw no escapes (Opus 4.7) |

**The same escapes, from a tool**

These are bugs in Claude Code's tools, not the model. This plugin cannot fix them; they are why code tools are left out of the escape-as-text check.

| Issue | State | What |
| --- | --- | --- |
| [anthropics/claude-code#99361](https://github.com/anthropics/claude-code/issues/99361) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/99361?label=) | When old_string matches only in its escaped form, Edit writes every non-ASCII character in `new_string` as `\uXXXX` |
| [anthropics/claude-code#72957](https://github.com/anthropics/claude-code/issues/72957) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/72957?label=) | Write and Edit decode `\uXXXX` in file content |

**What a hook cannot see**

| Issue | State | What |
| --- | --- | --- |
| [anthropics/claude-code#93311](https://github.com/anthropics/claude-code/issues/93311) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/93311?label=) | A call rejected at input validation never reaches PreToolUse, which is why a hook cannot catch cases like #79339 |
| [anthropics/claude-code#96285](https://github.com/anthropics/claude-code/issues/96285) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/96285?label=) | Hook stdin is UTF-8, but Python hooks on Windows read it as ANSI and break Korean. This plugin reads it as UTF-8 |

If you find another related issue, tell us in an issue or a PR.

## Layout

```
.claude-plugin/
  marketplace.json      lists this repository as a marketplace
plugins/utf8-guard/
  .claude-plugin/
    plugin.json         plugin manifest, with two userConfig options
  hooks/
    hooks.json          SessionStart and PreToolUse hooks (exec form, node)
    session-start.mjs   adds the instruction, the fixed notice, starts the background check
    pre-tool-use.mjs    holds back a call that fails a check, once
    check.mjs           the checks (pure functions)
    hangul.mjs          the 2,350 Hangul syllables of KS X 1001
    kanji.mjs           the 6,355 kanji of JIS X 0208
    upstream.mjs        the #83033 state cache and the GitHub request
    common.mjs          reading the input, options, the data folder
  tests/                tests for node --test
.github/ci/
  engine-session-start.sh  checks the SessionStart hook with the real Claude Code, without a login
site/                   GitHub Pages site (Astro): src/site.json translations, src/pages/ page
package.json, tsconfig.json  type check for the hooks and tests (tsc --checkJs)
README.en.md, README.ja.md  README translations
```

The plugin lives in `plugins/utf8-guard/` and the marketplace points at it by relative path, because claude.ai's Add marketplace does not always accept a repository whose root is the plugin.

## Development

```sh
claude plugin validate .                     # marketplace
claude plugin validate plugins/utf8-guard     # plugin
npm ci && npm run typecheck                 # type check the hooks and tests (JSDoc, tsc --checkJs)
node --test 'plugins/utf8-guard/tests/*.test.mjs'
bash .github/ci/engine-session-start.sh      # SessionStart hook with the real Claude Code, without a login
cd site && npm ci && npm run build           # build and check the site (site/dist)
cd site && npm run dev                        # local preview
cd site && npm run og                         # per-language link-preview images (needs Playwright)
```

`hooks/hangul.mjs` was made by decoding the EUC-KR bytes B0A1 to C8FE, and `hooks/kanji.mjs` the EUC-JP bytes B0A1 to F4FE; the tests make it again the same way and compare.

The hooks are JavaScript (`.mjs`) that Claude Code runs with `node` as they are, so there is no build step and they run on Node 18. Every file has `// @ts-check` and JSDoc types instead, and `npm run typecheck` checks them with `tsc` under `strict`. TypeScript is a dev dependency, not something installing the plugin fetches.

The site is built with [Astro](https://astro.build) and the shared kit [claude-plugin-site](https://github.com/M1nu0x0/claude-plugin-site). All its words are in `site/src/site.json`, and the order of the sections is in `site/src/pages/[...lang].astro`. `npm run build` writes one page per language (`/`, `/ko/`, `/ja/`) and `sitemap.xml`, then checks them as a crawler reads them (title and description length, canonical, hreflang, Open Graph, JSON-LD, broken links and images, HTML validity) and fails on any problem. A merge to main builds and deploys it with the Pages workflow. The page's JSON-LD carries the plugin version, so a version bump redeploys the site. When the words change, set `updated` in `site/src/site.json` to that day; CI warns on a pull request that does not. When `ask`, `answer`, `ogImageLine` or `ogImageText` change, redraw `site/public/images/og*.png` with `npm run og` and commit them.

To release, merge a PR that bumps `version` in `plugins/utf8-guard/.claude-plugin/plugin.json`, then create a `vX.Y.Z` Release with the same version. When the tag is created, CI checks that it matches `version`.

## Limits

- Claude Code only. The hooks need Node.js 18 or later; without Node the hooks fail and check nothing (calls are not blocked).
- Claude may not follow the session-start instruction. The hooks only see the result, so a wrong character that is itself common, and wrong hanzi in Chinese text, get through.
- The PreToolUse hook starts one Node process for every tool call.
- The upstream check calls the GitHub API once a day without authentication. When it fails, the last known state is kept and it tries again a day later.

## License

MIT
