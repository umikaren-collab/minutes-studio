# 自分で設置する手順

議事録工房を自分の環境に設置して、自分のGemini APIキーで使うための手順。

> **現状の前提**：このアプリは OpenAI の Sites（Cloudflare Workers + D1 上で動き、ChatGPTアカウントでログインする仕組み）向けに作られている。管理画面のログインは Sites が付けるヘッダー（`oai-authenticated-user-*`）に依存しているため、そのまま動かせるのは Sites 上と、下記のローカル環境だけ。Sites 以外の Cloudflare などに置く場合は、管理画面のログイン部分（`app/chatgpt-auth.ts`）を別の認証に置き換える必要がある。

## 必要なもの

- Node.js 22.13 以上
- 課金を有効にした Google Cloud プロジェクトの Gemini APIキー（[Google AI Studio](https://aistudio.google.com/apikey) で発行）。**無料枠のキーでは動かない。**

## ローカルで動かす

1. 依存パッケージを入れる。

   ```sh
   npm install
   ```

2. プロジェクト直下に `.dev.vars` を作る（Git管理外）。

   ```sh
   GEMINI_API_KEY=（あなたのAPIキー）
   GEMINI_PAID_TIER=true
   SHARED_DEMO_ENABLED=true
   ADMIN_OWNER_EMAIL=seedy@sites.test
   API_KEY_ENCRYPTION_SECRET=（下のコマンドで作った値）
   ```

   暗号用の値は次で作る。

   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```

   `seedy@sites.test` はローカル起動時に自動でログインする仮のアカウント。これをオーナーにすると、ローカルで管理画面を開ける。

3. 開発サーバーを起動する。

   ```sh
   npm run dev
   ```

4. 別のターミナルで、ローカルのD1にテーブルを作る（初回と、`drizzle/` にSQLが増えたとき）。`wrangler.local.json` を次の内容で作ってから実行する。

   ```json
   {
     "name": "local",
     "compatibility_date": "2026-05-15",
     "d1_databases": [
       {
         "binding": "DB",
         "database_name": "site-creator-d1",
         "database_id": "00000000-0000-4000-8000-000000000000",
         "migrations_dir": "drizzle"
       }
     ]
   }
   ```

   ```sh
   npx wrangler d1 migrations apply site-creator-d1 --local --config wrangler.local.json --persist-to .wrangler/state
   ```

5. `http://localhost:5173/admin` を開き、招待コードを発行する。`http://localhost:5173/` でそのコードを入れれば議事録を作成できる。

## Sites に公開する

1. Sites の秘密設定に次を登録する。
   - `ADMIN_OWNER_EMAIL`：Sites のオーナーのメールアドレス
   - `API_KEY_ENCRYPTION_SECRET`：上と同じ方法で作った値（ローカルとは別の値にする）
2. Sites のビルド・公開フローで公開する（Worker と `drizzle/` のマイグレーションが反映される）。
3. `/admin` にオーナーのアカウントでログインし、APIキーを登録して「課金を有効にしたGoogle Cloudプロジェクトのもの」にチェックを入れ、利用を受け付ける設定にする。
4. 招待コードを発行し、URLとコードを利用者に伝える。

APIキーは管理画面から登録する（暗号化してD1に保存される）。環境変数 `GEMINI_API_KEY` で渡すこともできるが、その場合は `GEMINI_PAID_TIER=true` も必要で、管理画面での登録が優先される。

## 設定値

| 変数 | 内容 |
| --- | --- |
| `ADMIN_OWNER_EMAIL` | 管理画面に入れるアカウントのメールアドレス（必須） |
| `API_KEY_ENCRYPTION_SECRET` | APIキーを暗号化する32バイトの値（base64url、必須） |
| `GEMINI_API_KEY` | 管理画面を使わずにキーを渡す場合のみ |
| `GEMINI_PAID_TIER` | 上のキーが有料枠なら `true` |
| `GEMINI_MODEL` | 管理画面で未設定のときのモデル（既定 `gemini-3.5-flash-lite`） |
| `SHARED_DEMO_ENABLED` | 管理画面で未設定のときに利用を受け付けるか（`true`/`false`） |

利用回数の上限（全員合計・コード別）は管理画面で設定する。
