import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { ApiError } from "./server";
import type { Subject } from "./types";
import type { VbaExcerpt, VbaReferenceResult } from "./vba-reference";

export const VBA_CONTEXT_CHARACTERS = 4000;
export const VBA_CONTEXT_EXCERPTS = 3;
const officialUrl = z.string().refine(value => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.host === "learn.microsoft.com" && !url.username && !url.password && !url.search && !url.hash && /^\/(ja-jp|en-us)\/office\/vba\//.test(url.pathname);
  } catch { return false; }
});
const indexSchema = z.object({
  version: z.literal(1), retrievedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  documents: z.array(z.object({ title: z.string().min(1).max(500), url: officialUrl, locale: z.enum(["ja-jp", "en-us"]), chunks: z.array(z.object({ section: z.string().max(1000), content: z.string().min(1).max(1400) })).min(1) })).min(1),
});
type ReferenceIndex = z.infer<typeof indexSchema>;
const normalize = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const followUp = (text: string) => /^(?:それ|その|これ|この|もう少し|もっと|具体的|詳しく|続き)/.test(text.trim());
export function vbaSearchQuery(question: string, history: { role: string; content: string }[]) {
  const previous = followUp(question) ? history.findLast(message => message.role === "user" && !followUp(message.content))?.content : undefined;
  return `${previous ? previous + "\n" : ""}${question}`.replace(/https?:\/\/\S+/gi, "").slice(0, 3500);
}

// Translate common classroom terminology into identifiers without another model call.
const aliases: { matches: RegExp; terms: string[] }[] = [
  { matches: /option\s+explicit|宣言.*強制|宣言.*必須|宣言忘れ/i, terms: ["option explicit statement"] },
  { matches: /変数|宣言/i, terms: ["dim statement"] },
  { matches: /セル.*(?:値|入力|書き込|読|取得)|(?:入力|書き込|読|取得).*セル/i, terms: ["range value"] },
  { matches: /セル範囲/i, terms: ["range object"] },
  { matches: /\bcells\b|行.*列.*セル|セル.*行.*列/i, terms: ["worksheet cells"] },
  { matches: /シート|ワークシート/i, terms: ["worksheet object"] },
  { matches: /ブック|ワークブック/i, terms: ["workbook object"] },
  { matches: /繰り返し|ループ|for\s*\.{0,3}\s*next/i, terms: ["fornext statement"] },
  { matches: /条件分岐|もし.*なら|if\s*\.{0,3}\s*then/i, terms: ["ifthenelse statement"] },
  { matches: /\bmsgbox\b|メッセージボックス|ダイアログ.*表示/i, terms: ["msgbox function"] },
  { matches: /最終行|最後の行/i, terms: ["range end", "worksheet rows"] },
  { matches: /保存|上書き/i, terms: ["workbook save", "workbook saveas"] },
  { matches: /ファイル.*開|ブック.*開/i, terms: ["workbooks open"] },
  { matches: /シート.*追加|シート.*作成/i, terms: ["worksheets add"] },
  { matches: /シート.*削除/i, terms: ["worksheet delete"] },
  { matches: /並べ替え|ソート/i, terms: ["range sort"] },
  { matches: /\bautofilter\b|フィルタ|絞り込/i, terms: ["range autofilter"] },
  { matches: /コピー|貼り付け/i, terms: ["range copy", "range pastespecial"] },
  { matches: /配列/i, terms: ["array function", "declaring arrays"] },
  { matches: /エラー.*処理|例外.*処理/i, terms: ["on error statement"] },
  { matches: /画面.*更新/i, terms: ["application screenupdating"] },
  { matches: /日付|時刻/i, terms: ["date function", "format function"] },
  { matches: /書式|フォーマット/i, terms: ["range numberformat", "format function"] },
  { matches: /背景色|塗りつぶし/i, terms: ["range interior", "interior color"] },
  { matches: /文字色|フォント.*色/i, terms: ["font color"] },
  { matches: /太字/i, terms: ["font bold"] },
  { matches: /シート名|シート.*名前|名前.*シート/i, terms: ["worksheet name"] },
  { matches: /セル.*削除|行.*削除|列.*削除/i, terms: ["range delete"] },
  { matches: /クリア|消去/i, terms: ["range clearcontents", "range clear"] },
  { matches: /文字列.*置換|文字.*置き換え/i, terms: ["replace function"] },
  { matches: /文字列.*長さ|文字数/i, terms: ["len function"] },
  { matches: /セル.*結合/i, terms: ["range merge"] },
  { matches: /入力.*ダイアログ|入力ボックス/i, terms: ["inputbox function"] },
  { matches: /辞書|\bdictionary\b/i, terms: ["dictionary object"] },
];
const stopWords = new Set(["vba", "excel", "office", "microsoft", "what", "how", "the", "a", "an", "is", "are", "in", "on", "of", "to", "with", "and", "or", "please", "explain", "use"]);
function queryTerms(query: string) {
  const terms = new Map<string, number>();
  const add = (term: string, weight: number) => { const key = normalize(term); terms.set(key, Math.max(terms.get(key) || 0, weight)); };
  for (const word of query.match(/[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)*/gi) || []) {
    if (stopWords.has(word.toLowerCase()) || word.length < 2) continue;
    add(word, word.includes(".") ? 12 : 3);
  }
  for (const alias of aliases) if (alias.matches.test(query)) for (const term of alias.terms) add(term, 10);
  return [...terms].map(([term, weight]) => ({ term, weight }));
}
const containsTerm = (text: string, term: string) => ` ${text} `.includes(` ${term} `);
const vbaQuestion = (subject: Subject, query: string) => subject === "Excel VBA" || /\bvba\b|\bexcel\b|エクセル|マクロ|option\s+explicit|for\s*\.{0,3}\s*next|\b(range|cells|worksheets?|workbooks?|msgbox|autofilter|pastespecial)\b|変数.*宣言|セル|シート|ブック|条件分岐/i.test(query);
let cachedIndex: Promise<ReferenceIndex> | undefined;
async function loadIndex() {
  cachedIndex ??= readFile(join(process.cwd(), "data/vba-reference/index.json.gz"))
    .then(bytes => indexSchema.parse(JSON.parse(gunzipSync(bytes).toString("utf8"))))
    .catch(() => { cachedIndex = undefined; throw new ApiError(503, "保存済みのVBA公式資料を検索できませんでした。管理者に設定をご確認ください。"); });
  return cachedIndex;
}

