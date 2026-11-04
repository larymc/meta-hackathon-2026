import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";
import type { IssueDraft, WorkflowState } from "./shared/issue.js";

export interface ConvRow { id: string; customerId: string; customerName: string; state: WorkflowState; draftJson: string | null; issueJson: string | null; createdAt: string }
export interface MsgRow { id: string; convId: string; role: string; content: string; hasImage: number; createdAt: string; externalId: string | null }

let db: DatabaseSync | null = null;
export function getDb(path = config.dbPath): DatabaseSync {
  if (db) return db;
  db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY, customer_id TEXT, customer_name TEXT, state TEXT, draft TEXT, issue TEXT, created_at TEXT);
    CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, conv_id TEXT, role TEXT, content TEXT, has_image INTEGER, created_at TEXT, external_id TEXT UNIQUE);
    CREATE TABLE IF NOT EXISTS idempotency(key TEXT PRIMARY KEY, conv_id TEXT, created_at TEXT);
  `);
  return db;
}
export function resetDbForTests() { try { db?.close(); } catch { /* noop */ } db = null; }
export const store = {
  createConversation(id: string, customerId: string, name: string) {
    getDb().prepare("INSERT INTO conversations(id,customer_id,customer_name,state,created_at) VALUES(?,?,?,'draft',?)").run(id, customerId, name, new Date().toISOString());
  },
  getConversation(id: string): ConvRow | null {
    const r = getDb().prepare("SELECT id, customer_id as customerId, customer_name as customerName, state, draft as draftJson, issue as issueJson, created_at as createdAt FROM conversations WHERE id=?").get(id) as unknown as ConvRow | undefined;
    return r ?? null;
  },
  findByCustomer(customerId: string): ConvRow | null {
    const r = getDb().prepare("SELECT id, customer_id as customerId, customer_name as customerName, state, draft as draftJson, issue as issueJson, created_at as createdAt FROM conversations WHERE customer_id=? ORDER BY created_at DESC LIMIT 1").get(customerId) as unknown as ConvRow | undefined;
    return r ?? null;
  },
  updateState(id: string, state: WorkflowState, draft: IssueDraft | null, issue: unknown) {
    getDb().prepare("UPDATE conversations SET state=?, draft=?, issue=? WHERE id=?").run(state, draft ? JSON.stringify(draft) : null, issue ? JSON.stringify(issue) : null, id);
  },
  addMessage(id: string, convId: string, role: string, content: string, hasImage: boolean, externalId?: string) {
    getDb().prepare("INSERT OR IGNORE INTO messages(id,conv_id,role,content,has_image,created_at,external_id) VALUES(?,?,?,?,?,?,?)").run(id, convId, role, content, hasImage ? 1 : 0, new Date().toISOString(), externalId ?? null);
  },
  messages(convId: string): MsgRow[] {
    return getDb().prepare("SELECT id, conv_id as convId, role, content, has_image as hasImage, created_at as createdAt, external_id as externalId FROM messages WHERE conv_id=? ORDER BY created_at ASC, rowid ASC").all(convId) as unknown as MsgRow[];
  },
  seenExternal(externalId: string): boolean {
    return !!getDb().prepare("SELECT external_id as externalId FROM messages WHERE external_id=?").get(externalId);
  },
  claimIdempotency(key: string, convId: string): boolean {
    const r = getDb().prepare("INSERT OR IGNORE INTO idempotency(key,conv_id,created_at) VALUES(?,?,?)").run(key, convId, new Date().toISOString()) as unknown as { changes: number };
    return Number(r.changes) === 1;
  },
  releaseIdempotency(key: string) {
    getDb().prepare("DELETE FROM idempotency WHERE key=?").run(key);
  },
  // Scoped demo reset: only the demo customer's conversations/messages. Webhook
  // dedupe history and other customers' data are never wiped (DEF-008).
  resetCustomer(customerId: string) {
    const d = getDb();
    d.prepare("DELETE FROM messages WHERE conv_id IN (SELECT id FROM conversations WHERE customer_id=?)").run(customerId);
    d.prepare("DELETE FROM idempotency WHERE conv_id IN (SELECT id FROM conversations WHERE customer_id=?)").run(customerId); // NEW-003
    d.prepare("DELETE FROM conversations WHERE customer_id=?").run(customerId);
  },
};
