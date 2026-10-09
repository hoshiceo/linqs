import type { Subject } from "./types";

type Suggestion = { tag: string; title: string; prompt: string; subject: Subject };
const mail: Suggestion = { tag: "AI活用", title: "業務メールの下書きをAIで作るには？", prompt: "AIで業務メールの下書きを作るプロンプトの書き方を教えて", subject: "AI活用" };
const cell: Suggestion = { tag: "VBAの基礎", title: "セルA1に文字を入力するには？", prompt: "Excel VBAでセルA1に文字を入力する方法を教えて", subject: "Excel VBA" };
const error: Suggestion = { tag: "エラー対応", title: "実行時エラー1004が出たら？", prompt: "Excel VBAの実行時エラー1004が出たとき、何を確認すればよいですか？", subject: "Excel VBA" };

export const suggestions: Suggestion[] = [mail, cell, error];
