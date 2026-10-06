import type { AnswerMode, Subject } from "./types";

type Suggestion = { tag: string; title: string; prompt: string; subject: Subject };
const mail: Suggestion = { tag: "AI活用", title: "業務メールの下書きをAIで作るには？", prompt: "AIで業務メールの下書きを作るプロンプトの書き方を教えて", subject: "AI活用" };
const cell: Suggestion = { tag: "VBAの基礎", title: "セルA1に文字を入力するには？", prompt: "Excel VBAでセルA1に文字を入力する方法を教えて", subject: "Excel VBA" };
const error: Suggestion = { tag: "エラー対応", title: "実行時エラー1004が出たら？", prompt: "Excel VBAの実行時エラー1004が出たとき、何を確認すればよいですか？", subject: "Excel VBA" };
const prompt: Suggestion = { tag: "プロンプト", title: "AIへの指示を具体的にするには？", prompt: "AIへの指示を具体的にするための4つのポイントを教えて", subject: "AI活用" };
const check: Suggestion = { tag: "回答の確認", title: "AIの回答が正しいか確認したい", prompt: "AIの回答が正しいか確認する方法を教えて", subject: "AI活用" };
const loop: Suggestion = { tag: "繰り返し", title: "For Nextの仕組みを知りたい", prompt: "Excel VBAのFor Nextの仕組みを例で教えて", subject: "Excel VBA" };

export const suggestions: Record<Subject, Suggestion[]> = {
  "すべて": [mail, cell, error],
  "AI活用": [mail, prompt, check],
  "Excel VBA": [cell, loop, error],
};

