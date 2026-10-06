import { UrlRetrievalStatus } from "@google/genai";
import { describe, expect, it } from "vitest";
import { appendVerifiedReferences, EXCEL_VBA_REFERENCE_URL, selectVbaReferences } from "../src/lib/vba-reference";

const optionUrl = "https://learn.microsoft.com/ja-jp/office/vba/language/reference/user-interface-help/option-explicit-statement";
describe("Official VBA reference selection and evidence", () => {
  it("selects the overview and relevant pages without accepting arbitrary URLs", () => {
    const references = selectVbaReferences("すべて", "VBAのOption Explicitを教えて。https://other.example/doc");
    expect(references.map(source => source.url)).toEqual([EXCEL_VBA_REFERENCE_URL, optionUrl]);
  });
  it("bounds a complex question to three sources and excludes unrelated AI questions", () => {
    expect(selectVbaReferences("Excel VBA", "Option Explicit Range.Value Cells Worksheet For Next MsgBox")).toHaveLength(3);
    expect(selectVbaReferences("AI活用", "業務メールのプロンプトを教えて")).toEqual([]);
  });
  it("uses the last user question for follow-ups, not assistant source links", () => {
    const history = [{ role: "user", content: "VBAのOption Explicitとは？" }, { role: "assistant", content: "Range.Valueの出典リンク" }];
    expect(selectVbaReferences("すべて", "それを詳しく", history).map(source => source.url)).toContain(optionUrl);
    expect(selectVbaReferences("すべて", "業務メールのプロンプトを教えて", history)).toEqual([]);
  });
  it("cites only selected successful sources, deduplicating metadata", () => {
    const requested = selectVbaReferences("Excel VBA", "Option Explicitとは？");
    const result = appendVerifiedReferences("回答", requested, [
      { retrievedUrl: EXCEL_VBA_REFERENCE_URL, urlRetrievalStatus: UrlRetrievalStatus.URL_RETRIEVAL_STATUS_ERROR },
      { retrievedUrl: optionUrl, urlRetrievalStatus: UrlRetrievalStatus.URL_RETRIEVAL_STATUS_SUCCESS },
      { retrievedUrl: optionUrl, urlRetrievalStatus: UrlRetrievalStatus.URL_RETRIEVAL_STATUS_SUCCESS },
      { retrievedUrl: "https://other.example/doc", urlRetrievalStatus: UrlRetrievalStatus.URL_RETRIEVAL_STATUS_SUCCESS },
    ]);
    expect(result).toContain("一部の公式資料は取得できませんでした");
    expect(result).toContain(optionUrl);
    expect(result).not.toContain(EXCEL_VBA_REFERENCE_URL);
    expect(result).not.toContain("other.example");
    expect(result?.split(optionUrl)).toHaveLength(2);
  });
  it("fails closed on missing or unsuccessful metadata and leaves non-VBA answers alone", () => {
    const requested = selectVbaReferences("Excel VBA", "Option Explicitとは？");
    expect(appendVerifiedReferences("回答", requested)).toBeNull();
    expect(appendVerifiedReferences("回答", requested, [{ retrievedUrl: optionUrl, urlRetrievalStatus: UrlRetrievalStatus.URL_RETRIEVAL_STATUS_PAYWALL }])).toBeNull();
    expect(appendVerifiedReferences("回答", [])).toBe("回答");
  });
});
