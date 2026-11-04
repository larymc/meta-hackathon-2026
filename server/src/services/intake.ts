import crypto from "node:crypto";
import { IssueDraftSchema, canTransition, type WorkflowState } from "../shared/issue.js";
import { authorizedRepoFor } from "../config.js";
import type { AIProvider } from "../providers/ai.js";
import { duplicatesFor, issueBody, type IssueProvider } from "../providers/issues.js";
import { store } from "../store.js";

export const newId = () => crypto.randomUUID();
export const DEMO_CUSTOMER = { id: "demo-sarah", name: "Sarah — Maple & Main Bakery" };

export function getOrCreateConversation(customerId = DEMO_CUSTOMER.id, name = DEMO_CUSTOMER.name) {
  const existing = store.findByCustomer(customerId);
  if (existing) return existing.id;
  const id = newId();
  store.createConversation(id, customerId, name);
  return id;
}
export function conversationView(id: string) {
  const conv = store.getConversation(id);
  if (!conv) return null;
  const msgs = store.messages(id);
  const draft = conv.draftJson ? IssueDraftSchema.parse(JSON.parse(conv.draftJson)) : null;
  const issue = conv.issueJson ? JSON.parse(conv.issueJson) : null;
  return {
    id: conv.id, customerId: conv.customerId, customerName: conv.customerName, state: conv.state as WorkflowState,
    messages: msgs.map((m) => ({ id: m.id, role: m.role, content: m.content, hasImage: !!m.hasImage, createdAt: m.createdAt })),
    draft, issue,
    duplicates: [] as { number: number; title: string; score: number }[],
    issueBody: draft ? issueBody(draft) : "",
  };
}

export async function handleInbound(
  convId: string,
  text: string,
  opts: { hasImage?: boolean; imageDataUrl?: string; externalId?: string; ai: AIProvider; issues: IssueProvider },
) {
  if (opts.externalId && store.seenExternal(opts.externalId)) {
    return { deduped: true, view: conversationView(convId) };
  }
  const clean = text.trim().slice(0, 4000);
  if (!clean) return { deduped: false, view: conversationView(convId) };
  const conv = store.getConversation(convId);
  if (!conv) throw new Error("Conversation not found");
  // Analyze BEFORE persisting: a failed ai.analyze() must not leave an
  // orphaned customer turn that duplicates on retry.
  const prior = store.messages(convId);
  const history = [
    ...prior.map((m) => ({ role: m.role as "customer" | "assistant", content: m.content, hasImage: !!m.hasImage })),
    { role: "customer" as const, content: clean, hasImage: !!opts.hasImage, imageDataUrl: opts.imageDataUrl },
  ];
  const { reply, draft } = await opts.ai.analyze(history);
  const validated = IssueDraftSchema.parse(draft);
  const next: WorkflowState = validated.readyForApproval ? "awaiting_approval" : "needs_clarification";
  if (conv.state !== "issue_created" && conv.state !== "developer_review" && !canTransition(conv.state as WorkflowState, next)) {
    throw new Error(`Invalid transition ${conv.state} -> ${next}`);
  }
  store.addMessage(newId(), convId, "customer", clean, !!opts.hasImage, opts.externalId);
  const issue = conv.issueJson ? JSON.parse(conv.issueJson) : null;
  if (conv.state !== "issue_created" && conv.state !== "developer_review") store.updateState(convId, next, validated, issue);
  store.addMessage(newId(), convId, "assistant", reply, false);
  const repo = authorizedRepoFor(conv.customerId);
  const recent = repo ? await opts.issues.listRecent(repo).catch(() => []) : [];
  const view = conversationView(convId);
  if (view) view.duplicates = duplicatesFor(validated, recent);
  return { deduped: false, view, reply };
}

export async function approveConversation(convId: string, issues: IssueProvider) {
  const conv = store.getConversation(convId);
  if (!conv) throw new Error("Conversation not found");
  if (conv.issueJson) return { view: conversationView(convId), already: true };
  // Concurrent duplicate approval while creation is in flight: idempotent, not an error.
  if (conv.state === "creating_issue") return { view: conversationView(convId), already: true };
  if (conv.state !== "awaiting_approval") throw new Error("Explicit customer approval required: conversation is not awaiting approval");
  if (!conv.draftJson) throw new Error("No draft to approve");
  const draft = IssueDraftSchema.parse(JSON.parse(conv.draftJson));
  const repo = authorizedRepoFor(conv.customerId);
  if (!repo) throw new Error("No authorized repository mapping for this customer");
  const key = `approve:${convId}`;
  if (!store.claimIdempotency(key, convId)) return { view: conversationView(convId), already: true };
  store.updateState(convId, "creating_issue", draft, null);
  try {
    const created = await issues.create(draft, repo);
    const record = { ...created, repo, createdAt: new Date().toISOString() };
    store.updateState(convId, "issue_created", draft, record);
    store.updateState(convId, "developer_review", draft, record); // Hand off to developer review
    store.addMessage(newId(), convId, "assistant", created.isDemo ? `All set — I created demo issue #${created.number} (${repo}). Your developer will review it next.` : `All set — I created issue #${created.number} in ${repo}. Your developer will review it next.`, false);
    return { view: conversationView(convId), already: false };
  } catch (e) {
    // Release the idempotency key so a retry after a transient failure can succeed.
    store.releaseIdempotency(key);
    store.updateState(convId, "awaiting_approval", draft, null);
    throw e;
  }
}
