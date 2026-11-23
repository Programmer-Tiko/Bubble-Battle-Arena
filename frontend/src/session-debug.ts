/** Bind asynchronous debug replies to the currently connected session. */
export class SessionDebug<T> {
  private version = 0;
  private sessionId: string | null = null;
  data: T[] = [];

  bind(sessionId: string | null): void { this.sessionId = sessionId; this.clear(); }
  clear(): void { this.version++; this.data = []; }
  ticket(): { sessionId: string; version: number } | null {
    return this.sessionId ? { sessionId: this.sessionId, version: this.version } : null;
  }
  accept(ticket: { sessionId: string; version: number }, data: T[]): boolean {
    if (ticket.sessionId !== this.sessionId || ticket.version !== this.version) return false;
    this.data = data; return true;
  }
}
