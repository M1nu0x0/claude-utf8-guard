# claude-utf8-guard

[![release](https://img.shields.io/github/v/release/M1nu0x0/claude-utf8-guard)](https://github.com/M1nu0x0/claude-utf8-guard/releases)
[![CI](https://github.com/M1nu0x0/claude-utf8-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/M1nu0x0/claude-utf8-guard/actions/workflows/ci.yml)
[![license](https://img.shields.io/github/license/M1nu0x0/claude-utf8-guard)](LICENSE)
[![anthropics/claude-code#83033](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/83033?label=anthropics%2Fclaude-code%2383033)](https://github.com/anthropics/claude-code/issues/83033)

**한국어** | [English](README.en.md) | [日本語](README.ja.md)

Claude가 도구 호출의 한글, 일본어, 중국어를 `\uXXXX` 이스케이프로 쓰다가 엉뚱한 글자로 바꾸는 문제를 막는 Claude Code 플러그인입니다.

AskUserQuestion, TodoWrite, Notion이나 Jira MCP 도구 같은 도구 호출에서 Claude는 한글을 글자 대신 `\uXXXX` 이스케이프로 쓰기도 합니다. 이때 hex를 틀리게 적으면 이스케이프가 다른 실제 음절로 풀려서, 누군가 읽기 전까지는 깨진 줄 모릅니다. 일본어에서도 `揃え`가 `諿え`로, `側`이 간체자 `侧`로 바뀌는 등 같은 증상이 보고됐습니다. 이 플러그인은 세션이 시작될 때 UTF-8 글자 그대로 쓰라고 Claude에게 알려 주고, 도구를 호출하기 전마다 깨져 보이는 글자가 있으면 그 호출을 한 번 멈춥니다. 원인 이슈가 고쳐지면 세션을 시작할 때 플러그인을 꺼도 된다고 알려 줍니다.

**[Website](https://m1nu0x0.github.io/claude-utf8-guard/ko/) · [Releases](https://github.com/M1nu0x0/claude-utf8-guard/releases) · [Changelog](CHANGELOG.md)**

| Claude가 쓴 도구 입력 | 화면에 보이는 글자 |
| --- | --- |
| `{"content": "\uc810\uae54\ub3c4 \uc644\ub9b7\ub41c"}` (이스케이프, hex가 틀림) | 점**깔**도 완**릷**된 |
| `{"content": "점검도 완료된"}` (이 플러그인이 안내하는 UTF-8) | 점검도 완료된 |

## 만든 이유

[anthropics/claude-code#83033](https://github.com/anthropics/claude-code/issues/83033) (*Sonnet 5 writes Korean tool-call parameters as \uXXXX escapes and mis-spells the hex*) 때문입니다.

이 이슈의 작성자는 한국어 도구 호출을 이스케이프로 쓰게 한 실행과 UTF-8로 쓰게 한 실행을 비교했습니다. 이스케이프로 쓴 실행은 45번 모두 한글 일부가 깨졌고(음절의 약 3~5%), UTF-8로 쓰게 한 실행은 30번 중 1번, 30번 중 0번이었습니다. 깨진 글자는 `점검` → `점깔`, `코딩` → `코딅`처럼 모두 실제로 있는 한글이라 U+FFFD처럼 눈에 띄지 않습니다. 댓글에서는 Opus 5와 Notion, Jira MCP 쓰기 도구에서도 같은 증상이 보고됐습니다.

일본어도 마찬가지입니다. [#54051](https://github.com/anthropics/claude-code/issues/54051)은 Notion MCP 호출에서 `揃え` → `諿え`, `処分` → `処勭`, `側` → `侧`(간체자), `億` → `亿`(간체자)으로 바뀌었다고 보고했고, [#59649](https://github.com/anthropics/claude-code/issues/59649)는 AskUserQuestion에서 `叩き` → `鯰し`, `再起動` → `在控`, `鳴る` → `鳥る`로 바뀌었다고 보고했습니다. 두 이슈 모두 이스케이프가 원인인지는 확인되지 않았습니다. 그래서 이 플러그인은 원인이 아니라 결과를 검사합니다.

Claude Code 쪽 답변은 CLI가 이스케이프를 받은 그대로 풀 뿐이라 틀린 코드포인트를 고칠 수 없고, 이 이슈를 모델 팀에 넘겼다는 것입니다. 같은 증상의 다른 보고들은 대부분 고쳐지지 않은 채 닫혔습니다(아래 관련 이슈). #83033이 고쳐진 것으로 닫히면 이 플러그인은 필요 없어지므로, 그때 레포를 보관(archive)할 예정입니다. 플러그인은 세션을 시작할 때, CI는 매일 #83033의 상태를 확인합니다.

## 설치

Claude Code 터미널 프롬프트에서:

```
/plugin install utf8-guard --marketplace M1nu0x0/claude-utf8-guard
```

`Add marketplace?`에 `y`를 누르고 scope는 user를 고릅니다. 셸에서는 이렇게 설치합니다.

```sh
claude plugin install utf8-guard --marketplace M1nu0x0/claude-utf8-guard
```

Claude Desktop에서는 프롬프트 옆 `+` → Plugins → Add marketplace에 `M1nu0x0/claude-utf8-guard`를 넣고 `utf8-guard`를 추가합니다.

훅은 Node.js로 실행되므로 `PATH`에 Node.js 18 이상이 있어야 합니다. 설치한 뒤 새 세션부터 적용됩니다.

## 동작

1. **세션 시작(`SessionStart`)**: Claude에게 지시 한 줄을 넣습니다(`additionalContext`). 도구 호출의 비ASCII 문자는 `\uXXXX` 이스케이프가 아니라 UTF-8 글자 그대로 쓰고, 그대로 옮겨 적는 코드 속 이스케이프(소스 파일의 `"\u200b"` 등)만 예외로 두라는 내용입니다. #83033에서 효과가 확인된 우회법입니다. startup, resume, clear, compact마다 다시 넣습니다.
2. **도구 호출 전(`PreToolUse`)**: 입력의 모든 문자열을 검사합니다(아래 표). 걸리면 호출을 거부(`deny`)하고 어떤 글자가 어디 있는지 Claude에게 알려 주며, 사용자에게도 한 줄 보여 줍니다(`systemMessage`). 같은 세션에서 같은 호출을 그대로 다시 보내면 통과합니다. 의도한 드문 단어라면 한 번 더 주고받을 뿐 작업이 막히지 않습니다.
3. **원인 이슈 확인**: 세션 시작 훅은 플러그인 데이터 폴더(`CLAUDE_PLUGIN_DATA`)의 캐시만 읽어서 네트워크를 기다리지 않습니다. 캐시가 하루 지났으면 백그라운드 프로세스가 GitHub API에 #83033의 상태를 한 번 묻고 다음 세션을 위해 저장합니다. #83033이 **completed**로 닫혔으면 새 세션을 시작할 때(startup) 아래처럼 알려 줍니다. not planned나 stale로 닫힌 것은 고쳐졌다는 뜻이 아니라서 알리지 않습니다.

   ```
   utf8-guard: anthropics/claude-code#83033 was closed as fixed on 2026-12-01 (...). If Claude no longer writes
   broken \uXXXX escapes, turn this plugin off with "claude plugin disable utf8-guard". To stop this notice, turn off
   "Notify when fixed upstream" in /config.
   ```

Claude Code는 훅에 넘기기 전에 모델이 쓴 JSON을 먼저 풉니다. 그래서 훅은 이스케이프 자체를 볼 수 없고, 그것이 바뀐 결과만 봅니다. 검사가 "이스케이프를 썼는가"가 아니라 "깨진 결과처럼 보이는가"인 이유입니다.

## 막는 것과 못 막는 것

| 증상 | 예 | 검사 | 이 플러그인 |
| --- | --- | --- | --- |
| hex를 틀려 드문 음절이 됨 | `완료` → `완릷`, `코딩` → `코딅`, `멀쩡` → `멀잩` | KS X 1001(EUC-KR) 2,350자 밖의 한글 음절 | 막음. hex 한 자리를 틀린 경우의 약 70% |
| 틀린 한자가 드문 한자가 됨 | `揃え` → `諿え`, `処分` → `処勭`, `側` → `侧`(간체자) | 가나가 섞인 문장에서 JIS X 0208(Shift_JIS) 6,355자 밖의 한자 | 막음. hex 한 자리를 틀린 경우의 약 66%. 가나가 없는 문장(중국어일 수 있음)은 검사 안 함 |
| 짝 없는 서로게이트 | `\uD83A` 하나만 있음, API가 400으로 거부하고 세션이 멈춤 | 짝 없는 U+D800~DFFF | 막음 |
| 디코딩 실패 | `한�글` | U+FFFD | 막음 |
| 이스케이프가 텍스트로 남음 | AskUserQuestion에 `\uc810\uac80`이 그대로 보임 | 코드가 아닌 도구에서 한글, 가나, 한자를 가리키는 `\uXXXX` 텍스트 | 막음 |
| hex를 틀려 흔한 음절이 됨 | `잡히지` → `잡힐지`, `점검` → `점깔` | 구별할 방법 없음 | 못 막음. 세션 시작 지시로 예방만 |
| 틀린 한자가 흔한 한자가 됨 | `鳴る` → `鳥る`, `再起動` → `在控`, 중국어 문장의 틀린 한자 | 다른 실제 글자라 구별 불가 | 못 막음. 지시로 예방만 |
| 이스케이프 중간 글리치로 JSON이 깨짐 | #79339 | 훅이 돌기 전에 Claude Code가 거부(#93311) | 못 막음. 지시로 예방만 |
| 이스케이프 없이 틀린 음절 | `새벽` → `새벅` (#83033, 0.3~0.4%) | KS X 1001 밖이면 잡힘 | 일부만 |

드문 음절 검사는 `똠`, `햏`, `뷁`, `쌰` 같은 실제 단어에도, 한자 검사는 JIS X 0208에 없는 인명용 한자에도 걸립니다. 2010년 상용한자 추가분 `剝`, `頰`, `塡`과 이름에 흔한 `髙`은 미리 허용해 두었습니다. 이때는 Claude가 이유를 보고 같은 호출을 다시 보내 통과하거나, 아래 설정에서 이 검사만 끌 수 있습니다. Read, Glob, Grep처럼 읽기만 하는 도구는 검사하지 않습니다. Write, Edit, Bash처럼 코드를 다루는 도구에서는 텍스트로 적힌 `\uXXXX`를 의도한 것으로 보고 검사하지 않습니다.

## 설정과 끄기

`/config`(또는 `/plugin`)의 utf8-guard 항목에서 바꿉니다. 값은 `settings.json`의 `pluginConfigs`에 저장됩니다.

| 설정 | 기본값 | 끄면 |
| --- | --- | --- |
| Notify when fixed upstream (`upstream_check`) | 켜짐 | GitHub에 묻지 않고, 고쳐졌다는 알림도 보이지 않음 |
| Check Korean syllables (`hangul_check`) | 켜짐 | 드문 한글 음절 검사만 빠짐. 서로게이트, U+FFFD, 텍스트 이스케이프 검사와 세션 시작 지시는 그대로 |
| Check Japanese kanji (`kanji_check`) | 켜짐 | 일본어 문장의 드문 한자 검사만 빠짐 |

플러그인 전체를 끄려면 `claude plugin disable utf8-guard`, 제거하려면 `claude plugin uninstall utf8-guard`를 실행합니다.

## 관련 이슈

배지는 각 이슈의 현재 상태(open/closed)를 보여줍니다.

**원인 이슈**

| 이슈 | 상태 | 내용 |
| --- | --- | --- |
| [anthropics/claude-code#83033](https://github.com/anthropics/claude-code/issues/83033) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/83033?label=) | Claude가 도구 호출 파라미터의 한글을 `\uXXXX`로 쓰고 hex를 틀림. 이 플러그인이 생긴 이유이자 제거 조건 |

**같은 증상 보고**

| 이슈 | 상태 | 내용 |
| --- | --- | --- |
| [anthropics/claude-code#80009](https://github.com/anthropics/claude-code/issues/80009) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/80009?label=) | AskUserQuestion 입력의 한글 음절이 깨짐. 세션 로그에서 확인됨. #83033이 같은 원인으로 지목 |
| [anthropics/claude-code#78996](https://github.com/anthropics/claude-code/issues/78996) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/78996?label=) | 긴 한국어 세션에서 한글이 잘못된 형태로 무너짐. #83033이 같은 원인으로 지목 |
| [anthropics/claude-code#57981](https://github.com/anthropics/claude-code/issues/57981) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/57981?label=) | AskUserQuestion에서 틀렸지만 실제로 있는 음절이 가끔 나옴 |
| [anthropics/claude-code#53665](https://github.com/anthropics/claude-code/issues/53665) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/53665?label=) | Opus 4.7에서 tool_use JSON 파라미터의 한글이 깨짐 |
| [anthropics/claude-code#82588](https://github.com/anthropics/claude-code/issues/82588) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/82588?label=) | Opus 5가 틀린 한글 음절을 씀 |
| [anthropics/claude-code#79339](https://github.com/anthropics/claude-code/issues/79339) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/79339?label=) | 이스케이프 중간에 `\`와 한자를 섞어 써서 도구 입력 전체를 파싱할 수 없음 |
| [anthropics/claude-code#61670](https://github.com/anthropics/claude-code/issues/61670) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/61670?label=) | 짝 없는 `\uD83A`와 깨진 한글이 AskUserQuestion에 들어가 세션이 끝남 |
| [anthropics/claude-code#69522](https://github.com/anthropics/claude-code/issues/69522) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/69522?label=) | 이스케이프로 쓴 긴 도구 인자가 JSON 파싱에 실패함 |
| [anthropics/claude-code#54051](https://github.com/anthropics/claude-code/issues/54051) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/54051?label=) | Notion MCP 도구로 쓴 일본어에 틀린 한자가 섞임(`揃え` → `諿え`, `側` → `侧`). 이스케이프가 원인인지는 추정 단계 |
| [anthropics/claude-code#56003](https://github.com/anthropics/claude-code/issues/56003) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/56003?label=) | AskUserQuestion에 일본어가 `\uXXXX` 그대로 보임 |
| [anthropics/claude-code#78568](https://github.com/anthropics/claude-code/issues/78568) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/78568?label=) | 번체 중국어 출력에 틀린 글자가 섞임 |
| [anthropics/claude-code#59649](https://github.com/anthropics/claude-code/issues/59649) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/59649?label=) | AskUserQuestion에 비슷하게 생긴 틀린 한자가 나옴(`叩き` → `鯰し`, `再起動` → `在控`). 작성자는 이스케이프가 없었다고 함(Opus 4.7) |

**도구가 만드는 같은 이스케이프**

모델이 아니라 Claude Code 도구 쪽 버그입니다. 이 플러그인이 고치지는 못하지만, 검사 대상에서 코드 도구를 뺀 이유입니다.

| 이슈 | 상태 | 내용 |
| --- | --- | --- |
| [anthropics/claude-code#99361](https://github.com/anthropics/claude-code/issues/99361) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/99361?label=) | old_string이 이스케이프 형태로 일치하면 Edit이 `new_string`의 비ASCII 문자를 모두 `\uXXXX`로 씀 |
| [anthropics/claude-code#72957](https://github.com/anthropics/claude-code/issues/72957) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/72957?label=) | Write와 Edit이 파일 내용의 `\uXXXX`를 풀어 버림 |

**훅이 볼 수 없는 것**

| 이슈 | 상태 | 내용 |
| --- | --- | --- |
| [anthropics/claude-code#93311](https://github.com/anthropics/claude-code/issues/93311) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/93311?label=) | 입력 검증에서 거부된 호출은 PreToolUse에 오지 않음. #79339 같은 경우를 훅이 못 잡는 이유 |
| [anthropics/claude-code#96285](https://github.com/anthropics/claude-code/issues/96285) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/96285?label=) | 훅 stdin은 UTF-8인데 Windows의 Python 훅은 ANSI로 읽어 한글이 깨짐. 이 플러그인은 UTF-8로 읽음 |

새 관련 이슈를 찾으면 issue나 PR로 알려주세요.

## 구성

```
.claude-plugin/
  marketplace.json      이 레포를 마켓플레이스로 등록
plugins/utf8-guard/
  .claude-plugin/
    plugin.json         플러그인 매니페스트, userConfig 두 개
  hooks/
    hooks.json          SessionStart, PreToolUse 훅(exec 형식, node)
    session-start.mjs   지시 추가, 고쳐졌다는 알림, 백그라운드 확인 시작
    pre-tool-use.mjs    검사에 걸린 호출을 한 번 멈춤
    check.mjs           검사 규칙(순수 함수)
    hangul.mjs          KS X 1001 한글 2,350자
    kanji.mjs           JIS X 0208 한자 6,355자
    upstream.mjs        #83033 상태 캐시와 GitHub 확인
    common.mjs          입력 읽기, 설정, 데이터 폴더
  tests/                node --test 용 테스트
.github/ci/
  engine-session-start.sh  로그인 없이 실제 Claude Code로 SessionStart 훅 확인
site/                   GitHub Pages 사이트(Astro): src/site.json 번역, src/pages/ 페이지
package.json, tsconfig.json  훅과 테스트의 타입 검사(tsc --checkJs)
README.en.md, README.ja.md  README 번역본
```

플러그인은 `plugins/utf8-guard/`에 따로 두고 마켓플레이스가 상대경로로 가리킵니다. claude.ai의 Add marketplace는 레포 루트를 통째로 플러그인으로 쓰는 구성을 받아주지 않는 경우가 있어서입니다.

## 개발

```sh
claude plugin validate .                     # 마켓플레이스
claude plugin validate plugins/utf8-guard     # 플러그인
npm ci && npm run typecheck                 # 훅과 테스트의 타입 검사(JSDoc, tsc --checkJs)
node --test 'plugins/utf8-guard/tests/*.test.mjs'
bash .github/ci/engine-session-start.sh      # 로그인 없이 실제 Claude Code로 SessionStart 훅 확인
cd site && npm ci && npm run build           # 사이트 빌드와 검사(site/dist)
cd site && npm run dev                        # 로컬 미리보기
cd site && npm run og                         # 언어별 링크 미리보기 이미지 생성(Playwright 필요)
```

`hooks/hangul.mjs`는 EUC-KR 바이트 B0A1~C8FE를, `hooks/kanji.mjs`는 EUC-JP 바이트 B0A1~F4FE를 디코딩해 만든 표입니다. 테스트가 같은 방법으로 다시 만들어 비교합니다.

훅은 Claude Code가 `node`로 그대로 실행하는 JavaScript(`.mjs`)라 빌드 단계가 없고 Node 18에서도 돕니다. 대신 모든 파일에 `// @ts-check`와 JSDoc 타입을 달고, `npm run typecheck`가 `tsc`로 엄격하게(`strict`) 검사합니다. TypeScript는 개발용 의존성이라 플러그인을 설치할 때는 받지 않습니다.

사이트는 [Astro](https://astro.build)와 공용 키트 [claude-plugin-site](https://github.com/M1nu0x0/claude-plugin-site)로 만듭니다. 문구는 모두 `site/src/site.json`에, 섹션 순서는 `site/src/pages/[...lang].astro`에 있습니다. `npm run build`는 언어별 페이지(`/`, `/ko/`, `/ja/`)와 `sitemap.xml`을 만든 뒤 크롤러가 읽는 그대로 검사하고(제목·설명 길이, canonical, hreflang, OG, JSON-LD, 깨진 링크와 이미지, HTML 검증), 하나라도 어긋나면 실패합니다. main에 병합되면 Pages 워크플로가 빌드해 배포합니다. 페이지의 JSON-LD에 플러그인 버전이 들어가므로 버전을 올리면 사이트도 다시 배포됩니다. 내용이 바뀌면 `site/src/site.json`의 `updated`도 그날 날짜로 바꿉니다. 바꾸지 않으면 PR에서 CI가 경고합니다. `ask`, `answer`, `ogImageLine`, `ogImageText`를 바꾸면 `npm run og`로 `site/public/images/og*.png`도 다시 만들어 커밋합니다.

새 버전은 `plugins/utf8-guard/.claude-plugin/plugin.json`의 `version`을 올리는 PR을 병합한 뒤, 같은 버전으로 `vX.Y.Z` Release를 만듭니다. 태그가 생기면 CI가 태그와 `version`이 같은지 확인합니다.

## 한계

- Claude Code 전용입니다. 훅은 Node.js 18 이상이 필요하고, Node가 없으면 훅이 실패해 아무것도 검사하지 않습니다(호출은 막히지 않음).
- 세션 시작 지시는 Claude가 따르지 않을 수 있습니다. 훅은 결과만 보므로, 흔한 음절이나 흔한 한자로 바뀐 경우, 중국어 문장의 틀린 한자는 잡지 못합니다.
- PreToolUse 훅은 모든 도구 호출마다 Node 프로세스를 하나 띄웁니다.
- 원인 이슈 확인은 인증 없이 GitHub API를 하루 한 번 부릅니다. 실패하면 마지막으로 알던 상태를 유지하고 하루 뒤에 다시 시도합니다.

## License

MIT
