export const fmt = (n: number, d = 0) => n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
export const pct = (n: number, d = 1) => `${fmt(n, d)}%`;
export const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
export const titleCase = (s: string) => s.toLowerCase().split(/[_\s]+/).filter(Boolean).map(cap).join(' ');
export const plural = (n: number, w: string, p = w + 's') => `${fmt(n)} ${n === 1 ? w : p}`;

export function duration(ms: number): string {
  if (ms <= 0) return '0m';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

export function dateRange(start: Date | null, end: Date | null): string {
  const o: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  const s = start ? start.toLocaleString(undefined, o) : '?';
  if (!end) return s;
  const sameDay = start && start.toDateString() === end.toDateString();
  const e = sameDay ? end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : end.toLocaleString(undefined, o);
  return `${s} – ${e}`;
}

export function timeAgo(ts: number): string {
  if (!ts) return 'never';
  const d = Date.now() - ts;
  if (d < 60_000) return 'just now';
  return `${duration(d)} ago`;
}

export const stripHtml = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim();
