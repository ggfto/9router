// Minimal 5-field cron (minute hour day-of-month month day-of-week), evaluated
// in the server's local time. Supports "*", lists, ranges, steps and the
// @hourly/@daily/@weekly/@monthly shortcuts. Pure, so it can be unit tested.

const MACROS = {
  "@hourly": "0 * * * *",
  "@daily": "0 0 * * *",
  "@weekly": "0 0 * * 0",
  "@monthly": "0 0 1 * *",
};

const FIELDS = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "dayOfMonth", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "dayOfWeek", min: 0, max: 7 }, // 0 and 7 are both Sunday
];

const MINUTE_MS = 60 * 1000;
const MAX_STEPS = 200000; // enough to walk several years looking for 29 Feb

function parseField(text, { name, min, max }) {
  const values = new Set();
  for (const part of text.split(",")) {
    const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!match) throw new Error(`Invalid ${name} field: "${part}"`);
    const [, range, stepText] = match;
    const step = stepText === undefined ? 1 : Number(stepText);
    let start = min;
    let end = max;
    if (range !== "*") {
      const [from, to] = range.split("-").map(Number);
      start = from;
      // "5/10" means "from 5 to the end, every 10"
      end = to ?? (stepText === undefined ? from : max);
    }
    if (step < 1 || start < min || end > max || start > end) {
      throw new Error(`Out of range ${name} field: "${part}" (allowed ${min}-${max})`);
    }
    for (let v = start; v <= end; v += step) values.add(v);
  }
  return values;
}

export function parseCron(expression) {
  const text = String(expression || "").trim();
  const parts = (MACROS[text.toLowerCase()] || text).split(/\s+/);
  if (parts.length !== 5) {
    throw new Error("Cron expression needs 5 fields: minute hour day month weekday");
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts.map((p, i) => parseField(p, FIELDS[i]));
  if (dayOfWeek.delete(7)) dayOfWeek.add(0);
  return {
    minute,
    hour,
    dayOfMonth,
    month,
    dayOfWeek,
    anyDayOfMonth: parts[2].startsWith("*"),
    anyDayOfWeek: parts[4].startsWith("*"),
  };
}

// Standard cron rule: when both day fields are restricted, either one matches.
function dayMatches(cron, date) {
  const byMonthDay = cron.dayOfMonth.has(date.getDate());
  const byWeekDay = cron.dayOfWeek.has(date.getDay());
  if (!cron.anyDayOfMonth && !cron.anyDayOfWeek) return byMonthDay || byWeekDay;
  return byMonthDay && byWeekDay;
}

/**
 * First matching time strictly after `from`, or null when the expression can
 * never fire (e.g. 31 February).
 */
export function nextCronRun(expression, from = new Date()) {
  const cron = typeof expression === "string" ? parseCron(expression) : expression;
  let t = new Date(Math.floor(from.getTime() / MINUTE_MS) * MINUTE_MS + MINUTE_MS);

  for (let i = 0; i < MAX_STEPS; i += 1) {
    if (!cron.month.has(t.getMonth() + 1)) {
      t = new Date(t.getFullYear(), t.getMonth() + 1, 1);
    } else if (!dayMatches(cron, t)) {
      t = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1);
    } else if (!cron.hour.has(t.getHours())) {
      // Adding milliseconds (not setHours) always moves forward across DST.
      t = new Date(t.getTime() + (60 - t.getMinutes()) * MINUTE_MS);
    } else if (!cron.minute.has(t.getMinutes())) {
      t = new Date(t.getTime() + MINUTE_MS);
    } else {
      return t;
    }
  }
  return null;
}

/** Validation message for user input, or null when the expression is usable. */
export function getCronError(expression) {
  try {
    return nextCronRun(expression) ? null : "This expression never matches a real date";
  } catch (error) {
    return error.message;
  }
}
