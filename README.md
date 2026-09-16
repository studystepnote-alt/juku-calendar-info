# 塾バイト予定表 → Googleカレンダー同期

毎晩、日本時間22:00ごろにGrow教育システムへログインし、今月と来月の月間予定表を取得して、Googleカレンダーへ「塾バイト」というタイトルで登録します。

## 注意

このコードはログイン情報をファイルに保存しません。GitHubの **Settings → Secrets and variables → Actions** に次のSecretsを登録してください。

- `JUKU_ACCOUNT`
- `JUKU_PASSWORD`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `GOOGLE_CALENDAR_ID`（任意。未設定なら自分のデフォルトカレンダー）

GoogleのOAuth認証情報は、Google Cloud ConsoleでCalendar APIを有効化し、OAuthクライアントを作成して取得します。Refresh Tokenは一度だけOAuth同意画面を通して発行します。Client SecretやRefresh Tokenをチャット・公開リポジトリ・コードに貼らないでください。

## GitHubへのアップロード

このフォルダの中身を、作成済みのPrivateリポジトリへアップロードします。GitHubのリポジトリ画面で **Add file → Upload files** を選び、次のファイルとフォルダをまとめてアップロードしてください。

```text
.github/workflows/sync.yml
src/index.js
src/scraper.js
src/calendar.js
package.json
README.md
.gitignore
```

アップロード後、Actionsタブの `Sync juku schedule` を開き、`Run workflow` で手動テストできます。

## 予定の読み取りについて

塾サイトのログイン画面までは確認済みです。月間予定表の内部構造はログイン後にしか確認できないため、初回の手動実行で「予定を1件も読み取れませんでした」となった場合は、その実行ログだけ送ってください。パスワードやTokenは送らないでください。画面構造に合わせて `src/scraper.js` を調整します。

## ライセンス・利用規約

塾サイトの自動アクセスが利用規約で禁止されていないことを確認してください。アクセス頻度は1日1回に限定しています。
