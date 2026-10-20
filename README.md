# aidlc-phase

AI-DLC のフェーズとステージを、プロンプトの下に 1 行で表示する Claude Code の mod です。プロジェクトの statusLine を AI-DLC のものに置き換えなくても、いま使っている statusLine を残したままフェーズが見えます。

```
⚠ aidlc-phase: [AIDLC] my-feature · INCEPTION [▓▓▓░░░░░░░] 3/9 > User Stories
```

本体は `hooks/register.ts`、テストは `hooks/register.test.ts` です。このリポジトリがそのままマーケットプレイスになっています（`.claude-plugin/`）。

## 動く条件

- 作業フォルダかその親に `aidlc/` フォルダがあるとき（AI-DLC のプロジェクト）だけ動きます。それ以外の場所では何も実行せず、何も表示しません
- 進行中のワークフローが無い（`[AIDLC] ready`）ときは表示を消します
- function hooks を有効にしておく必要があります（`CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`）

## 入れ方

AI-DLC を使うプロジェクトのフォルダで実行します。

```bash
claude plugin marketplace add 70-10/aidlc-phase --scope local
claude plugin install aidlc-phase@aidlc-phase --scope local
```

`--scope local` は、そのリポジトリの `.claude/settings.local.json` に書き込みます。サブフォルダで実行しても、書き込み先は git のルートです。

このマーケットプレイスは auto-update が既定でオフです。更新を自動で受け取るには、`/plugin` の画面でこのマーケットプレイスの auto-update をオンにします。

## テスト

```bash
claude plugin validate .
claude plugin test .
```