export function searchVbaIndex(index: ReferenceIndex, query: string): VbaReferenceResult {
  const terms = queryTerms(query);
  const candidates = index.documents.map(document => {
    const key = normalize(decodeURI(new URL(document.url).pathname).replace(/\/(en-us|ja-jp)\/office\/vba\//, "") + " " + document.title);
    let score = terms.reduce((sum, { term, weight }) => sum + (containsTerm(key, term) ? weight : 0), 0);
    if (!terms.length && /(?:とは|入門|概要|基本|始め)/.test(query) && document.url.endsWith("/api/overview/excel")) score = 10;
    return { document, score: score ? score + (document.locale === "ja-jp" ? 0.5 : 0) : 0 };
  }).filter(candidate => candidate.score > 0).sort((a, b) => b.score - a.score || a.document.url.localeCompare(b.document.url));
  const seen = new Set<string>();
  const selected = candidates.filter(candidate => {
    const key = candidate.document.url.replace(/\/(en-us|ja-jp)\//, "/");
    if (seen.has(key) || candidate.score < candidates[0].score * 0.6) return false;
    seen.add(key); return true;
  }).slice(0, VBA_CONTEXT_EXCERPTS);
  const excerpts: VbaExcerpt[] = [];
  let characters = 0;
  const ranked = selected.map(({ document }) => ({ document, chunks: document.chunks.map((chunk, position) => {
    const text = normalize(chunk.section + " " + chunk.content);
    const articleKey = normalize(decodeURI(new URL(document.url).pathname) + " " + document.title);
    // Once the article is selected, parameters/platform terms matter more than repeating its name.
    const matching = terms.reduce((sum, { term, weight }) => sum + (containsTerm(text, term) ? containsTerm(articleKey, term) ? 1 : weight : 0), 0);
    const example = /例|サンプル|example/i.test(query);
    const parameter = /引数|パラメータ|parameter|criteria\d|\bfield\b/i.test(query);
    const headingBoost = parameter && /parameters|引数|パラメータ/i.test(chunk.section) ? 15
      : example ? (/example|例/i.test(chunk.section) ? 15 : 0)
      : /syntax|構文/i.test(chunk.section) ? 4 : /remarks|解説|注釈/i.test(chunk.section) ? 2 : position === 0 ? 3 : 0;
    return { ...chunk, position, score: matching + headingBoost };
  }).sort((a, b) => b.score - a.score || a.position - b.position) }));
  for (let round = 0; round < VBA_CONTEXT_EXCERPTS; round++) {
    for (const { document, chunks } of ranked) {
      const chunk = chunks[round];
      if (!chunk || excerpts.length === VBA_CONTEXT_EXCERPTS || characters + chunk.content.length > VBA_CONTEXT_CHARACTERS) continue;
      excerpts.push({ title: document.title, url: document.url, section: chunk.section, content: chunk.content });
      characters += chunk.content.length;
    }
  }
  return { status: excerpts.length ? "matched" : "unmatched", excerpts, retrievedOn: index.retrievedOn };
}

export async function retrieveVbaReferences(subject: Subject, question: string, history: { role: string; content: string }[] = []): Promise<VbaReferenceResult> {
  const query = vbaSearchQuery(question, history);
  if (!vbaQuestion(subject, query)) return { status: "unrelated", excerpts: [], retrievedOn: "" };
  return searchVbaIndex(await loadIndex(), query);
}
