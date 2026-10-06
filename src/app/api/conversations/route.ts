import { apiError, ApiError, authenticate, readJson } from "@/lib/server";
import { conversationPatchSchema } from "@/lib/validation";

export async function GET(request: Request) {
  try {
    const { supabase } = await authenticate(request);
    const { data, error } = await supabase.from("conversations").select("id,title,subject,bookmarked,created_at,updated_at,messages(id,role,content,created_at)").order("updated_at", { ascending: false }).limit(100);
    if (error) throw new ApiError(503, "履歴を読み込めませんでした。管理者にデータベース設定をご確認ください。");
    return Response.json({ conversations: (data ?? []).map(c => ({ ...c, messages: [...c.messages].sort((a, b) => a.created_at.localeCompare(b.created_at)) })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request) {
  try {
    const { supabase } = await authenticate(request);
    const parsed = conversationPatchSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new ApiError(400, "保存する質問を確認してください。");
    const { data, error } = await supabase.from("conversations").update({ bookmarked: parsed.data.bookmarked }).eq("id", parsed.data.id).select("id").maybeSingle();
    if (error) throw new ApiError(503, "保存できませんでした。もう一度お試しください。");
    if (!data) throw new ApiError(404, "質問が見つかりませんでした。");
    return Response.json({ ok: true });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request) {
  try {
    const { supabase } = await authenticate(request);
    const id = new URL(request.url).searchParams.get("id");
    const parsed = conversationPatchSchema.shape.id.safeParse(id);
    if (!parsed.success) throw new ApiError(400, "削除する質問を確認してください。");
    const { data, error } = await supabase.from("conversations").delete().eq("id", parsed.data).select("id").maybeSingle();
    if (error) throw new ApiError(503, "削除できませんでした。もう一度お試しください。");
    if (!data) throw new ApiError(404, "質問が見つかりませんでした。");
    return Response.json({ ok: true });
  } catch (error) { return apiError(error); }
}
