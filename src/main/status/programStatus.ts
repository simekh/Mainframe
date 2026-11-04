import type { ProgramReport, ProgramStatus } from '../../shared/types';

const MAX_RECORDS = 256;

/** One terminal's OSC 7501 records, with the protocol's lifetimes. */
export class ProgramStatusRecords {
  /** Insertion order is update order: the first entry is the least recently updated. */
  private records = new Map<string, ProgramStatus>();

  apply(report: ProgramReport, now: number): void {
    if (report.state === 'clear') {
      this.clear(report.id);
      return;
    }
    // Each report replaces its record completely.
    const { state, ...rest } = report;
    this.records.delete(report.id);
    this.records.set(report.id, { ...rest, state, updatedAt: now });
    if (this.records.size > MAX_RECORDS) {
      this.records.delete(this.records.keys().next().value!);
    }
  }

  /** `working` and `blocked` end with the process; `done`, `error` and `idle` survive it. */
  onProcessExit(): void {
    for (const [id, record] of this.records) {
      if (record.state === 'working' || record.state === 'blocked') this.records.delete(id);
    }
  }

  current(): ProgramStatus | null {
    let last: ProgramStatus | null = null;
    for (const record of this.records.values()) last = record;
    return last;
  }

  ids(): string[] {
    return [...this.records.keys()];
  }

  private clear(id: string): void {
    if (id === '') {
      this.records.clear();
      return;
    }
    for (const key of this.records.keys()) {
      if (key === id || key.startsWith(`${id}/`)) this.records.delete(key);
    }
  }
}
