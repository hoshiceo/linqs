import { apiError, ApiError, authenticate, exchangeWriteKey, readJson } from "@/lib/server";
import { instructorQuestionSchema } from "@/lib/instructor-questions";

const fields = "id,course_id,conversation_title,original_question,ai_answer,question,reply,created_at,replied_at";
const setupRequiredMessage = "講師への質問は準備中です。管理者による受付先の設定が完了してからご利用ください。";

function checkStorageSetup(error: { code?: string } | null) {
  if (error && ["PGRST202", "PGRST205", "42P01", "42883"].includes(error.code ?? "")) {
    throw new ApiError(503, setupRequiredMessage);
  }
}

export async function GET(request: Request) {
  try {
    const { supabase } = await authenticate(request);
    const { data, error } = await supabase.from("instructor_questions").select(fields).order("created_at", { ascending: false }).limit(100);
    checkStorageSetup(error);
    if (error) throw new ApiError(503, "講師への質問を読み込めませんでした。管理者に設定をご確認ください。");
    return Response.json({ questions: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const { supabase } = await authenticate(request);
    const parsed = instructorQuestionSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new ApiError(400, "講師への質問は1〜2,000文字で入力し、対象の回答を確認してください。");
    const { conversationId, messageIndex, question, contextHash } = parsed.data;
    const { data, error } = await supabase.rpc("submit_instructor_question", {
      p_conversation_id: conversationId, p_message_index: messageIndex,
      p_question: question, p_context_hash: contextHash, p_write_key: exchangeWriteKey(),
    });
    checkStorageSetup(error);
    if (error?.code === "40001") throw new ApiError(409, "会話が更新されています。履歴を更新して、対象の回答からもう一度お試しください。");
    if (error?.code === "P0002") throw new ApiError(404, "対象の回答が見つかりません。履歴を更新してからお試しください。");
    if (error?.message === "Instructor question limit") throw new ApiError(429, "クラス全体で1時間の講師への質問回数（10回）に達しました。時間をおいてお試しください。");
    const receipt = Array.isArray(data) ? data[0] : data;
    if (error || !receipt?.id) throw new ApiError(503, "質問を受け付けられませんでした。管理者に設定をご確認ください。");
    return Response.json({ question: receipt }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
