import { getConfig } from "@/lib/server";
export const dynamic = "force-dynamic";
export function GET() { return Response.json(getConfig(), { headers: { "Cache-Control": "no-store" } }); }
