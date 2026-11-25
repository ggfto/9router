"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, Button, Toggle } from "@/shared/components";

const PRESETS = [
  { label: "Hourly", cron: "0 * * * *" },
  { label: "Every 6 hours", cron: "0 */6 * * *" },
  { label: "Daily at 04:00", cron: "0 4 * * *" },
  { label: "Weekly (Sunday 04:00)", cron: "0 4 * * 0" },
];

const formatTime = (ms) => new Date(ms).toLocaleString();

const describeResult = (r) => {
  if (r.status === "ok") return `${r.total} models (+${r.added} / -${r.removed})`;
  return r.error;
};

const RESULT_COLORS = { ok: "text-green-500", skipped: "text-text-muted", error: "text-red-500" };

export default function ModelSyncCard() {
  const [status, setStatus] = useState(null);
  const [cron, setCron] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/models/sync", { cache: "no-store" });
      if (!res.ok) return null;
      const data = await res.json();
      setStatus(data);
      return data;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    fetch("/api/models/sync", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setStatus(data);
        setCron(data.cron || "");
      })
      .catch(() => {});
  }, []);

  const save = async (updates) => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) setError((await res.json()).error || "Could not save");
      await load();
    } catch {
      setError("Could not save");
    } finally {
      setSaving(false);
    }
  };

  const syncNow = async () => {
    setSyncing(true);
    setError("");
    try {
      const res = await fetch("/api/models/sync", { method: "POST" });
      if (!res.ok) setError((await res.json()).error || "Sync failed");
      await load();
    } catch {
      setError("Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const dirty = !!status && cron.trim() !== status.cron;
  const results = status?.lastRun?.results || [];

  return (
    <Card>
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500 shrink-0">
          <span className="material-symbols-outlined text-[20px]">sync</span>
        </div>
        <h3 className="text-base sm:text-lg font-semibold">Model Sync</h3>
      </div>

      <div className="flex items-start sm:items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm sm:text-base">Scheduled model list update</p>
          <p className="text-xs sm:text-sm text-text-muted">
            Ask every enabled provider which models it offers. New models are added to the lists, enabled.
          </p>
        </div>
        <Toggle
          checked={status?.enabled === true}
          onChange={(modelSyncEnabled) => save({ modelSyncEnabled })}
          disabled={!status || saving}
        />
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <label htmlFor="model-sync-cron" className="text-xs text-text-muted">
          Schedule (cron: minute hour day month weekday){status?.timezone ? `, server time: ${status.timezone}` : ""}
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="model-sync-cron"
            type="text"
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && dirty && save({ modelSyncCron: cron })}
            placeholder="0 */6 * * *"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm focus:border-primary focus:outline-none"
          />
          <select
            value=""
            onChange={(e) => e.target.value && setCron(e.target.value)}
            aria-label="Schedule presets"
            className="rounded-lg border border-border bg-background px-2 py-2 text-xs focus:border-primary focus:outline-none"
          >
            <option value="">Presets</option>
            {PRESETS.map((preset) => (
              <option key={preset.cron} value={preset.cron}>{preset.label}</option>
            ))}
          </select>
          <Button size="sm" onClick={() => save({ modelSyncCron: cron })} disabled={!dirty || saving}>
            Save
          </Button>
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-text-muted">
          {status?.nextRunAt ? `Next run: ${formatTime(status.nextRunAt)}` : "No run scheduled"}
          {status?.lastRun ? ` · Last run: ${formatTime(status.lastRun.finishedAt)}` : ""}
        </p>
        <Button size="sm" variant="secondary" icon="sync" onClick={syncNow} disabled={syncing || status?.running}>
          {syncing || status?.running ? "Syncing..." : "Sync now"}
        </Button>
      </div>

      {results.length > 0 && (
        <ul className="mt-3 max-h-48 overflow-y-auto rounded-lg border border-border p-2 text-xs">
          {results.map((r) => (
            <li key={r.providerId} className="flex justify-between gap-3 py-0.5">
              <span className="shrink-0 font-mono">{r.providerId}</span>
              <span className={`min-w-0 truncate ${RESULT_COLORS[r.status] || ""}`} title={describeResult(r)}>
                {describeResult(r)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
