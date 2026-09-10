export function getDaysRemaining(targetDate?: string): number {
  if (!targetDate) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${targetDate}T00:00:00`);
  if (Number.isNaN(target.getTime())) return 0;
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function toIsoDate(date: Date = new Date()): string {
  return date.toISOString().split('T')[0];
}
