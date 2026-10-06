# Linqs — 生徒の質問を受けるAI学習パートナー

Next.js App Router + Gemini API + Supabase + Netlifyで作った日本語の学習チャットです。

職業訓練校でAI活用・Excel VBAを学ぶ生徒向けです。成人の学習者に丁寧な日本語で、基礎から業務での応用まで段階的に説明します。学習経験は「はじめて」「基礎を学習中」「実務に応用」から選択できます。

## できること

- 職業訓練校のAI活用・Excel VBAの質問と、会話を踏まえた追加質問
- 「解説」と「ヒント」の切り替え、学習経験に合わせた回答
- VBAの質問でMicrosoft Learnの公式資料を取得し、回答と履歴に出典リンクを表示
- Markdown・VBAのコード・表・LaTeX数式の表示、回答のコピー
- 質問履歴の検索、しおり保存、削除
- Supabaseのクラス共通メール・パスワード認証と、クラスで共有する履歴
- サーバー側のGemini呼び出し、入力検証、クラス全体で30回/時間の質問制限
- スマートフォン対応、キーボード送信、読み込み・エラー表示

## ローカルで起動

Node.js 22 LTSとnpmを用意してください。

```sh
npm ci
cp .env.example .env.local
npm run dev
```

http://localhost:3000 を開きます。

**すべての接続設定が空の場合は体験モード**です。用意したサンプルの回答を表示し、履歴はブラウザのlocalStorageに保存します。自由な質問や追加質問をAIが生成するモードではありません。SupabaseのURL・publishable key・共通ユーザーIDが揃うと、Geminiキーが未設定でもログインと履歴閲覧を利用できます。AI回答は「準備中」と表示して送信を止め、Geminiキーの設定後に有効になります。Supabaseの設定自体が途中の場合は、ログインも停止します。接続済みのサービスに障害がある場合も、体験回答へ自動で切り替えません。

## GeminiとSupabaseを接続

### 1. Supabase

