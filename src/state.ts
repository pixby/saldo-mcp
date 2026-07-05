import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isExpired } from "./consent/consent.js";

/**
 * Local link state — the consent sessions the user has established. Holds NO
 * transaction data: only opaque account ids, session ids, and consent expiry.
 * Account ids are *derived* from the sessions (deduped, live-only) rather than
 * stored separately, so disconnecting a session or letting it expire updates the
 * connected set automatically.
 */

export interface SessionRecord {
  /** Provider session/consent id. */
  referenceId: string;
  institutionId: string;
  createdAt: string;
  /** ISO timestamp the consent expires — drives renewal reminders (~180 days). */
  validUntil?: string;
  accountIds: string[];
}

interface StateShape {
  provider: string;
  sessions: SessionRecord[];
}

const EMPTY: StateShape = { provider: "", sessions: [] };

export class StateStore {
  private readonly file: string;
  private state: StateShape = { ...EMPTY };

  constructor(dataDir: string) {
    this.file = join(dataDir, "state.json");
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.file, "utf8");
      this.state = { ...EMPTY, ...(JSON.parse(raw) as Partial<StateShape>) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(this.state, null, 2), "utf8");
  }

  /** Account ids from non-expired sessions, de-duplicated. */
  get accountIds(): string[] {
    const now = Date.now();
    const ids = this.state.sessions
      .filter((s) => !isExpired(s.validUntil, now))
      .flatMap((s) => s.accountIds);
    return [...new Set(ids)];
  }

  get sessions(): SessionRecord[] {
    return [...this.state.sessions];
  }

  /** Record a completed consent session (replacing any with the same id). */
  async addSession(record: SessionRecord): Promise<void> {
    this.state.sessions = [
      ...this.state.sessions.filter((s) => s.referenceId !== record.referenceId),
      record,
    ];
    await this.persist();
  }

  async removeSession(referenceId: string): Promise<void> {
    this.state.sessions = this.state.sessions.filter((s) => s.referenceId !== referenceId);
    await this.persist();
  }
}
