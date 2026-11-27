# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Removed

- The Hangul check, which held back a tool call with a syllable outside the 2,350 of KS X 1001, and its "Check Korean syllables" option (`hangul_check`) and `hooks/hangul.mjs`. Every Hangul syllable is valid UTF-8, and real Korean uses syllables outside that table (똠방각하, 샾, 쏼라쏼라, 햏자, names such as 이믜), so the check held back correct text in every tool, Write and Edit included. Wrong syllables are left to the session-start instruction to prevent, and a test now checks that all 11,172 syllables pass
- The kanji check, which held back a tool call when text with kana had a kanji outside the 6,355 of JIS X 0208, and its "Check Japanese kanji" option (`kanji_check`) and `hooks/kanji.mjs`, for the same reason: Japanese uses kanji outside that table (森鷗外, 噓, 俱楽部, 繫がり, 任俠, names such as 濵田 and 德川). Wrong kanji are left to the session-start instruction to prevent, and a test now checks that every kanji U+4E00-U+9FFF passes in text with kana. The hook now holds back only broken text: half a surrogate pair, U+FFFD, and a `\uXXXX` written out as text outside code

### Changed

- The related-issues lists in the READMEs and on the site track 8 more anthropics/claude-code issues: wrong syllables or characters in AskUserQuestion and TodoWrite (#88132, #89117, #80415, #92588), a lone surrogate that bricks a session (#68325), and tool-side escape bugs (#64479, #108385, #109775)
- The site uses [claude-plugin-site](https://github.com/M1nu0x0/claude-plugin-site) v0.1.1, whose code is now type checked; the pages it builds are the same
- Dependabot waits 7 days after a release before proposing an update (`cooldown: default-days: 7`), so a malicious release that is pulled within a week never reaches a pull request; security updates skip the wait

### Fixed

- The Japanese page's link-preview description (`og:description`), also the line on the hub page's card, spoke only of Korean; it now says Japanese or Korean, like the rest of the Japanese page

## [0.1.0] - 2026-11-03

### Added

- A SessionStart hook that tells Claude to write every non-ASCII character in a tool call as itself in UTF-8, never as a `\uXXXX` escape, the workaround verified in [anthropics/claude-code#83033](https://github.com/anthropics/claude-code/issues/83033)
- A PreToolUse hook that holds a tool call back once when its input has a Hangul syllable outside the 2,350 of KS X 1001, a kanji outside the 6,355 of JIS X 0208 in text with kana (wrong kanji such as 諿 for 揃 and simplified Chinese forms such as 侧 for 側, reported in [#54051](https://github.com/anthropics/claude-code/issues/54051)), half a surrogate pair, U+FFFD, or, outside code tools, a `\uXXXX` for Hangul, kana or CJK written out as text; it tells Claude which characters and where, shows one line to the person, and lets the same call through when it is sent again unchanged
- Once a day, in the background, the session-start hook asks GitHub whether #83033 is closed as completed, and when it is, says at session start that the plugin can be turned off
- Three options in `/config`: "Notify when fixed upstream", "Check Korean syllables" and "Check Japanese kanji", all on by default
- `// @ts-check` and JSDoc types in every hook and test, checked in CI by `tsc` under `strict` (`checkJs`, no emit); the hooks stay JavaScript with no build step
- Tests under Node 18 and 24, and CI on Ubuntu, Windows and macOS that validates the marketplace and the plugin, runs the tests, and starts the real Claude Code without a login to check that the SessionStart hook runs; it runs daily against the latest Claude Code and reports the state of #83033
- A check that a release tag matches the plugin's version, and Dependabot updates for GitHub Actions and the site
- GitHub Pages site and READMEs in Korean, English and Japanese, with every related upstream issue and its live state

[Unreleased]: https://github.com/M1nu0x0/claude-utf8-guard/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/M1nu0x0/claude-utf8-guard/releases/tag/v0.1.0
