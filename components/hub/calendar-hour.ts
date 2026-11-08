export function calendarHourLabel(hour: number): string {
  if (hour === 24) return "12 AM (end of day)";
  return `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`;
}
