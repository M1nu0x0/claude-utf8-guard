# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Dependabot waits 7 days after a release before proposing an update (`cooldown: default-days: 7`), so a malicious release that is pulled within a week never reaches a pull request; security updates skip the wait

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