1. [Supabase](https://supabase.com/)でプロジェクトを作成します。
2. SQL Editorで `supabase/migrations/001_learning_assistant.sql`、`002_vocational_subjects.sql` の順に一度ずつ実行します。既に001を実行済みなら002だけ実行します。002は以前の教科の履歴を「すべて」に分類し直し、質問・回答を残します。
3. Authenticationで **Email（メール・パスワード）** を有効にし、Anonymous Sign-Insは無効にします。Allow new users to sign upも無効にして、管理者が作成した共通アカウントだけを使います。
4. プロジェクトURLとpublishable keyを `.env.local` に設定します。legacy anon keyでも利用できます。**アプリの実行にはservice_role / secret keyを使いません。** 下の共通アカウント作成処理だけはローカルの管理者キーを使用します。

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

`supabase/config.toml` はクラス共通アカウント用に新規登録と匿名ログインを無効にします。必要な場合、対応するSupabase CLIで `supabase config diff --project-ref YOUR_PROJECT_REF` を確認し、`supabase config push --project-ref YOUR_PROJECT_REF` で反映できます。

各APIがJWTを`getUser()`で検証し、`CLASS_ACCOUNT_USER_ID`に指定した非匿名ユーザーだけを許可します。RLSは`auth.uid()`に一致する履歴を許可するため、同じ共通アカウントでログインした端末では同じ履歴を共有できます。他のアカウントではクラスのAPIを使えません。質問と回答の保存は1回のトランザクションで実行します。


### クラス共通アカウントを作成

Supabaseプロジェクト作成後に、次の手順で1つのアカウントを発行します。新しい環境では、Supabaseプロジェクトに共通アカウントを作成し、ユーザーIDを設定してください。

1. `.env.setup.example` を `.env.setup` にコピーします。この作業環境では希望のメールアドレスだけ設定した `.env.setup` を用意済みです。上書きせず、そのファイルを編集してください。
2. Supabase URLと、プロジェクトの**secret key（legacy service_role keyも可）**を `.env.setup` に設定します。このファイルはGit対象外で、Next.jsの実行環境には読み込ませません。
3. `CLASS_ACCOUNT_EMAIL` に共通メールアドレスを指定します。パスワードは自動生成されます。自分で設定する場合は `CLASS_ACCOUNT_PASSWORD` に12文字以上を指定します。
4. Node 22以上で `npm run account:create` を実行します。確認メールは送らず、メール確認済みの共通アカウントを管理者APIで作成します。
5. 成功すると、メール・パスワード・ユーザーIDを `.local/class-account.json` に保存します。ファイルはGit対象外で、所有者だけが読み書きできる権限です。パスワードはターミナル出力に表示しません。
6. 出力された `CLASS_ACCOUNT_USER_ID` を `.env.local` とNetlifyに追加します。管理者キーと共通パスワードはNetlifyや `NEXT_PUBLIC_` 変数に登録しません。
7. 接続後、同じメール・パスワードでクラスの各端末からログインします。講師から生徒へログイン情報を共有してください。

既存の `.local/class-account.json` がある場合、作成処理は中止し、アカウントやパスワードを変更しません。通信失敗で完了が不明な場合は、SupabaseのUsers一覧とローカルファイルを照合してください。既存アカウントがある場合は、DashboardのユーザーIDを `CLASS_ACCOUNT_USER_ID` に設定し、現在のパスワードでログインできます。

DashboardのAuthentication → Users → Add userから手動作成することもできます。その場合も、ユーザーIDをアプリの環境変数に設定してください。

### 2. Gemini

[Google AI Studio](https://aistudio.google.com/apikey)でAPIキーを用意します。

```dotenv
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
GEMINI_MODEL=gemini-3.8-flash
```

`GEMINI_MODEL`は利用するプロジェクトで有効なモデルIDに変更できます。APIキーはサーバーの環境変数だけで使用します。`NEXT_PUBLIC_`を付けないでください。

環境変数を変更したら開発サーバーを再起動してください。ヘッダーの「AI接続中」を確認し、質問して、再読み込み後に履歴が残るか確認します。接続バッジは必要な設定の有無を示し、プロバイダーの稼働状態を保証するものではありません。

## Excel VBAの参照資料

[Microsoft LearnのExcel VBAリファレンス](https://learn.microsoft.com/ja-jp/office/vba/api/overview/excel)を公式資料として使用します。VBAの質問では、GeminiのURL contextツールに概要ページと、質問のキーワードに対応する関連ページを最大2件渡します。Option Explicit、Range / Value / Cells、Workbook / Worksheet、For...Next、If...Then...Else、MsgBoxを対象にしています。「それを詳しく」などの追加質問では、直前の生徒の質問も参照ページの選択に使います。

回答末尾の「参照した公式資料」には、取得成功のメタデータを確認できた選択済みURLだけを表示します。出典は回答本文と一緒に保存され、履歴・コピーにも残ります。一部の取得失敗は回答に明示し、すべての取得に失敗した場合は回答を保存せず、再試行の案内を表示します。関連ページを登録していないテーマでは概要ページのみを参照するため、出典欄が回答中の全仕様を裏付けるとは限りません。

サイト全体の取り込みやモデルの再学習は行いません。取得した資料を質問ごとの補足情報として利用します。URL contextはリンク先を再帰的に取得しないため、対応する資料は `src/lib/vba-reference.ts` に明示します。取得したページはGeminiの入力トークンに含まれます。モデルを変更する場合は、[URL context対応モデル](https://ai.google.dev/gemini-api/docs/generate-content/url-context)を選んでください。通常のAI活用の質問は従来どおりGeminiの知識と会話を使います。体験モードは固定サンプルで、資料の取得は行いません。

## Netlifyで公開

1. このディレクトリを自分のGitリポジトリにpushします。
2. Netlifyの **Add new project → Import an existing project** から接続します。
3. `netlify.toml` がビルドコマンド `npm run build`、公開ディレクトリ `.next`、Node 22を設定します。NetlifyのNext.jsアダプターは自動検出されます。静的HTMLへのexportは使用しません。
4. NetlifyのEnvironment variablesに `.env.example` の5項目を設定します。GeminiキーはFunctionsの実行時にも利用できるスコープにしてください。`NEXT_PUBLIC_`の2項目はビルド時にも必要です。
5. Deployを実行します。環境変数を変更した場合も再デプロイが必要です。
6. 公開URLで質問・追加質問・履歴・保存・削除を確認します。

Gemini/Supabase/Netlifyの実際のアカウント設定と公開には、利用者のアカウントアクセスが必要です。このソースコードだけではリモートのサービスを作成・設定しません。

## 履歴と運用上の仕様

- 同じ共通アカウントなら別端末でも同じ質問履歴・しおりを使えます。履歴画面の「クラスの履歴を更新」で他の端末の最新の質問を取得します。
- クラス内では質問内容と削除操作も共有されます。誰かが削除すると全員の履歴から消えます。生徒個人の識別は行いません。
- 「この端末からログアウト」はlocal scopeを使い、他の生徒をログアウトさせません。ブラウザデータを消した場合も、再ログインで履歴を取得できます。
- Supabaseの「Single session per user」は有効にしないでください。複数端末から同時に使う構成です。
- 学習経験と解説・ヒントの設定は端末ごとに保存されます。
- 体験モードの履歴と本接続の履歴は別です。体験履歴をクラウドへ自動移行しません。
- 本接続の質問内容は回答のためGeminiに送信され、Supabaseに保存されます。画面の使い方にも表示しています。
- Geminiの回答が成功して保存が失敗した場合は、回答と未保存通知を表示します。その会話の追加送信を止め、保存された文脈と表示の食い違いを防ぎます。
- モデルには直近20メッセージを渡します。履歴一覧は更新の新しい100会話を表示します。
- 質問制限は共通アカウント単位で、**クラス全体で30回/時間**です。Netlifyの複数インスタンスでも共有されます。失敗したGeminiへのリクエストも回数に含みます。
- 教員向け管理画面、学校教材の検索、添付画像、個別の生徒アカウントは含みません。

## 開発・確認

```sh
npm run typecheck
npm test
npm run build
```

ブラウザテストは起動済みの開発サーバーを対象にします。

```sh
npx playwright install chromium
npx playwright test
```

DBテストはPGliteのPostgreSQLエンジンで実際のマイグレーション・RLS・権限・トランザクションを検証します。APIテストでは認証とGeminiをモックして、入力上限・認証エラー・回数制限・保存失敗時の動作を確認します。GeminiとSupabaseの本接続は実際の設定後に別途確認してください。

## 構成

```text
src/app/api/chat/route.ts           質問の検証・認証・Gemini・履歴保存
src/app/api/conversations/route.ts  履歴の取得・保存・削除
src/components/learning-app.tsx    学習チャット画面
src/components/class-login.tsx     クラス共通ログイン画面
scripts/create-class-account.mjs   共通アカウントの一度限りの発行
src/lib/tutor.ts                   学習分野・学習経験・回答モードのシステム指示
src/lib/vba-reference.ts           公式資料の選択・取得指示・取得済み出典の表示
src/lib/demo.ts                    体験用サンプル
supabase/migrations/               テーブル・RLS・保存関数・質問回数制限
netlify.toml                       Netlifyビルド設定
```

## 公式資料

- [Microsoft Learn Excel VBAリファレンス](https://learn.microsoft.com/ja-jp/office/vba/api/overview/excel)
- [Gemini URL context](https://ai.google.dev/gemini-api/docs/generate-content/url-context)
- [Gemini SDKとAPI](https://ai.google.dev/gemini-api/docs/get-started)
- [Geminiモデル一覧](https://ai.google.dev/gemini-api/docs/models)
- [Supabaseメール・パスワードログイン](https://supabase.com/docs/reference/javascript/auth-signinwithpassword)
- [Supabaseアカウント作成API](https://supabase.com/docs/reference/javascript/auth-admin-createuser)
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [NetlifyのNext.js対応](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/)
