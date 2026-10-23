export function localDate(timezone, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en", { timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (name) => parts.find((item) => item.type === name).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function minutesToday(learner, date = new Date()) {
  return (learner.daily_summary[localDate(learner.settings.timezone, date)]?.milliseconds || 0) / 60000;
}
export function progressCounts(learner) {
  const rows = Object.values(learner.lesson_progress);
  return { completed: rows.filter((r) => r.status === "completed").length,
    skipped: rows.filter((r) => r.status === "skipped").length };
}
