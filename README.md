# Linqs — 生徒の質問を受けるAI学習パートナー

Next.js App Router + Gemini API + Supabase + Netlifyで作った日本語の学習チャットです。

職業訓練校でAI活用・Excel VBAを学ぶ生徒向けです。成人の学習者に丁寧な日本語で、質問内容に合わせて基礎から業務での応用まで説明します。

## できること

- 職業訓練校のAI活用・Excel VBAの質問と、会話を踏まえた追加質問
- 学習分野の選択は不要。質問内容から関連する教材・公式資料を検索
- 「解説」と「ヒント」の切り替え
- textbookフォルダのPDF・Word教科書を検索し、教材名・PDFページを示して回答
- VBAの質問で保存済みMicrosoft公式資料から抜粋を検索し、回答と履歴に出典リンクを表示
- Markdown・VBAのコード・表・LaTeX数式の表示、回答のコピー
- 質問履歴の検索、しおり保存、削除
- Supabaseのクラス共通メール・パスワード認証と、クラスで共有する履歴
- サーバー側のGemini呼び出し、入力検証、クラス全体で30回/時間の質問制限
- スマートフォン対応、キーボード送信、読み込み・エラー表示

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
2. SQL Editorで `supabase/migrations/001_learning_assistant.sql`、`002_vocational_subjects.sql`、`003_textbook_search.sql`、`004_server_exchange_writer.sql`、`005_knowledge_entries.sql` の順に一度ずつ実行します。既存のプロジェクトには未適用のマイグレーションだけ実行します。002は以前の教科の履歴を「すべて」に分類し直し、質問・回答を残します。003は教科書検索用のテーブルと関数を作成し、教材を未登録の状態でも質問APIに必要です。004は既存の履歴を残し、ログイン情報だけで回答を書き込める旧関数を非公開にします。005は追加知識・小ネタ・FAQを保存するテーブルを作成します。
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

1. `.env.setup.example` を `.env.setup` にコピーします。この作業環境では希望のメールアドレスだけ設定した `.env.setup` を用意済みです。上書きせず、そのファイルを編集してください。
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

管理者が対象プロジェクトのSupabase SQL EditorまたはTable Editorから登録・編集します。全利用者共通の情報として保存し、質問が重複しない制約があります。例えば `question` に「理恵子先生の好きな食べ物は？」、`answer` に「想夫恋の焼きそばです。」を指定します。この例はマイグレーションで自動登録しません。

ログイン済みの全利用者には、同じ `is_active = true` の行を読む権限を与えます。クラスやアカウントへの紐づけはなく、アカウントを削除しても追加知識は残ります。登録・編集・削除は管理者用の権限で行い、匿名ユーザーには公開しません。権限設計は[SupabaseのRLSガイド](https://supabase.com/docs/guides/database/postgres/row-level-security)に沿っています。

検索はログイン済み利用者の接続とRLSを使い、アプリには管理者キーを追加しません。最大12語を使い、更新の新しい候補50件から関連度順に最大4件・質問と答えの合計6,000文字を渡します。意味検索ではないため、同じ単語がない言い換えでは見つからない場合があります。取得失敗時は検索エラーを表示し、情報が未登録だとは答えません。

追加知識に答えがあれば、教科書で一致する抜粋がなくても回答に使います。追加知識を教科書の出典として表示せず、この場合は教科書の未一致注記も付けません。登録・更新・無効化は次の質問から反映され、アプリの再公開は不要です。

開発用DBへ先に適用・検証し、本番への適用は承認されたリリース手順で行います。開発環境に本番の接続設定しかない場合、本番へは適用しません。

## Netlifyで公開

1. このディレクトリを自分のGitリポジトリにpushします。
2. Netlifyの **Add new project → Import an existing project** から接続します。
3. `netlify.toml` がビルドコマンド `npm run build:checked`、公開ディレクトリ `.next`、Node 22を設定します。NetlifyのNext.jsアダプターは自動検出されます。静的HTMLへのexportは使用しません。
4. NetlifyのEnvironment variablesに `.env.example` の6項目をproductionコンテキストで設定します。Geminiキーと保存専用鍵はFunctionsの実行時にも利用できるスコープにしてください。`NEXT_PUBLIC_`の2項目はビルド時にも必要です。
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

Linqs本体のソースコードには[MITライセンス](LICENSE)を用意しています。同梱するMicrosoft公式資料は別ライセンスです。`data/vba-reference/LICENSE`（CC BY 4.0）と`LICENSE-CODE`（MIT）、出典情報を保持してください。授業の教科書・生徒の履歴・秘密情報は公開物に含めません。

公開前にGitHubのSecret scanning・Push protection・Private vulnerability reportingを利用可能な範囲で有効にしてください。[SECURITY.md](SECURITY.md)に報告方法と運用方針を記載しています。GitHub Actionsの`Quality checks`には全Git履歴と公開予定ファイルの秘密情報スキャン、低重大度を含む依存関係の脆弱性チェックを組み込みます。Dependabotは`dev`向けに更新PRを作成し、本番への反映は従来どおり承認後に行います。

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
