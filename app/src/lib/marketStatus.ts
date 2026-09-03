function taipeiMinutesOfDay(now: Date): { day: number; minutes: number } {
  const taipei = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  return { day: taipei.getDay(), minutes: taipei.getHours() * 60 + taipei.getMinutes() };
}

export function isMarketOpen(now = new Date()): boolean {
  const { day, minutes } = taipeiMinutesOfDay(now);
  if (day === 0 || day === 6) return false;
  return minutes >= 9 * 60 && minutes <= 13 * 60 + 30;
}

// Quote data only refreshes 09:00–13:40 Taipei time on weekdays; outside this
// window the frontend should stop polling and just show the last snapshot.
export function isQuoteRefreshWindow(now = new Date()): boolean {
  const { day, minutes } = taipeiMinutesOfDay(now);
  if (day === 0 || day === 6) return false;
  return minutes >= 9 * 60 && minutes <= 13 * 60 + 40;
}

export function taipeiTimeString(now = new Date()): string {
  return now.toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false });
}
