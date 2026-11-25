import { NextResponse } from "next/server";
import { getProviderConnections, updateProviderConnection } from "@/lib/db/index.js";
import { getDisabledProviders, setProviderDisabled } from "@/lib/disabledProvidersDb";

export const dynamic = "force-dynamic";

// GET /api/providers/disabled - Provider ids that are switched off
export async function GET() {
  try {
    return NextResponse.json({ disabled: await getDisabledProviders() });
  } catch (error) {
    console.log("Error fetching disabled providers:", error);
    return NextResponse.json({ error: "Failed to fetch disabled providers" }, { status: 500 });
  }
}

// POST /api/providers/disabled  body: { providerId, disabled }
export async function POST(request) {
  try {
    const { providerId, disabled } = await request.json();
    if (typeof providerId !== "string" || !providerId || typeof disabled !== "boolean") {
      return NextResponse.json({ error: "providerId and disabled (boolean) required" }, { status: 400 });
    }
    await setProviderDisabled(providerId, disabled);

    // Turning on a provider whose accounts are all off would change nothing, so
    // bring them back. Otherwise each account keeps its own switch.
    let reactivated = 0;
    if (!disabled) {
      const connections = await getProviderConnections({ provider: providerId });
      if (connections.length && connections.every((c) => c.isActive === false)) {
        for (const connection of connections) {
          await updateProviderConnection(connection.id, { isActive: true });
          reactivated += 1;
        }
      }
    }
    return NextResponse.json({ success: true, reactivated });
  } catch (error) {
    console.log("Error updating disabled providers:", error);
    return NextResponse.json({ error: "Failed to update provider" }, { status: 500 });
  }
}
