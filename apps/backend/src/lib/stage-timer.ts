/**
 * Minimal per-request stage timer for latency attribution.
 *
 * Built for the recipe-check path (2026-07-01 latency findings: per-stage
 * costs had to be reconstructed by black-box parameter toggling because the
 * deployed backend exposed no timings). One instance per request; stages are
 * recorded in call order and emitted two ways:
 *   - a Server-Timing response header (readable in browser dev tools and by
 *     any HTTP client), and
 *   - a compact JSON log line (one per check) for log-based dashboards.
 *
 * Not a tracing framework on purpose — no spans, no context propagation,
 * just named durations for the handful of stages we own.
 */

export interface StageEntry {
  name: string;
  ms: number;
}

export class StageTimer {
  private stages: StageEntry[] = [];
  private readonly startedAt = performance.now();

  /** Time an async stage. The stage is recorded even if fn throws. */
  async time<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const t0 = performance.now();
    try {
      return await fn();
    } finally {
      this.stages.push({ name, ms: performance.now() - t0 });
    }
  }

  /** Time a synchronous stage. */
  timeSync<T>(name: string, fn: () => T): T {
    const t0 = performance.now();
    try {
      return fn();
    } finally {
      this.stages.push({ name, ms: performance.now() - t0 });
    }
  }

  /** Recorded stages plus a running "total" since construction. */
  entries(): StageEntry[] {
    return [...this.stages, { name: "total", ms: performance.now() - this.startedAt }];
  }

  /** Server-Timing header value: `embed;dur=123.4, write;dur=45.6, total;dur=...` */
  toServerTimingHeader(): string {
    return this.entries()
      .map((s) => `${s.name};dur=${s.ms.toFixed(1)}`)
      .join(", ");
  }

  /** Compact object for a structured log line ({ embed: 123.4, ... }). */
  toLogObject(): Record<string, number> {
    return Object.fromEntries(this.entries().map((s) => [s.name, Math.round(s.ms * 10) / 10]));
  }
}