// Only exact, advertised questions use fixed samples; free-form questions need Gemini.
export function demoAnswer(question: string, mode: AnswerMode): string {
  if (question === cell.prompt) {
    if (mode === "hint") return "### まずはヒント\nセルに文字を入れるには、**対象のシート → セル → 書き込む値**を指定します。\n\nセルの指定には `Range(\"A1\")`、値の指定には `.Value` を使います。\n\n**どのブックの、どのシートのA1に書き込むか**を先に考えてみましょう。";
    return `### セルに文字を入力する基本
この例は、**マクロを保存したブックの先頭シートのA1を上書き**します。空のテスト用ブックで確認してください。

\`\`\`vba
Option Explicit

Sub WriteGreeting()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Worksheets(1)
    ws.Range("A1").Value = "こんにちは"
End Sub
\`\`\`

1. \`Option Explicit\`：変数の宣言を必須にします。
2. \`Sub ... End Sub\`：マクロの始まりと終わりです。
3. \`Dim ws As Worksheet\`：シートを入れる変数を用意します。
4. \`ThisWorkbook.Worksheets(1)\`：このコードが保存されているブックの先頭シートです。
5. \`Range("A1").Value\`：A1に文字を書き込みます。

**実行手順：** デスクトップ版ExcelでVBEを開き、「挿入 → 標準モジュール」に貼り付けて、\`WriteGreeting\` を実行します。Web版ExcelではVBAを実行できません。マクロを残す場合は **.xlsm** 形式で保存します。

**確認：** A1に「こんにちは」が入ったら成功です。B1に変えるには、どの部分を変更しますか？`;
  }
  if (question === loop.prompt) {
    if (mode === "hint") return "### まずはヒント\n`For i = 1 To 3` は、iを1、2、3と変えながら同じ処理を行います。\n\n**3回実行したい処理**は、`For` と `Next` の間に書きます。表示する数はどの変数に入っているでしょうか？";
    return `### For Nextは、同じ処理を繰り返す仕組み
次の例は1から3までの数を表示します。セルの値は変更しません。

\`\`\`vba
Option Explicit

Sub CountThree()
    Dim i As Long
    For i = 1 To 3
        Debug.Print i
    Next i
End Sub
\`\`\`

- \`Dim i As Long\`：整数を入れる変数を宣言します。
- \`For i = 1 To 3\`：1から3まで、1ずつ増やして処理します。
- \`Debug.Print i\`：現在のiをイミディエイトウィンドウに表示します。
- \`Next i\`：次の値で繰り返し、3まで終わるとループを抜けます。

デスクトップ版ExcelのVBEで標準モジュールに貼り付け、「表示 → イミディエイトウィンドウ」を開いて実行します。**1、2、3**と表示されれば成功です。

**確認：** 5まで表示するには、どこを変えればよいでしょうか？`;
  }
  if (question === error.prompt) return mode === "hint"
    ? "### まずはヒント\n1004は原因が一つとは限りません。VBEで止まった行を確認すると、調べる範囲を絞れます。\n\n**エラーの全文と、黄色く表示された行**は何ですか？実際の業務データは架空の値に置き換えてください。"
    : "### エラー1004は、止まった行から確認します\n番号だけでは原因を特定できません。セル範囲の指定やシートの保護など、状況によって異なります。\n\n1. **エラー全文**と、VBEで黄色く表示された行を控えます。\n2. **対象のブック・シート・セル範囲**が意図どおりか確認します。\n3. 書き込み処理なら、シートの保護や結合セルなどの条件も確認します。\n4. コピーしたテスト用ブックで、原因候補を一つずつ確認します。\n\n質問するときは、該当コード、Windows/Macなどの環境、期待した結果と実際の結果を添えてください。機密情報は架空の値に置き換えます。\n\n**体験モードではコードを診断しません。** Gemini接続後は、追加の情報を基に一緒に原因を絞れます。";
  if (question === mail.prompt || question === prompt.prompt) {
    if (mode === "hint") return "### まずはヒント\nAIに頼む前に、**目的・入力情報・条件・出力形式**を整理します。\n\n業務メールなら、**誰に、何を伝えるためのメールか**から考えてみましょう。";
    return `### 目的・情報・条件・形式を伝えます
「メールを書いて」だけでなく、次の4点を指定すると、必要な回答を得やすくなります。

| 項目 | 架空の業務メールの例 |
|---|---|
| 目的 | 打ち合わせ日程を変更したい |
| 入力情報 | 10月5日10時から、10月6日14時への変更を相談 |
| 条件 | 丁寧な敬語、変更理由は追加しない |
| 出力形式 | 件名と本文、200字程度 |

**プロンプトの例：**
> 取引先への日程変更の相談メールを作成してください。現在は10月5日10時、希望は10月6日14時です。変更理由は推測せず、丁寧な敬語で、件名と本文を200字程度で出力してください。宛名は「A社 ご担当者様」にしてください。

**確認：** 日程や表現を見直し、送信前にご自身で判断します。実際の顧客名・連絡先・社内機密は入力しません。

別の業務で使うなら、この4点に何を指定しますか？`;
  }
  if (question === check.prompt) return mode === "hint"
    ? "### まずはヒント\nAIの回答には、自然な文章でも間違いが含まれることがあります。\n\n**資料で確認する必要がある数字や固有名詞**は、どの部分でしょうか？"
    : "### 回答を、そのまま業務に使う前に確認します\n\n1. **事実を分ける**：数字、日付、制度名など、確認が必要な点を拾います。\n2. **元の資料と照合する**：講師の教材や公式資料で確かめます。AIが示したURLも、実際に開いて内容を確認します。\n3. **結果を試す**：VBAならコピーしたテスト用のブックで動かし、想定した結果になるか確認します。\n4. **不明点を残す**：確認できない点は事実として扱わず、講師に相談します。\n\nAIにもう一度聞くだけでは、正しさの確認にはなりません。\n\n**確認：** 業務メールの下書きで、送信前に確かめる項目を3つ挙げてみましょう。";
  return "### いまは体験モードです\n自由な質問や追加質問へのAI回答は、Gemini接続後に利用できます。ここでは、質問例に用意した固定サンプルを表示します。\n\n「新しい質問」から、業務メールのプロンプト、セルA1への書き込み、エラー1004の確認などをお試しください。";
}
