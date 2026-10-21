import { GoogleGenAI } from "@google/genai";
import { apiError, ApiError, authenticate, exchangeWriteKey, readJson } from "@/lib/server";
import { chatSchema } from "@/lib/validation";
import { tutorInstruction } from "@/lib/tutor";
import { assertNoRuntimeSecrets, buildTutorContents, PROMPT_SECURITY_INSTRUCTION, tutorReplyJsonSchema, validateTutorReply } from "@/lib/prompt-security";
import { appendVbaReferences, vbaReferenceInstruction } from "@/lib/vba-reference";
import { retrieveVbaReferences } from "@/lib/vba-search";
import { knowledgeInstruction, retrieveKnowledge } from "@/lib/knowledge";

import { appendTextbookReferences, retrieveTextbooks, textbookInstruction } from "@/lib/textbooks";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    if (Number(request.headers.get("content-length")) > 16000) throw new ApiError(413, "質問は3,000文字以内で入力してください。");
    const { supabase } = await authenticate(request);
    if (!process.env.GEMINI_API_KEY) throw new ApiError(503, "AIの回答機能は準備中です。管理者に設定をご確認ください。");
    const writeKey = exchangeWriteKey();
    const body = await readJson(request);
    const parsed = chatSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, "質問は1〜3,000文字で入力してください。");
    const { conversationId, message, subject, mode } = parsed.data;
    assertNoRuntimeSecrets(message, true);
    let history: { role: string; content: string }[] = [];
    if (conversationId) {
      const { data, error } = await supabase.from("conversations").select("id").eq("id", conversationId).maybeSingle();
      if (error) throw new ApiError(503, "質問履歴を確認できませんでした。");
      if (!data) throw new ApiError(404, "質問履歴が見つかりませんでした。");
      const previous = await supabase.from("messages").select("role,content,created_at").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(20);
      if (previous.error) throw new ApiError(503, "質問履歴を読み込めませんでした。");
      history = [...(previous.data ?? [])].reverse();
    }
    assertNoRuntimeSecrets(JSON.stringify(history));
    const allowance = await supabase.rpc("reserve_question_exchange", { p_write_key: writeKey });
    if (allowance.error) throw new ApiError(503, "学習サービスの準備が完了していません。管理者にご確認ください。");
    if (!allowance.data) throw new ApiError(429, "クラス全体で1時間の質問回数（30回）に達しました。少し休憩してから、また質問してください。");

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY!, httpOptions: { timeout: 40000 } });
    const [knowledge, textbookResult, references] = await Promise.all([
      retrieveKnowledge(supabase, message, history),
      retrieveTextbooks(supabase, ai, message, history),
      retrieveVbaReferences(subject, message, history),
    ]);
    const knowledgeContext = knowledgeInstruction(knowledge);
    const textbookContext = textbookInstruction(textbookResult);
    const referenceInstruction = vbaReferenceInstruction(references);
    const systemInstruction = tutorInstruction(subject, mode) + PROMPT_SECURITY_INSTRUCTION;
    const contents = buildTutorContents(message, history, { official: referenceInstruction, knowledge: knowledgeContext, textbooks: textbookContext });
    let answer: string;
    try {
      const response = await ai.models.generateContent({
        model: process.env.GEMINI_MODEL || "gemini-3.8-flash",
        contents,
        config: { systemInstruction, responseMimeType: "application/json", responseJsonSchema: tutorReplyJsonSchema, maxOutputTokens: 4096, temperature: 0.5 },
      });
      if (response.functionCalls?.length) throw new ApiError(502, "回答の安全性を確認できませんでした。新しい質問をお試しください。");
      answer = validateTutorReply(response.text?.trim() ?? "", systemInstruction);
      const citedAnswer = appendVbaReferences(answer, references);
      answer = knowledge.length && textbookResult.status === "unmatched" ? citedAnswer : appendTextbookReferences(citedAnswer, textbookResult);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, "AIが回答できませんでした。質問の言い方を変えるか、少し時間をおいてお試しください。");
    }
    assertNoRuntimeSecrets(answer);
    // Persist both messages in one transaction, after successful generation.
    const { data, error } = await supabase.rpc("save_question_exchange", {
      p_conversation_id: conversationId, p_title: message.slice(0, 50), p_subject: subject,
      p_question: message, p_answer: answer,
      p_write_key: writeKey, p_ticket: allowance.data,
    });
    if (error) {
      // The generated response remains usable if persistence fails. Never silently claim it was saved.
      return Response.json({ answer, conversationId, saved: false, warning: "回答は表示できますが、履歴を保存できませんでした。必要な内容をコピーしてください。" });
    }
    return Response.json({ answer, conversationId: data, saved: true });
  } catch (error) { return apiError(error); }
}
