import { NextResponse } from "next/server";
import { getSyncedModels } from "@/lib/syncedModelsDb";
import { getModelSyncRunState, getModelSyncSettings, syncProviderModels } from "@/lib/modelSync/sync.js";
import { getNextModelSyncAt } from "@/lib/modelSync/scheduler.js";

export const dynamic = "force-dynamic";

// GET /api/models/sync - Settings, schedule, last run and the cached model lists
export async function GET() {
  try {
    return NextResponse.json({
      ...(await getModelSyncSettings()),
      ...getModelSyncRunState(),
      nextRunAt: getNextModelSyncAt(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      providers: await getSyncedModels(),
    });
  } catch (error) {
    console.log("Error reading model sync status:", error);
    return NextResponse.json({ error: "Failed to read model sync status" }, { status: 500 });
  }
}

// POST /api/models/sync - Run a sync now
export async function POST() {
  try {
    return NextResponse.json({ success: true, lastRun: await syncProviderModels() });
  } catch (error) {
    console.log("Error syncing provider models:", error);
    return NextResponse.json({ error: "Model sync failed" }, { status: 500 });
  }
}
