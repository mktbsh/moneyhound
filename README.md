# moneyhound

個人用の家計簿です。マネーフォワードの代わりに、この端末と自分の Google ドライブだけで収支を残します。銀行への自動ログインやサーバーへの保存はありません。

画面は日本語、金額は円です。スマホと PC のブラウザで使え、ホーム画面に追加できる PWA です。

moneyhound は株式会社マネーフォワードとは関係がありません。

## 開発

Bun 1.4.5 と Node.js 26.13.1 が必要です。型検査は `typescript@7.0.2`（Go 製の `tsc`）です。整形は `bun fmt`、静的チェックは oxlint です。この版の Bun には `bun fmt` はあり、組み込みの `bun lint` はありません。

```bash
bun install
bun run dev
```

`http://127.0.0.1:5173` を開きます。`VITE_GOOGLE_CLIENT_ID` が空ならローカルのみで動作し、データはブラウザの IndexedDB に保存されます。テストと日常の開発はこの状態で行います。

```bash
bun run check      # bun fmt、oxlint、型、bun test
bun run test:e2e   # Playwright（bunx）。PC とスマホ幅、ローカルのみ
bun run build      # apps/web/dist を出力
```

環境変数は `.env.example` を `.env.local` にコピーして書きます。`.env.local` はコミットしません。

## できること（この段階）

- 支出・収入・振替の記録、編集、削除
- カテゴリ（日本語の初期セットあり）と口座
- 月ごとの収入・支出・収支・カテゴリ内訳。振替は収支に含めない
- 内容に文字列を含む自動分類ルール（取り込み時に使う）
- CSV の取り込み（設定 →「明細の取り込み」）。マネーフォワードME の「収入・支出詳細」と、銀行・カード・電子マネーの公式 CSV（口座を選んで取り込む）。取り込む前に件数を確認でき、同じファイルを何度読んでも重複しない
- 相手口座が未設定の振替を、設定画面でまとめて設定（任意。未設定でも収支の集計は変わらない）
- JSON バックアップの書き出しと読み込み
- クライアント ID があるとき、Google ドライブの `マイドライブ/moneyhound/ledger.json` と同期

マネーフォワードの CSV 書き出しはプレミアム機能です。解約前に過去分を書き出して取り込み、解約後は各金融機関の公式 CSV を取り込みます。OFX にはまだ対応していません。

## Google の OAuth クライアント

同期を使うときだけ作成します。

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作る。
2. OAuth 同意画面を **外部** ではなく、テスト用途なら **Testing** にする。テストユーザーに自分の Google アカウントだけを追加する。公開ステータスにはしない。
3. 認証情報で **OAuth クライアント ID**、種類は **ウェブ アプリケーション**。
4. 承認済みの JavaScript 生成元に、開発なら `http://127.0.0.1:5173`、公開するなら Cloudflare のオリジン（例: `https://moneyhound.example.pages.dev`）を追加する。リダイレクト URI は使いません（トークンフローです）。
5. クライアント ID を `VITE_GOOGLE_CLIENT_ID` に入れる。

アプリが要求するスコープは `https://www.googleapis.com/auth/drive.file` だけです。このクライアントが作った `moneyhound` フォルダだけにアクセスします。ドライブ全体は読みません。

## Cloudflare への配置（手順のみ）

このリポジトリからはデプロイしません。オーナーが Cloudflare で静的サイトとして公開します。Workers の API や D1 は使いません。

### Pages

1. 新しい Pages プロジェクトをこの Git リポジトリに接続する。
2. ビルドコマンド: `bun install --frozen-lockfile && bun run build`
3. 出力ディレクトリ: `apps/web/dist`
4. 環境変数 `VITE_GOOGLE_CLIENT_ID` を Production に設定する。未設定でもローカルのみとしてビルドできる。
5. カスタムドメインまたは `*.pages.dev` のオリジンを、OAuth クライアントの承認済み JavaScript 生成元に追加する。

画面はハッシュルーティング（`#/transactions` など）なので、SPA 用のリダイレクト設定は不要です。

### Workers 静的アセット

`wrangler` は依存関係に入れていません。Workers の静的アセットとして `apps/web/dist` を配信する場合も、API ルートは作らず、環境変数はビルド時に `VITE_GOOGLE_CLIENT_ID` を渡します。

## データの場所

- ブラウザ: IndexedDB のデータベース `moneyhound`
- ドライブ: `マイドライブ/moneyhound/ledger.json`
- バックアップ: 設定画面から書き出した JSON

実在の明細やトークンを Git に入れないでください。
