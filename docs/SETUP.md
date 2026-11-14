# セットアップ・運用ガイド

コマンドはリポジトリのルートディレクトリで実行してください。

## ローカルで起動

Node.js 22 LTSとnpmを用意してください。

```sh
npm ci
cp .env.example .env.development.local
# 開発用のGemini・Supabase設定を.env.development.localに登録
npm run dev
```

http://localhost:3000 を開きます。既存の`.env.development.local`がある場合は上書きせず編集してください。開発用の接続設定が未登録の場合は、ログインを停止します。

SupabaseのURL・publishable key・共通ユーザーIDが揃うと、Geminiキーが未設定でもログインと履歴閲覧を利用できます。AI回答は「準備中」と表示して送信を止め、Geminiキーの設定後に有効になります。接続設定が空またはSupabaseの設定が途中の場合はログインを停止します。回答はGeminiから取得し、接続エラー時はエラーを表示します。

## GeminiとSupabaseを接続

### 1. Supabase

1. [Supabase](https://supabase.com/)でプロジェクトを作成します。
2. SQL Editorで `supabase/migrations/001_learning_assistant.sql`、`002_vocational_subjects.sql`、`003_textbook_search.sql`、`004_server_exchange_writer.sql`、`005_knowledge_entries.sql`、`006_conversation_courses.sql`、`007_instructor_questions.sql`、`008_instructor_question_notifications.sql`、`009_instructor_edge_dispatch.sql`、`010_notification_recipients.sql` の順に一度ずつ実行します。既存のプロジェクトには未適用のマイグレーションだけ実行します。002は以前の教科の履歴を「すべて」に分類し直し、質問・回答を残します。003は教科書検索用のテーブルと関数を作成し、教材を未登録の状態でも質問APIに必要です。004は既存の履歴を残し、ログイン情報だけで回答を書き込める旧関数を非公開にします。005は追加知識・小ネタ・FAQを保存するテーブルを作成します。
3. Authenticationで **Email（メール・パスワード）** を有効にし、Anonymous Sign-Insは無効にします。Allow new users to sign upも無効にして、管理者が作成した共通アカウントだけを使います。
4. プロジェクトURLとpublishable keyを `.env.local` に設定します。legacy anon keyでも利用できます。**アプリの実行にはservice_role / secret keyを使いません。** 共通アカウント作成・保存専用鍵の初回登録・教材登録にだけ、ローカルの管理者キーを使用します。

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

`supabase/config.toml` はクラス共通アカウント用に新規登録と匿名ログインを無効にします。必要な場合、対応するSupabase CLIで `supabase config diff --project-ref YOUR_PROJECT_REF` を確認し、`supabase config push --project-ref YOUR_PROJECT_REF` で反映できます。

各APIがJWTを`getUser()`で検証し、`CLASS_ACCOUNT_USER_ID`に指定した非匿名ユーザーだけを許可します。RLSは`auth.uid()`に一致する履歴を許可するため、同じ共通アカウントでログインした端末では同じ履歴を共有できます。他のアカウントではクラスのAPIを使えません。回答の保存にはサーバー専用鍵と、DBで発行した未使用・5分以内の保存許可が必要です。質問と回答の保存は1回のトランザクションで実行します。


### クラス共通アカウントを作成

Supabaseプロジェクト作成後に、次の手順で1つのアカウントを発行します。新しい環境では、Supabaseプロジェクトに共通アカウントを作成し、ユーザーIDを設定してください。

1. `.env.setup.example` を `.env.setup` にコピーします。既存の`.env.setup`がある場合は上書きせず編集してください。
2. Supabase URLと、プロジェクトの**secret key（legacy service_role keyも可）**を `.env.setup` に設定します。このファイルはGit対象外で、Next.jsの実行環境には読み込ませません。
3. `CLASS_ACCOUNT_EMAIL` に共通メールアドレスを指定します。パスワードは自動生成されます。自分で設定する場合は `CLASS_ACCOUNT_PASSWORD` に12文字以上を指定します。
4. Node 22以上で `npm run account:create` を実行します。確認メールは送らず、メール確認済みの共通アカウントを管理者APIで作成します。
5. 成功すると、メール・パスワード・ユーザーIDを `.local/class-account.json` に保存します。ファイルはGit対象外で、所有者だけが読み書きできる権限です。パスワードはターミナル出力に表示しません。
6. 出力された `CLASS_ACCOUNT_USER_ID` を `.env.local` とNetlifyに追加します。管理者キーと共通パスワードはNetlifyや `NEXT_PUBLIC_` 変数に登録しません。
7. 接続後、同じメール・パスワードでクラスの各端末からログインします。講師から生徒へログイン情報を共有してください。

既存の `.local/class-account.json` がある場合、作成処理は中止し、アカウントやパスワードを変更しません。通信失敗で完了が不明な場合は、SupabaseのUsers一覧とローカルファイルを照合してください。既存アカウントがある場合は、DashboardのユーザーIDを `CLASS_ACCOUNT_USER_ID` に設定し、現在のパスワードでログインできます。

DashboardのAuthentication → Users → Add userから手動作成することもできます。その場合も、ユーザーIDをアプリの環境変数に設定してください。

### 回答保存専用のサーバー鍵を登録

004の適用後、環境ごとに256ビットのランダム鍵を登録します。この鍵は回答の保存許可・保存だけに使い、DBにはSHA-256を保存します。ブラウザへ渡したり、`NEXT_PUBLIC_`に付けたりしません。未設定・形式不正・DB未登録の場合、AIを呼ぶ前に質問処理を停止します。

開発環境では、開発専用のSupabaseを使用してください。`.env.setup.development`に開発専用の`SUPABASE_URL`と`SUPABASE_SECRET_KEY`、`.env.development.local`に開発の公開接続設定と`CLASS_ACCOUNT_USER_ID`を設定してから実行します。本番キーをコピーしません。

```sh
node --env-file=.env.development.local --env-file=.env.setup.development scripts/configure-exchange-writer.mjs development
```

生成された`.local/exchange-writer.development.json`の`key`を、同じ開発環境の`.env.development.local`の`SUPABASE_EXCHANGE_WRITE_KEY`に設定します。ファイルはGit対象外・所有者のみ読み書き可能で、鍵はターミナルへ表示しません。開発用設定がない場合は実行せず、ログインとAIを無効のままにします。

本番では、リリース承認後に本番用マイグレーションを適用し、本番の設定を使う管理者端末から次を実行します。

```sh
node --env-file=.env.local --env-file=.env.setup scripts/configure-exchange-writer.mjs production
```

`.local/exchange-writer.production.json`の`key`をNetlifyのproduction環境の`SUPABASE_EXCHANGE_WRITE_KEY`へ設定し、新しいコードをリリースします。管理者キーはNetlifyに登録しません。004を適用すると旧コードの質問処理は停止するため、メンテナンス中にDB・専用鍵・アプリを一緒に更新してください。既存の履歴は削除されません。旧コードのみへ戻しても質問処理は復旧しません。

登録が不明な通信失敗では、同じコマンドを再実行すると保存済みの鍵で登録を再試行します。登録済みの場合は再登録しません。鍵を更新する場合は新しい鍵を管理者の`configure_exchange_writer`で登録してサーバー設定も変更し、古い鍵を無効にします。

### 2. Gemini

[Google AI Studio](https://aistudio.google.com/apikey)でAPIキーを用意します。

```dotenv
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
GEMINI_MODEL=gemini-3.8-flash
```

`GEMINI_MODEL`は利用するプロジェクトで有効なモデルIDに変更できます。APIキーはサーバーの環境変数だけで使用します。`NEXT_PUBLIC_`を付けないでください。

環境変数を変更したら開発サーバーを再起動してください。共通アカウントでログインし、質問して、再読み込み後に履歴が残るか確認します。

## Excel VBAの参照資料

[Microsoft LearnのExcel VBAリファレンス](https://learn.microsoft.com/ja-jp/office/vba/api/overview/excel)と[Microsoftの公式VBA原本](https://github.com/MicrosoftDocs/VBA-Docs)から取得した資料を、`data/vba-reference/index.json.gz`に同梱しています。2026年10月9日に取得した7,616記事（うち日本語10記事）の検索用データです。日本語の授業用語をVBAの識別子に対応づけ、記事名と識別子で候補を選び、本文の関連箇所を検索します。日本語・英語が同じ記事の場合は日本語を優先します。「それを詳しく」などの追加質問では、以前の具体的な生徒の質問も検索に使います。

Geminiへ渡す公式資料は最大3件・本文合計4,000文字です。質問時のURL取得と公式資料用の埋め込みAPI呼び出しは行いません。参照指示は1回だけ渡します。回答末尾には、実際に渡した抜粋の資料名・節・公式URLと資料の取得日を表示し、履歴・コピーにも残します。検索用データの読込に失敗した場合は回答生成を停止し、関連箇所が見つからない場合は一般的な説明であることをモデルへ指示して未一致の通知を表示します。

検索はキーワード方式で、未知の日本語表現や画像だけの情報には対応できない場合があります。長い表は見出しを繰り返して行単位で分割します。コードを途中で切らず、1,400文字より長いコード・段落・表の単一行は検索用データから除外します。資料は取得時点のスナップショットであり、現在の仕様を確認したとは主張しません。公式URLから原文を確認できます。通常のAI活用の質問はGeminiの知識と会話を使い、教科書の意味検索は従来どおりSupabaseから行います。

公式資料を更新する場合は、`.local/vba-reference/`に検証済みの資料と`catalog.json`を用意して`npm run references:build`を実行します。原本のチェックサムと出典を確認して検索用データを再生成します。`data/vba-reference/manifest.json`に版・出典・ハッシュを記録し、MicrosoftのCC BY 4.0文書ライセンスとMITコードライセンスを保持します。検索用データはGitに含めるため、Netlifyでもローカル原本や新しいDB・接続設定は不要です。更新にはアプリの再ビルドと公開が必要です。

## コース別の教科書

`src/lib/courses.ts` の `textbookFilenames` で各コースの対象を設定します。同じファイル名を複数コースに指定することもできます。日本語ファイル名の濁点の表現差はNFC正規化して照合します。

- Webサイト制作実践科：GIMP、PHP、Web応用、Webdesighn、web基礎（5冊）
- パソコン・AIスキルアップ科：AI、Word&Excel、Excel＿VBA、表計算応用、表計算活用、PowerPoint、ワープロ活用、Excel応用別冊、ワープロ応用（9冊）

コースの質問では、サーバーの割り当てと登録済みカタログを照合し、対象のファイル名で絞ってから意味検索します。各教材の検索結果を類似度順に統合し、最大6抜粋・9,000文字を渡します。他コースの教科書の明示的な指定には、対応するコースで新しい質問を始めるよう案内します。検索結果がなくても、他コースの教科書へ検索範囲を広げません。追加知識とMicrosoft公式資料は引き続き共通です。

006は履歴に `course_id` を追加します。質問のコースを保存し、再読み込み・別端末で履歴から質問を続けても同じ範囲を使います。会話の途中でのコース変更はAPIと保存関数で拒否します。既存履歴は未分類のまま残し、「新しい質問」からのコース未選択の質問は従来どおり全教科書を検索します。共通アカウントでは全コースを選択でき、コース分けは受講者間のアクセス権の分離ではありません。

006適用後も、旧クライアントの7引数の保存RPCはコース未選択の会話で利用できます。コース付き会話には8引数の対応クライアントが必要です。新しいアプリを使う前に006を適用してください。

## 授業の教科書を登録

`textbook/` のPDF・DOCXを対象に、質問に関連する抜粋をSupabaseで意味検索し、Geminiへ渡します。モデルを再学習する方式ではなく、教材を回答時に参照するRAG方式です。教材ファイルや抽出本文をGitに登録したり、公開ディレクトリに置いたりしません。

1. `supabase/migrations/003_textbook_search.sql` を既存のSupabaseに適用します。pgvector拡張とクラス専用の教材テーブル、検索・登録関数を作成します。
2. macOSのSwift（PDFKit / Vision）とLibreOfficeを用意して `npm run textbooks:extract` を実行します。文字が少ないPDFページには日本語OCRを適用します。Wordは日本語フォントを設定して作業用PDFに変換します。`soffice` がPATHにない場合は `SOFFICE_BIN` に実行ファイルの絶対パスを指定します。
3. 抽出結果はGit対象外の `.local/textbooks/` に保存します。各ページの本文・抽出方法と、原本のSHA-256を記録します。空白ページと25文字未満のページは検索から除外します。画像内だけの情報や細かなコード・数値は読み取れない場合があるため、原本で確認してください。
4. **教材本文をGoogleのGemini APIとSupabaseへ送信することが許可されている場合に**、`npm run textbooks:import` を実行します。既存の `.env.local` とローカル管理者用 `.env.setup` を読みます。必要な変数は `GEMINI_API_KEY`、`CLASS_ACCOUNT_USER_ID`、`SUPABASE_SECRET_KEY`、Supabase URLです。管理者キーはNetlifyには設定しません。
5. `gemini-embedding-001` の768次元ベクトルを作成し、1件最大1,700文字の抜粋と一緒にSupabaseへ登録します。ローカルにベクトルをキャッシュし、同じ原本は再送しません。抽出方法を変更した同じ原本を置き換える場合は `npm run textbooks:import -- --force` を使用します。文書ごとの入れ替えはトランザクションで行い、他の文書や質問履歴は変更しません。
6. アプリで「VBAの教科書で変数の宣言を説明して」などと質問し、教材名とページが回答・履歴に残ることを確認します。

回答時は登録済みの全分野の教材を検索します。教材名やVBAの指定があれば対象を絞り、PDFページの指定にも対応します。検索結果は最大6件・合計9,000文字で、Geminiの入力情報として渡します。クラス共通アカウントのJWT・RLSを使い、匿名ユーザーや別アカウントから教材を読むことはできません。生徒には教材の読み取り権限だけを付け、登録・置換にはローカル管理者キーが必要です。

参照欄には、回答本文で［教材1］のように根拠として引用した抜粋だけを表示します。同じ教科書・同じPDFページの抜粋は「教材1・教材3」のように1行へまとめ、本文の番号との対応を残します。引用がない回答には参照欄を付けません。この表示は新しい回答から適用し、保存済みの回答は書き換えません。

参照欄のPDFページはファイルの先頭からの番号です。Word教材はPDF変換版のページ番号として明記し、元のWord表示のページ番号と一致すると主張しません。教科書の検索が失敗した場合は再試行を案内し、該当箇所が見つからなければその旨を表示します。未登録の教科書について質問された場合は「登録がまだ完了していません」と表示します。教材の原文は命令ではなく資料として扱い、ヒントモードの方針も維持します。

Netlifyの実行環境で教材の抽出処理は不要です。一度登録した教材をSupabaseから検索するので、既存の環境変数だけで利用できます。教材更新時は管理者のローカル環境から再抽出・再登録します。

## 小ネタ・FAQ用の追加知識テーブル

`supabase/migrations/005_knowledge_entries.sql` は `public.knowledge_entries` を作成します。モデルの再学習は行いません。チャットは質問・具体的な追加質問の履歴から日本語や英語の単語を取り出し、有効な追加知識の質問・答えを部分一致で検索してGeminiへ渡します。登録画面は含みません。

| 列 | 用途 |
| --- | --- |
| `id` | 自動生成するUUID |
| `question` | 質問・見出し（必須、最大500文字） |
| `answer` | 教えたい内容（必須、最大3,000文字） |
| `is_active` | 有効・無効。初期値は有効 |
| `created_at` / `updated_at` | 作成日時・更新日時。更新日時は自動更新 |

管理者が対象プロジェクトのSupabase SQL EditorまたはTable Editorから登録・編集します。全利用者共通の情報として保存し、質問が重複しない制約があります。例えば、架空のサンプルとして `question` に「サンプル先生の好きな食べ物は？」、`answer` に「カレーです。」を指定します。この例はマイグレーションで自動登録しません。

ログイン済みの全利用者には、同じ `is_active = true` の行を読む権限を与えます。クラスやアカウントへの紐づけはなく、アカウントを削除しても追加知識は残ります。登録・編集・削除は管理者用の権限で行い、匿名ユーザーには公開しません。権限設計は[SupabaseのRLSガイド](https://supabase.com/docs/guides/database/postgres/row-level-security)に沿っています。

検索はログイン済み利用者の接続とRLSを使い、アプリには管理者キーを追加しません。最大12語を使い、更新の新しい候補50件から関連度順に最大4件・質問と答えの合計6,000文字を渡します。意味検索ではないため、同じ単語がない言い換えでは見つからない場合があります。取得失敗時は検索エラーを表示し、情報が未登録だとは答えません。

追加知識に答えがあれば、教科書で一致する抜粋がなくても回答に使います。追加知識を教科書の出典として表示せず、この場合は教科書の未一致注記も付けません。登録・更新・無効化は次の質問から反映され、アプリの再公開は不要です。

開発用DBへ先に適用・検証し、本番への適用は承認されたリリース手順で行います。開発環境に本番の接続設定しかない場合、本番へは適用しません。

## 講師への質問

回答の下の「講師に質問」から、確認したいことを2,000文字以内で入力して送信します。元の質問・AIの回答・コースをDBの保存済み履歴から取得し、質問に添えて受け付けます。サイドバーの「講師への質問」で受付内容と返信を確認できます。クラス共通アカウントのため、質問・返信はクラス全員で共有されます。送信前にも表示します。個人情報は入力しないでください。

開発用DBに`007_instructor_questions.sql`、`008_instructor_question_notifications.sql`、`009_instructor_edge_dispatch.sql`、`010_notification_recipients.sql`を順に適用してください（006までの適用が必要です）。009にはSupabaseの`pg_net`・`pg_cron`・Vaultが必要です。本番への適用・公開は通常のリリース手順で別途行います。受付先はSupabaseの`public.instructor_questions`です。メール通知を使わない場合、メールサービスの設定は不要です。返信はベストエフォートです。

講師・管理者は対象プロジェクトのSupabase Table Editorで質問を確認し、`reply`列に返信を登録します。`replied_at`は自動設定され、受講者が一覧の「受付状況・返信を更新」を押すと表示されます。講師向けアプリ内管理画面や独立した講師ログインは含みません。管理者のSupabaseアカウントを受講者に共有しないでください。

受講者は自クラスの質問の閲覧と、サーバー専用鍵を検証する関数経由の送信だけが可能です。直接の登録・編集・削除や返信の更新はできません。参照する質問・回答のハッシュをDBで検証し、会話の同時更新による別の回答への取り違えを防ぎます。同じAI回答への質問はクラスで1件となり、再送時は元の受付内容を返します。クラス全体で新規受付は10件/時間です（AI質問の30件/時間とは別枠）。

元の会話履歴を削除しても受付内容と返信は残ります。アカウントを削除すると、そのクラスの受付内容も削除されます。一覧には最新100件を表示します。

### 講師へのメール通知

新しい質問を受け付けると、Supabase Edge Functionの`instructor-notifications`が管理者の設定した`INSTRUCTOR_NOTIFICATION_TO`へResend経由で通知します。宛先はEdge Functionの設定のみで指定し、受講者から変更できません。未設定・不正な形式では通知待ちデータを取得せず停止し、既定の宛先への送信は行いません。件名は「【Linqs】講師への質問が届きました」で、本文に受付ID・受付日時・コースID・会話タイトル・講師への質問・元の質問・AIの回答をプレーンテキストで記載します。受講者には送信前にメール通知への利用を表示します。通知メールへの返信はアプリに反映されず、従来どおりSupabaseの`reply`列に登録します。

有効化の手順:

1. Resendで送信元ドメインを認証し、送信に使うAPIキーを作成します。APIキーはチャットやGitへ貼り付けません。[Resendの送信API](https://resend.com/docs/api-reference/emails/send-email)
2. `008_instructor_question_notifications.sql`・`009_instructor_edge_dispatch.sql`・`010_notification_recipients.sql`を先に開発用DBで検証し、承認されたリリース時に本番DBへ適用します。過去の受付分は通知待ちに追加しません。
3. `supabase/functions/.env.example`を参考に、対象プロジェクトのEdge Function Secretsへ`LINQS_EXCHANGE_WRITE_KEY`（既存の保存専用鍵）・`LINQS_CLASS_ACCOUNT_USER_ID`・`LINQS_SUPABASE_PUBLISHABLE_KEY`・`RESEND_API_KEY`・`INSTRUCTOR_NOTIFICATION_FROM`・`INSTRUCTOR_NOTIFICATION_TO`・`INSTRUCTOR_EMAIL_NOTIFICATIONS_ENABLED=true`を登録します。認証済み送信元の例は`Linqs <notifications@example.com>`（送信元）と`teacher@example.com`（宛先、実運用時は管理者のアドレスに変更）です。NetlifyへメールのAPIキーは登録しません。関数は管理者キーを使わず、公開キーと専用鍵で自クラスの通知だけを処理します。
4. 管理者がSupabase Vaultへ`linqs_notification_project_url`（`https://<project-ref>.supabase.co`）と`linqs_notification_worker_key`（同じ保存専用鍵）を登録します。値はSQL Editorの履歴やGitへ貼らず、管理用の安全な経路から設定します。
5. Supabase CLI 3では`supabase functions deploy instructor-notifications --remote=<project-ref> --use-api`で関数を公開し、SupabaseのCron画面で`linqs-instructor-notifications`が5分間隔で登録されていることを確認します。[Edge Functionsの公開](https://supabase.com/docs/guides/functions/deploy)、[Supabaseでの定期実行](https://supabase.com/docs/guides/functions/schedule-functions)

質問と通知待ちデータを同じDBトランザクションで保存し、DBトリガーが`pg_net`でEdge Functionを呼び出します。HTTPリクエストはコミット後に実行されます。メール障害・設定不足・HTTPリクエストの登録失敗でも質問の受付と通知待ちデータを残します。Supabase Cron（`pg_cron`）が5分ごとに最大2件ずつ再試行します。Netlifyの通知用関数・定期処理は使いません。ローカル検証ではテスト内の認証・メールAPIモックを使用し、開発へ本番キーをコピーしないでください。

呼び出しは既存の専用鍵によるHMAC-SHA256署名と5分以内のタイムスタンプで検証します。`verify_jwt=false`はこの署名で認証するための設定で、署名のないリクエスト・受講者のJWT・公開キーだけでは通知を実行できません。署名には本文全体を含め、改ざんを拒否します。HTTPキューには専用鍵の平文を置きません。[関数の認証](https://supabase.com/docs/guides/functions/auth)

送信済み状態をDBへ記録し、再送・同時実行・24時間以上経過した後の重複通知を防ぎます。送信結果の保存前に停止した場合に備え、同じ受付IDを[Resendの冪等キー](https://resend.com/docs/dashboard/emails/idempotency-keys)にも使います。最初に使用した送信元と宛先を通知ごとに保持し、後から環境変数や講師の返信を変更しても再試行時の宛先・本文は変わりません。メールAPIの受付完了を送信済みとし、受信箱への到着は保証しません。

宛先設定を導入する既存環境では、010を適用してから新しいEdge Functionを公開します。010の適用前に実際の送信試行があり、宛先が保存されていない未完了の通知は、新ワーカーで`needs_review`へ移します。宛先や送信済みかどうかを推測して再送せず、管理者がメールサービスの履歴と照合してください。既に送信済みの通知や過去の質問を自動で再通知しません。新しいRPCが未適用の場合も旧RPCや固定宛先へフォールバックしません。本番への010適用・宛先登録・Edge Function公開は、リリース承認後に実施します。

失敗は最大12回、最初の送信試行から23時間まで再試行し、その後は`needs_review`として自動送信を止めます。Resendの冪等キーが24時間で失効した後の不確かな再送を避けるためです。管理者はSQL Editorで次のクエリから状態を確認できます。`needs_review`はResend側の送信履歴を照合し、送信有無を確認してから対応してください。状態やキーは受講者へ公開しません。

```sql
select q.id, q.created_at, n.status, n.attempts, n.sent_at, n.provider_id
from public.instructor_questions q
join linqs_private.instructor_question_notifications n on n.question_id = q.id
order by q.created_at desc;
```

## Netlifyで公開

1. このディレクトリを自分のGitリポジトリにpushします。
2. Netlifyの **Add new project → Import an existing project** から接続します。
3. `netlify.toml` がビルドコマンド `npm run build:checked`、公開ディレクトリ `.next`、Node 22を設定します。NetlifyのNext.jsアダプターは自動検出されます。静的HTMLへのexportは使用しません。
4. NetlifyのEnvironment variablesに `.env.example` の6項目をproductionコンテキストで設定します。メール通知の設定はSupabase Edge Function Secretsで管理します。Geminiキーと保存専用鍵はFunctionsの実行時にも利用できるスコープにしてください。`NEXT_PUBLIC_`の2項目はビルド時にも必要です。
5. Deployを実行します。環境変数を変更した場合も再デプロイが必要です。
6. 公開URLで質問・追加質問・履歴・保存・削除を確認します。

Gemini/Supabase/Netlifyの実際のアカウント設定と公開には、利用者のアカウントアクセスが必要です。このソースコードだけではリモートのサービスを作成・設定しません。

## mainとdevの運用

| ブランチ | 公開先 | 接続 |
| --- | --- | --- |
| `main` | https://linqs.link-st.art/ | 本番のGemini・Supabase |
| `dev` | http://localhost:3000/ | `.env.development.local`の開発用設定。未設定時はログイン停止 |

変更は`dev`で作成します。GitHub Actionsの`Quality checks`で型チェック、API・DBテスト、本番ビルド、デスクトップ・モバイルのブラウザテストを実行します。ブラウザテストはCI内で認証とAPI通信を模擬し、共通アカウントのログイン・質問・履歴操作を確認します。本番データや実際のAPIキーを使用しません。

ローカルの`http://localhost:3000`で変更内容を確認してから、`dev`から`main`へのPRを作成します。`main`はPRと最新状態での`Quality checks`成功を必須にし、直接push・強制push・ブランチ削除を禁止します。PRの自動マージは使わず、本番反映の指示後にマージします。Netlifyも`npm run build:checked`を実行し、型・API・DBのチェックが失敗した場合は公開しません。

```sh
git switch dev
git pull --ff-only origin dev
# 変更・確認・commit後
git push origin dev
gh pr create --base main --head dev
# 開発確認とCI成功後にPRをマージ
# マージ後はdevへmainのマージ履歴を取り込む
git fetch origin
git merge origin/main
git push origin dev
```

NetlifyのProduction branchは`main`、Branch deploysは**None**、Deploy Previewsは**無効**にします。APIで設定する場合は`allowed_branches: ["main"]`、`skip_prs: true`とします。`allowed_branches: []`は全ブランチの許可になるため使いません。`dev`へのpushとPR作成ではNetlifyにデプロイせず、GitHub Actionsのチェックだけを実行します。本番反映は、ローカルでの確認とCI成功後に`dev`から`main`へのPRをマージして行います。

Netlifyの環境変数の6項目はproductionコンテキストに設定します。ローカル開発用のSupabase・Gemini設定は`.env.development.local`に登録し、本番キーをコピーしません。開発環境で本番の履歴を変更しない構成にします。

## 履歴と運用上の仕様

- 同じ共通アカウントなら別端末でも同じ質問履歴を使えます。履歴画面の「クラスの履歴を更新」で他の端末の最新の質問を取得します。
- クラス内では質問内容と削除操作も共有されます。誰かが削除すると全員の履歴から消えます。生徒個人の識別は行いません。
- 「この端末からログアウト」はlocal scopeを使い、他の生徒をログアウトさせません。ブラウザデータを消した場合も、再ログインで履歴を取得できます。
- Supabaseの「Single session per user」は有効にしないでください。複数端末から同時に使う構成です。
- 保存した質問（しおり）と解説・ヒントの設定は、端末のブラウザごとに保存されます。しおりは質問IDだけをブラウザへ保存し、他端末へ同期しません。初回は以前クラスで共有していた保存マークを引き継ぎ、その後はこのブラウザで保存・解除します。ログアウト後も維持します。ブラウザデータを消すと端末の保存設定は失われます。
- 「保存した質問」には保存解除だけを表示します。共有履歴からの質問削除は「質問の履歴」で行います。
- 本接続の質問内容は回答のためGeminiに送信され、Supabaseに保存されます。画面の使い方にも表示しています。
- Geminiの回答が成功して保存が失敗した場合は、回答と未保存通知を表示します。その会話の追加送信を止め、保存された文脈と表示の食い違いを防ぎます。
- モデルには直近20メッセージを渡します。履歴一覧は更新の新しい100会話を表示します。
- 質問制限は共通アカウント単位で、**クラス全体で30回/時間**です。Netlifyの複数インスタンスでも共有されます。失敗したGeminiへのリクエストも回数に含みます。
- 教員向け管理画面、教材アップロード画面、添付画像、個別の生徒アカウントは含みません。
- 回答内の画像は代替テキストだけを表示し、外部画像を自動取得しません。HTMLを無効にし、CSPでも外部画像・埋め込みを制限します。

## 開発・確認

```sh
npm run typecheck
npm test
npm run build
npm run security:audit
# 公式Gitleaks 8.30.1をPATHへ登録後
npm run security:secrets
```

ブラウザテストはCIでダミーの公開接続設定を使い、認証とAPI通信をテスト内だけで模擬します。ローカルで実行する場合も、次の設定でビルドしてテスト専用サーバーを起動します。

```sh
npx playwright install chromium
NEXT_PUBLIC_SUPABASE_URL=https://linqs-test.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=ci-public-test-key npm run build
CI=1 NEXT_PUBLIC_SUPABASE_URL=https://linqs-test.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=ci-public-test-key npm run test:browser
```

DBテストはPGliteのPostgreSQLエンジンで実際のマイグレーション・RLS・権限・トランザクションを検証します。APIテストでは認証とGeminiをモックして、入力上限・認証エラー・回数制限・保存失敗時の動作を確認します。GeminiとSupabaseの本接続は実際の設定後に別途確認してください。

## OSS公開とセキュリティ

Linqs本体のソースコードには[MITライセンス](../LICENSE)を用意しています。同梱するMicrosoft公式資料は別ライセンスです。`data/vba-reference/LICENSE`（CC BY 4.0）と`LICENSE-CODE`（MIT）、出典情報を保持してください。授業の教科書・生徒の履歴・秘密情報は公開物に含めません。

公開前にGitHubのSecret scanning・Push protection・Private vulnerability reportingを利用可能な範囲で有効にしてください。[SECURITY.md](../SECURITY.md)に報告方法と運用方針を記載しています。GitHub Actionsの`Quality checks`には全Git履歴と公開予定ファイルの秘密情報スキャン、低重大度を含む依存関係の脆弱性チェックを組み込みます。Dependabotは`dev`向けに更新PRを作成し、本番への反映は従来どおり承認後に行います。

公開準備・既存Git履歴とActionsの取り扱いは[公開手順](PUBLIC_RELEASE.md)、第三者素材・依存ライブラリの扱いは[第三者ライセンス通知](../THIRD_PARTY_NOTICES.md)、変更提案の方法は[貢献手順](../CONTRIBUTING.md)にまとめています。依存関係のライセンス一覧は`npm run licenses:update`で更新し、`npm run licenses:check`でlockfileとの整合性を確認します。

公開対象はアプリのソースコードです。Gemini・Supabase・Netlify・任意のメールサービスは各利用者が自分の契約・キー・費用で設定します。教科書・質問履歴・本番設定は同梱しません。`package.json`の`private: true`はnpmへの誤公開を防ぐ設定で、GitHubでのソース公開を禁止するものではありません。

## 構成

```text
src/app/api/chat/route.ts           質問の検証・認証・Gemini・履歴保存
src/app/api/conversations/route.ts  履歴の取得・保存・削除
src/components/learning-app.tsx    学習チャット画面
src/components/class-login.tsx     クラス共通ログイン画面
scripts/create-class-account.mjs   共通アカウントの一度限りの発行
src/lib/tutor.ts                   質問内容・回答モードのシステム指示
src/lib/vba-reference.ts           公式資料の抜粋指示・取得済み出典の表示
src/lib/vba-search.ts              保存済みVBA公式資料の検索・抜粋の上限管理
data/vba-reference/                公式資料の検索用スナップショット・出典・ライセンス
scripts/build-vba-reference-index.mjs  検証済み原本から検索用データを再生成
src/lib/textbooks.ts               教科書の意味検索・抜粋・教材ページの出典表示
scripts/extract-textbooks.mjs      PDF・Wordの抽出と日本語OCR
scripts/import-textbooks.mjs       教材ベクトルの生成・クラス専用DBへの登録
src/lib/suggestions.ts             質問入力の例
supabase/migrations/               テーブル・RLS・保存関数・質問回数制限
netlify.toml                       Netlifyビルド設定
```

## 公式資料

- [Microsoft Learn Excel VBAリファレンス](https://learn.microsoft.com/ja-jp/office/vba/api/overview/excel)
- [Gemini埋め込み](https://ai.google.dev/gemini-api/docs/embeddings)
- [Supabaseベクトル検索](https://supabase.com/docs/guides/ai/semantic-search)
- [Gemini URL context](https://ai.google.dev/gemini-api/docs/generate-content/url-context)
- [Gemini SDKとAPI](https://ai.google.dev/gemini-api/docs/get-started)
- [Geminiモデル一覧](https://ai.google.dev/gemini-api/docs/models)
- [Supabaseメール・パスワードログイン](https://supabase.com/docs/reference/javascript/auth-signinwithpassword)
- [Supabaseアカウント作成API](https://supabase.com/docs/reference/javascript/auth-admin-createuser)
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [NetlifyのNext.js対応](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/)


## プロンプトインジェクション対策

質問・会話履歴・教科書・公式資料・追加知識は、信頼できない資料としてJSONの文字列に分離してGeminiへ渡します。過去のAI回答もsystem/modelの指示として再利用せず、履歴データとして扱います。固定のsystemInstructionで、資料内の命令・役割偽装・内部指示や秘密の開示・外部送信の要求に従わない方針を指定します。AI授業で攻撃例やプロンプトの仕組みを学ぶ質問は、単語だけで拒否しません。

GeminiにはJSON形式の回答を要求し、サーバー側でstatus・answer・文字数・余分なフィールドを検証します。不正な形式、拒否された要求、予期しないツール呼び出し、設定済みの実際のサーバー鍵の混入を検出した場合は、回答を保存・表示しません。現在の質問に実際のサーバー鍵が含まれる場合は、検索やGemini呼び出し前に停止します。ツール・コード実行・外部検索は有効にせず、DB操作と認可は従来どおりサーバーの固定処理とRLSで制御します。

回答のリンクは、`src/lib/answer-links.ts`の文書サイト許可リストにあるHTTPSのURLだけをクリック可能にします。任意の外部サイト、偽装ホスト、認証情報・クエリ付きURLは本文の文字として表示し、保存済みの回答にも同じ制限を適用します。HTML・外部画像の無効化とCSPも維持します。

これらは複数層でリスクを減らす対策であり、任意の命令上書きや全ての難読化を完全に検出する保証ではありません。構造化出力は形式を保証するための仕組みで、回答内容の正しさや安全性そのものの保証にはなりません。設定済み鍵との一致検査は、その鍵の平文・URLエンコード・Base64表現を対象とし、未知の秘密全般を識別するものではありません。実モデルでの評価には架空の入力だけを使い、本番DBを変更しません。

設計の参考: [OWASPのプロンプトインジェクション対策](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)、[Geminiの構造化出力](https://ai.google.dev/gemini-api/docs/structured-output)。
