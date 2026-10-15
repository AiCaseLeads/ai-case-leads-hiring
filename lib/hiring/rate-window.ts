/** Rate-limit rows use ten-minute units because both cleanup workers share this table. */
export function hourlyRateWindow(now = Date.now()): number {
  return Math.floor(now / 3_600_000) * 6;
}
