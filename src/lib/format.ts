export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(2) : s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  const rest = Math.round(s % 60);
  if (m < 60) return `${m}m ${String(rest).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${i === 0 ? v : v < 10 ? v.toFixed(2) : v.toFixed(1)} ${units[i]}`;
}

export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (Math.abs(n) < 10_000) return Math.round(n).toLocaleString('en-US');
  const units = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ] as const;
  for (const [size, suffix] of units) {
    if (Math.abs(n) >= size) {
      const v = n / size;
      return `${v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.round(v)}${suffix}`;
    }
  }
  return String(n);
}

export function formatSeconds(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return '—';
  return `${s < 10 ? s.toFixed(2) : s.toFixed(1)} s`;
}

/** 3.24× — always expressed as "how many times faster", ≥ 1. */
export function formatRatio(r: number | null | undefined): string {
  if (r === null || r === undefined || !Number.isFinite(r) || r <= 0) return '—';
  const v = r >= 1 ? r : 1 / r;
  return `${v < 10 ? v.toFixed(2) : v.toFixed(1)}×`;
}

export function formatScore(s: number | null | undefined): string {
  if (s === null || s === undefined || !Number.isFinite(s)) return '—';
  return String(Math.round(s));
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatWindow(earliest: number, latest: number): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  return `${new Date(earliest * 1000).toLocaleString(undefined, opts)} → ${new Date(latest * 1000).toLocaleString(undefined, opts)}`;
}

export function relativeTime(ms: number, now = Date.now()): string {
  const diff = Math.round((now - ms) / 1000);
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  return `${Math.round(diff / 86400)} d ago`;
}
