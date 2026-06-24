import { NextResponse } from "next/server";
import { syncAgents } from "@/lib/discovery/agents";

export const dynamic = "force-dynamic";

// GET /api/agents — re-discover installed plugins and return the agent list.
export async function GET() {
  try {
    const list = syncAgents();
    return NextResponse.json(list);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
