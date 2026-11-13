# AI プロキシ（任意）

NougÆn IS の AI 機能は、APIキーをコードに直書きしない設計になっています。
接続方法は2つあります。

## 方式A: プロキシ（推奨）

キーをサーバー側に置く方式。サイトの利用者全員がキーを知らずに使えます。

1. Cloudflare Workers に `worker.js` をデプロイする
2. キーは必ずシークレットとして登録する（コードやリポジトリに書かない）
   - `wrangler secret put GEMINI_API_KEY`
3. 変数 `ALLOWED_ORIGINS` にサイトのオリジンをカンマ区切りで設定する
   - 例: `https://kassy-exe.github.io`
4. 発行された Worker の URL を、アプリの「AI → 接続設定 → プロキシURL」に貼る

補足:
- Origin チェックは簡易的なもの。本命の防御は Google Cloud 側で
  キーに API 制限（Generative Language API のみ）と上限（クォータ）を付けること
- Cloudflare のレート制限ルールを併用するとさらに安全

## 方式B: 自分のキーを使う（BYOK）

プロキシがない場合、利用者が自分の Gemini API キーを
「AI → 接続設定」に入力して使います。

- キーはその人のブラウザ内（既定ではタブを閉じると消える sessionStorage、
  本人が選んだ場合のみ localStorage）にだけ保存されます
- 共有端末では使わないでください

## 注意: 直書きされていたキーについて

KVW 側に直書きされていたキーは、公開リポジトリに出た時点で
漏洩したものとして扱ってください。コードから消しても履歴に残ります。
Google AI Studio / Google Cloud でそのキーを失効（削除）して、
新しいキーを発行し直すのが正しい対処です。
