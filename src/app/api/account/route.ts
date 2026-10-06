import { apiError, authenticate } from "@/lib/server";

export async function GET(request: Request) {
  try {
    await authenticate(request);
    return Response.json({ displayName: "クラス共通" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
