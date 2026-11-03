# claude-utf8-guard

[![release](https://img.shields.io/github/v/release/M1nu0x0/claude-utf8-guard)](https://github.com/M1nu0x0/claude-utf8-guard/releases)
[![CI](https://github.com/M1nu0x0/claude-utf8-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/M1nu0x0/claude-utf8-guard/actions/workflows/ci.yml)
[![license](https://img.shields.io/github/license/M1nu0x0/claude-utf8-guard)](LICENSE)
[![anthropics/claude-code#83033](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/83033?label=anthropics%2Fclaude-code%2383033)](https://github.com/anthropics/claude-code/issues/83033)

[한국어](README.md) | [English](README.en.md) | **日本語**

Claude がツール呼び出しの韓国語、日本語、中国語を `\uXXXX` エスケープで書き、別の文字に化けさせるのを防ぐ Claude Code プラグインです。

AskUserQuestion、TodoWrite、Notion や Jira の MCP ツールなどのツール呼び出しで、Claude は韓国語を文字ではなく `\uXXXX` エスケープで書くことがあります。16 進数を間違えると、エスケープは別の実在する音節にデコードされるので、誰かが読むまで壊れていることに気づきません。このプラグインはセッション開始時に UTF-8 のまま書くよう Claude に伝え、ツール呼び出しの前に毎回、壊れて見える文字があればその呼び出しを一度止めます。原因の issue が修正されたら、セッション開始時にプラグインを無効にしてよいとお知らせします。

**[Website](https://m1nu0x0.github.io/claude-utf8-guard/ja/) · [Releases](https://github.com/M1nu0x0/claude-utf8-guard/releases) · [Changelog](CHANGELOG.md)**

| Claude が書いたツール入力 | 画面に表示される文字 |
| --- | --- |
| `{"content": "점깔도 완릷된"}`（エスケープ、16 進数が間違っている） | 점**깔**도 완**릷**된 |
| `{"content": "점검도 완료된"}`（このプラグインが勧める UTF-8） | 점검도 완료된 |

## 作った理由

[anthropics/claude-code#83033](https://github.com/anthropics/claude-code/issues/83033)（*Sonnet 5 writes Korean tool-call parameters as \uXXXX escapes and mis-spells the hex*）のためです。

この issue の作成者は、韓国語のツール呼び出しをエスケープで書かせた実行と UTF-8 で書かせた実行を比べました。エスケープで書いた実行は 45 回すべてでハングルの一部（音節の約 3〜5%）が壊れ、UTF-8 で書かせた実行は 30 回中 1 回と 30 回中 0 回でした。壊れた文字は `점검` → `점깔`、`코딩` → `코딅` のようにすべて実在するハングルなので、U+FFFD のようには目立ちません。コメントでは Opus 5 や、Notion と Jira の MCP 書き込みツールでも同じ症状が報告されています。

Claude Code 側の回答は、CLI はエスケープをそのままデコードするだけで間違ったコードポイントは直せず、この issue はモデルチームに渡した、というものでした。同じ症状の他の報告はほとんどが修正されないまま閉じられています（下の関連 issue）。#83033 が修正済みとして閉じられればこのプラグインは不要になるので、そのときリポジトリをアーカイブする予定です。プラグインはセッション開始時に、CI は毎日 #83033 の状態を確認します。

## インストール

Claude Code のターミナルのプロンプトで:

```
/plugin install utf8-guard --marketplace M1nu0x0/claude-utf8-guard
```

`Add marketplace?` に `y` と答え、scope は user を選びます。シェルからは次のようにインストールします。

```sh
claude plugin install utf8-guard --marketplace M1nu0x0/claude-utf8-guard
```

Claude Desktop では、プロンプト横の `+` → Plugins → Add marketplace に `M1nu0x0/claude-utf8-guard` を入力し、`utf8-guard` を追加します。

フックは Node.js で動くので、`PATH` に Node.js 18 以上が必要です。インストール後、次のセッションから適用されます。

## 動作

1. **セッション開始（`SessionStart`）**: Claude に指示を 1 行加えます（`additionalContext`）。ツール呼び出しの非 ASCII 文字は `\uXXXX` エスケープではなく UTF-8 の文字そのままで書き、そのまま写すコードの中のエスケープ（ソースファイルの `"​"` など）だけは例外とする、という内容です。#83033 で効果が確認された回避策です。startup、resume、clear、compact のたびに加えます。
2. **ツール呼び出しの前（`PreToolUse`）**: 入力のすべての文字列をチェックします（下の表）。引っかかれば呼び出しを拒否（`deny`）し、どの文字がどこにあるかを Claude に伝え、ユーザーにも 1 行表示します（`systemMessage`）。同じセッションで同じ呼び出しを変えずにもう一度送れば通ります。意図したまれな語なら 1 往復増えるだけで、作業は止まりません。
3. **原因の issue の確認**: セッション開始フックはプラグインのデータフォルダ（`CLAUDE_PLUGIN_DATA`）のキャッシュを読むだけなので、ネットワークを待ちません。キャッシュが 1 日経っていれば、バックグラウンドのプロセスが GitHub API に #83033 の状態を一度問い合わせ、次のセッションのために保存します。#83033 が **completed** として閉じられていれば、新しいセッションの開始時（startup）に次のように表示します。not planned や stale で閉じられたのは修正されたという意味ではないので、表示しません。

   ```
   utf8-guard: anthropics/claude-code#83033 was closed as fixed on 2026-12-01 (...). If Claude no longer writes
   broken \uXXXX escapes, turn this plugin off with "claude plugin disable utf8-guard". To stop this notice, turn off
   "Notify when fixed upstream" in /config.
   ```

Claude Code はフックに渡す前に、モデルが書いた JSON をデコードします。そのためフックはエスケープそのものを見られず、それが変わった結果だけを見ます。チェックが「エスケープを書いたか」ではなく「壊れた結果に見えるか」である理由です。

## 防げるものと防げないもの

| 症状 | 例 | チェック | このプラグイン |
| --- | --- | --- | --- |
| 16 進数の誤りでまれな音節になる | `완료` → `완릷`、`코딩` → `코딅`、`멀쩡` → `멀잩` | KS X 1001（EUC-KR）の 2,350 字にないハングル音節 | 防ぐ。1 桁の誤りの約 70% |
| 片方だけのサロゲート | `\uD83A` だけがあり、API が 400 で拒否してセッションが止まる | 対になっていない U+D800〜DFFF | 防ぐ |
| デコードの失敗 | `한�글` | U+FFFD | 防ぐ |
| エスケープがテキストのまま残る | AskUserQuestion に `점검` がそのまま表示される | コード以外のツールで、ハングル、かな、漢字を指す `\uXXXX` のテキスト | 防ぐ |
| 16 進数の誤りでよく使う音節になる | `잡히지` → `잡힐지`、`점검` → `점깔` | 区別する方法がない | 防げない。指示による予防のみ |
| 間違った漢字 | 形の似た別の漢字 | 別の実在する文字なので区別できない | 防げない。指示による予防のみ |
| エスケープ途中のグリッチで JSON が壊れる | #79339 | フックより前に Claude Code が拒否する（#93311） | 防げない。指示による予防のみ |
| エスケープなしで間違う音節 | `새벽` → `새벅`（#83033、実行の 0.3〜0.4%） | KS X 1001 の外なら検出 | 一部のみ |

まれな音節のチェックは `똠`、`햏`、`뷁`、`쌰` のような実在する語にも引っかかります。そのときは Claude が理由を読んで同じ呼び出しをもう一度送れば通りますし、下の設定でこのチェックだけ無効にもできます。Read、Glob、Grep のように読むだけのツールはチェックしません。Write、Edit、Bash のようにコードを扱うツールでは、テキストとして書かれた `\uXXXX` は意図したものとみなしてチェックしません。

## 設定と無効化

`/config`（または `/plugin`）の utf8-guard の項目で変更します。値は `settings.json` の `pluginConfigs` に保存されます。

| 設定 | 既定値 | 無効にすると |
| --- | --- | --- |
| Notify when fixed upstream（`upstream_check`） | 有効 | GitHub に問い合わせず、修正されたというお知らせも表示しない |
| Check Korean syllables（`hangul_check`） | 有効 | まれなハングル音節のチェックだけが外れる。サロゲート、U+FFFD、テキストのエスケープのチェックとセッション開始時の指示はそのまま |

プラグイン全体を無効にするには `claude plugin disable utf8-guard`、削除するには `claude plugin uninstall utf8-guard` を実行します。

## 関連 issue

バッジは各 issue の現在の状態（open/closed）を表示します。

**原因の issue**

| Issue | 状態 | 内容 |
| --- | --- | --- |
| [anthropics/claude-code#83033](https://github.com/anthropics/claude-code/issues/83033) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/83033?label=) | Claude がツール呼び出しのパラメータの韓国語を `\uXXXX` で書き、16 進数を間違える。このプラグインができた理由であり、削除の条件 |

**同じ症状の報告**

| Issue | 状態 | 内容 |
| --- | --- | --- |
| [anthropics/claude-code#80009](https://github.com/anthropics/claude-code/issues/80009) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/80009?label=) | AskUserQuestion の入力の韓国語の音節が壊れる。セッションログで確認済み。#83033 が同じ原因として挙げている |
| [anthropics/claude-code#78996](https://github.com/anthropics/claude-code/issues/78996) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/78996?label=) | 長い韓国語のセッションでハングルが崩れる。#83033 が同じ原因として挙げている |
| [anthropics/claude-code#57981](https://github.com/anthropics/claude-code/issues/57981) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/57981?label=) | AskUserQuestion で、間違っているが実在する音節がときどき出る |
| [anthropics/claude-code#53665](https://github.com/anthropics/claude-code/issues/53665) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/53665?label=) | Opus 4.7 で tool_use の JSON パラメータの韓国語が壊れる |
| [anthropics/claude-code#82588](https://github.com/anthropics/claude-code/issues/82588) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/82588?label=) | Opus 5 が間違ったハングルの音節を書く |
| [anthropics/claude-code#79339](https://github.com/anthropics/claude-code/issues/79339) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/79339?label=) | エスケープの途中に `\` と漢字が混ざり、ツール入力全体がパースできなくなる |
| [anthropics/claude-code#61670](https://github.com/anthropics/claude-code/issues/61670) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/61670?label=) | 片方だけの `\uD83A` と壊れた韓国語が AskUserQuestion に入り、セッションが終わる |
| [anthropics/claude-code#69522](https://github.com/anthropics/claude-code/issues/69522) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/69522?label=) | エスケープで書いた長いツール引数が JSON のパースに失敗する |
| [anthropics/claude-code#56003](https://github.com/anthropics/claude-code/issues/56003) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/56003?label=) | AskUserQuestion に日本語が `\uXXXX` のまま表示される |
| [anthropics/claude-code#78568](https://github.com/anthropics/claude-code/issues/78568) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/78568?label=) | 繁体字中国語の出力に間違った文字が混ざる |
| [anthropics/claude-code#59649](https://github.com/anthropics/claude-code/issues/59649) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/59649?label=) | 日本語の出力に、形は似ているが間違った漢字が出る（Opus 4.7） |

**ツールが作る同じエスケープ**

モデルではなく Claude Code のツール側のバグです。このプラグインでは直せませんが、テキストのエスケープのチェックからコードのツールを外している理由です。

| Issue | 状態 | 内容 |
| --- | --- | --- |
| [anthropics/claude-code#99361](https://github.com/anthropics/claude-code/issues/99361) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/99361?label=) | old_string がエスケープの形でしか一致しないと、Edit が `new_string` の非 ASCII 文字をすべて `\uXXXX` で書く |
| [anthropics/claude-code#72957](https://github.com/anthropics/claude-code/issues/72957) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/72957?label=) | Write と Edit がファイル内容の `\uXXXX` をデコードしてしまう |

**フックから見えないもの**

| Issue | 状態 | 内容 |
| --- | --- | --- |
| [anthropics/claude-code#93311](https://github.com/anthropics/claude-code/issues/93311) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/93311?label=) | 入力検証で拒否された呼び出しは PreToolUse に届かない。#79339 のような場合をフックで検出できない理由 |
| [anthropics/claude-code#96285](https://github.com/anthropics/claude-code/issues/96285) | ![](https://img.shields.io/github/issues/detail/state/anthropics/claude-code/96285?label=) | フックの stdin は UTF-8 だが、Windows の Python フックは ANSI で読んで韓国語が壊れる。このプラグインは UTF-8 で読む |

関連する issue を見つけたら、issue か PR で教えてください。

## 構成

```
.claude-plugin/
  marketplace.json      このリポジトリをマーケットプレイスとして登録
plugins/utf8-guard/
  .claude-plugin/
    plugin.json         プラグインのマニフェスト、userConfig 2 つ
  hooks/
    hooks.json          SessionStart、PreToolUse フック（exec 形式、node）
    session-start.mjs   指示の追加、修正のお知らせ、バックグラウンド確認の開始
    pre-tool-use.mjs    チェックに引っかかった呼び出しを一度止める
    check.mjs           チェックの規則（純粋関数）
    hangul.mjs          KS X 1001 のハングル 2,350 字
    upstream.mjs        #83033 の状態のキャッシュと GitHub への問い合わせ
    common.mjs          入力の読み込み、設定、データフォルダ
  tests/                node --test 用のテスト
.github/ci/
  engine-session-start.sh  ログインなしで実際の Claude Code により SessionStart フックを確認
site/                   GitHub Pages サイト（Astro）: src/site.json 翻訳、src/pages/ ページ
README.en.md, README.ja.md  README の翻訳
```

プラグインは `plugins/utf8-guard/` に分けて置き、マーケットプレイスが相対パスで指しています。claude.ai の Add marketplace は、リポジトリのルートをそのままプラグインとする構成を受け付けないことがあるためです。

## 開発

```sh
claude plugin validate .                     # マーケットプレイス
claude plugin validate plugins/utf8-guard     # プラグイン
node --test 'plugins/utf8-guard/tests/*.test.mjs'
bash .github/ci/engine-session-start.sh      # ログインなしで実際の Claude Code により SessionStart フックを確認
cd site && npm ci && npm run build           # サイトのビルドとチェック（site/dist）
cd site && npm run dev                        # ローカルプレビュー
cd site && npm run og                         # 言語別のリンクプレビュー画像を生成（Playwright が必要）
```

`hooks/hangul.mjs` は EUC-KR のバイト B0A1〜C8FE をデコードして作った表です。テストが同じ方法で作り直して比べます。

サイトは [Astro](https://astro.build) と共通キット [claude-plugin-site](https://github.com/M1nu0x0/claude-plugin-site) で作っています。文言はすべて `site/src/site.json` に、セクションの順序は `site/src/pages/[...lang].astro` にあります。`npm run build` は言語別のページ（`/`、`/ko/`、`/ja/`）と `sitemap.xml` を作ったあと、クローラーが読むとおりにチェックし（タイトルと説明の長さ、canonical、hreflang、OG、JSON-LD、リンク切れと画像、HTML の検証）、一つでも外れれば失敗します。main にマージされると Pages ワークフローがビルドしてデプロイします。ページの JSON-LD にプラグインのバージョンが入るので、バージョンを上げるとサイトも再デプロイされます。文言を変えたら `site/src/site.json` の `updated` もその日の日付にします。変えないと PR で CI が警告します。`ask`、`answer`、`ogImageLine`、`ogImageText` を変えたら `npm run og` で `site/public/images/og*.png` も作り直してコミットします。

新しいバージョンは、`plugins/utf8-guard/.claude-plugin/plugin.json` の `version` を上げる PR をマージしたあと、同じバージョンで `vX.Y.Z` の Release を作ります。タグができると、CI がタグと `version` が一致するか確認します。

## 制限

- Claude Code 専用です。フックには Node.js 18 以上が必要で、Node がないとフックが失敗して何もチェックしません（呼び出しは止まりません）。
- セッション開始時の指示に Claude が従わないことがあります。フックは結果だけを見るので、よく使う音節に変わった場合と間違った漢字は検出できません。
- PreToolUse フックはツール呼び出しのたびに Node のプロセスを 1 つ起動します。
- 原因の issue の確認は、認証なしで GitHub API を 1 日 1 回呼び出します。失敗したら最後に分かっている状態を保ち、1 日後に再試行します。

## License

MIT
