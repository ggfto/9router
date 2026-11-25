// Cron-driven trigger for the provider model sync.
import { nextCronRun } from "./cron.js";
import { getModelSyncSettings, syncProviderModels } from "./sync.js";

// Wake at least this often so a clock jump or system sleep cannot leave the
// timer pointing far away from the wall-clock slot.
const MAX_SLEEP_MS = 60 * 60 * 1000;

const state = (globalThis.__9routerModelSyncScheduler ??= { timer: null, nextRunAt: null, generation: 0 });

export function getNextModelSyncAt() {
  return state.nextRunAt;
}

function arm(generation) {
  const delay = Math.min(Math.max(state.nextRunAt - Date.now(), 0), MAX_SLEEP_MS);
  state.timer = setTimeout(async () => {
    if (generation !== state.generation) return;
    if (Date.now() < state.nextRunAt) return arm(generation);
    try {
      // Re-read: the switch may have changed without going through the API
      // (e.g. a database import).
      if ((await getModelSyncSettings()).enabled) await syncProviderModels();
    } catch (error) {
      console.log(`[modelSync] run failed: ${error?.message || error}`);
    }
    if (generation === state.generation) await configureModelSync();
  }, delay);
  state.timer.unref?.();
}

/** (Re)apply the current settings. Safe to call any number of times. */
export async function configureModelSync() {
  const { enabled, cron } = await getModelSyncSettings();
  const generation = ++state.generation;
  clearTimeout(state.timer);
  state.timer = null;
  state.nextRunAt = null;
  if (!enabled) return;

  try {
    state.nextRunAt = nextCronRun(cron)?.getTime() ?? null;
  } catch (error) {
    console.log(`[modelSync] invalid cron "${cron}": ${error.message}`);
  }
  if (state.nextRunAt) arm(generation);
}
