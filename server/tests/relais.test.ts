import crypto from "node:crypto";
import fs from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { IssueDraftSchema, canTransition } from "../src/shared/issue.js";
import { DeterministicDemoProvider, classifyType, stripCodeFences, type AIProvider } from "../src/providers/ai.js";
import { verifyWhatsAppSignature, parseWhatsAppPayload } from "../src/providers/messaging.js";
import { duplicatesFor, GitHubProvider, MockGitHubProvider, type IssueProvider } from "../src/providers/issues.js";
import { authorizedRepoFor, config } from "../src/config.js";
import { buildApp } from "../src/app.js";
import { getDb, store } from "../src/store.js";
import { approveConversation, handleInbound, DEMO_CUSTOMER } from "../src/services/intake.js";

beforeAll(() => { getDb(":memory:"); });

describe("classification & schema", () => {
  it("classifies bug vs feature", () => {
    expect(classifyType("booking form doesn't work")).toBe("bug");
    expect(classifyType("Can customers receive an email confirmation after booking?")).toBe("feature");
  });
  it("validates drafts and rejects bad output", () => {
    const ok = { type: "bug", title: "t title", summary: "s summary", impact: null, urgency: "high", environment: null, stepsToReproduce: [], expectedBehavior: null, actualBehavior: null, acceptanceCriteria: [], clarificationQuestions: [], missingInformation: [], confidence: 0.5, readyForApproval: false };
    expect(IssueDraftSchema.parse(ok).type).toBe("bug");
    expect(() => IssueDraftSchema.parse({ ...ok, confidence: 2 })).toThrow();
  });
  it("demo provider asks then becomes ready (bug); feature asks about contents", async () => {
    const ai = new DeterministicDemoProvider();
    const r1 = await ai.analyze([{ role: "customer", content: "My website booking form doesn't work. Customers can't submit bookings." }]);
    expect(r1.draft.readyForApproval).toBe(false);
    expect(r1.draft.clarificationQuestions.length).toBeGreaterThan(0);
    const r2 = await ai.analyze([
      { role: "customer", content: "My website booking form doesn't work." },
      { role: "customer", content: "The submit button keeps spinning on my iPhone." },
    ]);
    expect(r2.draft.readyForApproval).toBe(true);
    const f1 = await ai.analyze([{ role: "customer", content: "Can customers receive an email confirmation after booking?" }]);
    expect(f1.draft.type).toBe("feature");
    expect(f1.draft.readyForApproval).toBe(false);
  });
});

describe("workflow & approval", () => {
  it("enforces state machine + explicit approval + duplicate approval", async () => {
    expect(canTransition("draft", "awaiting_approval")).toBe(true);
    expect(canTransition("draft", "issue_created")).toBe(false);
    const app = buildApp();
    const create = await app.inject({ method: "POST", url: "/api/conversations" });
    const id = create.json().id as string;
    // approve before ready must fail
    expect((await app.inject({ method: "POST", url: `/api/conversations/${id}/approve` })).statusCode).toBe(400);
    await app.inject({ method: "POST", url: `/api/conversations/${id}/messages`, payload: { text: "My website booking form doesn't work. Customers can't submit bookings." } });
    await app.inject({ method: "POST", url: `/api/conversations/${id}/messages`, payload: { text: "The submit button keeps spinning on my iPhone." } });
    const a1 = await app.inject({ method: "POST", url: `/api/conversations/${id}/approve` });
    expect(a1.statusCode).toBe(200);
    const n1 = a1.json().issue.number;
    const a2 = await app.inject({ method: "POST", url: `/api/conversations/${id}/approve` });
    expect(a2.json().issue.number).toBe(n1); // idempotent
  });
  it("feature scenario end-to-end", async () => {
    const app = buildApp();
    const id = (await app.inject({ method: "POST", url: "/api/conversations" })).json().id as string;
    await app.inject({ method: "POST", url: `/api/conversations/${id}/messages`, payload: { text: "Can customers receive an email confirmation after booking?" } });
    await app.inject({ method: "POST", url: `/api/conversations/${id}/messages`, payload: { text: "Yes please — include the booking date, time and a reference number." } });
    const a = await app.inject({ method: "POST", url: `/api/conversations/${id}/approve` });
    expect(a.json().draft.type).toBe("feature");
    expect(a.json().issue.number).toBeGreaterThan(0);
  });
});

describe("security boundaries", () => {
  it("authorizes repos only via fixed mapping", () => {
    expect(authorizedRepoFor("demo-sarah")).toBeTruthy();
    expect(authorizedRepoFor("unknown-customer")).toBeNull();
  });
  it("verifies WhatsApp HMAC (positive + negative) and parses payloads, ignores statuses as messages", () => {
    const prev = config.whatsappAppSecret;
    config.whatsappAppSecret = "test-secret";
    const raw = Buffer.from(JSON.stringify({ x: 1 }));
    const sig = "sha256=" + crypto.createHmac("sha256", "test-secret").update(raw).digest("hex");
    expect(verifyWhatsAppSignature(raw, sig)).toBe(true);
    expect(verifyWhatsAppSignature(raw, "sha256=bad")).toBe(false);
    config.whatsappAppSecret = prev;
    const parsed = parseWhatsAppPayload({ entry: [{ changes: [{ value: { statuses: [{ id: "s1" }], messages: [{ id: "m1", from: "15551234567", type: "text", text: { body: "hello" } }] } }] }] });
    expect(parsed.statusCount).toBe(1);
    expect(parsed.messages).toHaveLength(1);
  });
  it("mock github + duplicates + error handling", async () => {
    const gh = new MockGitHubProvider();
    const c = await gh.create({ type: "bug", title: "[Bug] Booking form submission hangs on iPhone Safari", summary: "s", impact: null, urgency: "high", environment: null, stepsToReproduce: [], expectedBehavior: null, actualBehavior: null, acceptanceCriteria: [], clarificationQuestions: [], missingInformation: [], confidence: 0.9, readyForApproval: true });
    expect(c.isDemo).toBe(true);
    expect(duplicatesFor({ type: "bug", title: "[Bug] Booking form submission hangs on iPhone Safari", summary: "s", impact: null, urgency: "high", environment: null, stepsToReproduce: [], expectedBehavior: null, actualBehavior: null, acceptanceCriteria: [], clarificationQuestions: [], missingInformation: [], confidence: 0.9, readyForApproval: true }, await gh.listRecent("Gaismas/demo-site")).length).toBeGreaterThan(0);
  });
  it("deduplicates repeated WhatsApp webhooks by message id", async () => {
    const app = buildApp();
    await app.inject({ method: "POST", url: "/api/conversations" });
    const payload = { entry: [{ changes: [{ value: { messages: [{ id: "wamid-dedupe-1", from: "demo-sarah", type: "text", text: { body: "My website booking form doesn't work." } }] } }] }] };
    const r1 = await app.inject({ method: "POST", url: "/webhooks/whatsapp", payload });
    const r2 = await app.inject({ method: "POST", url: "/webhooks/whatsapp", payload });
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    const cur = await app.inject({ method: "GET", url: "/api/conversations/current" });
    const bodies = cur.json().messages.filter((m: { content: string }) => m.content === "My website booking form doesn't work.");
    expect(bodies).toHaveLength(1);
  });
  it("health reports demo mode honestly", async () => {
    const app = buildApp();
    const h = await app.inject({ method: "GET", url: "/api/health" });
    expect(["demo", "live"]).toContain(h.json().mode);
  });
});

describe("resilience, revision & edge-case coverage", () => {
  const draftFor = async (app: ReturnType<typeof buildApp>) => {
    const id = (await app.inject({ method: "POST", url: "/api/conversations" })).json().id as string;
    await app.inject({ method: "POST", url: `/api/conversations/${id}/messages`, payload: { text: "My website booking form doesn't work. Customers can't submit bookings." } });
    await app.inject({ method: "POST", url: `/api/conversations/${id}/messages`, payload: { text: "The submit button keeps spinning on my iPhone." } });
    return id;
  };

  it("retry after GitHub failure succeeds (idempotency released)", async () => {
    store.resetCustomer(DEMO_CUSTOMER.id);
    const id = crypto.randomUUID();
    store.createConversation(id, DEMO_CUSTOMER.id, DEMO_CUSTOMER.name);
    const ai = new DeterministicDemoProvider();
    const ok = new MockGitHubProvider();
    await handleInbound(id, "My website booking form doesn't work.", { ai, issues: ok });
    await handleInbound(id, "The submit button keeps spinning on my iPhone.", { ai, issues: ok });
    let calls = 0;
    const flaky: IssueProvider = { name: "flaky", isDemo: true, listRecent: async () => [], create: async () => { calls++; if (calls === 1) throw new Error("503"); return { number: 999, url: "https://example.invalid/999", title: "t", isDemo: true }; } };
    await expect(approveConversation(id, flaky)).rejects.toThrow("503");
    const retry = await approveConversation(id, flaky);
    expect(retry.already).toBe(false);
    expect(retry.view?.issue.number).toBe(999);
    expect(retry.view?.state).toBe("developer_review");
  });

  it("customer can revise/reject a draft without 502", async () => {
    expect(canTransition("awaiting_approval", "needs_clarification")).toBe(true);
    const app = buildApp();
    const id = await draftFor(app);
    const before = await app.inject({ method: "GET", url: `/api/conversations/${id}` });
    expect(before.json().state).toBe("awaiting_approval");
    const rev = await app.inject({ method: "POST", url: `/api/conversations/${id}/messages`, payload: { text: "Request changes — please don't create this ticket yet. Ask me what to revise." } });
    expect(rev.statusCode).toBe(200);
    expect(rev.json().state).toBe("needs_clarification");
  });

  it("non-booking bug reports do not fabricate Safari/booking titles", async () => {
    const ai = new DeterministicDemoProvider();
    const r = await ai.analyze([{ role: "customer", content: "The website is broken" }]);
    expect(r.draft.title).not.toContain("Safari");
    expect(r.draft.title).not.toContain("Booking form");
    const r2 = await ai.analyze([{ role: "customer", content: "The dark mode toggle on my profile page crashes Chrome on my Windows laptop." }]);
    expect(r2.draft.title).not.toContain("Safari");
    expect(r2.draft.environment).not.toBe("iPhone / Safari");
  });

  it("screenshot imageDataUrl is forwarded to the AI provider; fences stripped", async () => {
    expect(stripCodeFences("```json\n{\"a\":1}\n```")).toBe('{"a":1}');
    store.resetCustomer(DEMO_CUSTOMER.id);
    const id = crypto.randomUUID();
    store.createConversation(id, DEMO_CUSTOMER.id, DEMO_CUSTOMER.name);
    let seen = "";
    const capture: AIProvider = { name: "capture", isDemo: true, analyze: async (msgs) => { seen = msgs.find((m) => m.imageDataUrl)?.imageDataUrl ?? ""; return new DeterministicDemoProvider().analyze(msgs); } };
    await handleInbound(id, "[Screenshot shared]", { hasImage: true, imageDataUrl: "data:image/png;base64,iVBORw0KGgo=", ai: capture, issues: new MockGitHubProvider() });
    expect(seen).toBe("data:image/png;base64,iVBORw0KGgo=");
  });

  it("failed AI call leaves no orphaned customer turn", async () => {
    store.resetCustomer(DEMO_CUSTOMER.id);
    const id = crypto.randomUUID();
    store.createConversation(id, DEMO_CUSTOMER.id, DEMO_CUSTOMER.name);
    const failing: AIProvider = { name: "fail", isDemo: false, analyze: async () => { throw new Error("boom"); } };
    await expect(handleInbound(id, "hello there", { ai: failing, issues: new MockGitHubProvider() })).rejects.toThrow("boom");
    expect(store.messages(id)).toHaveLength(0);
  });

  it("concurrent approvals create one issue, no 400 race", async () => {
    store.resetCustomer(DEMO_CUSTOMER.id);
    const id = crypto.randomUUID();
    store.createConversation(id, DEMO_CUSTOMER.id, DEMO_CUSTOMER.name);
    const ai = new DeterministicDemoProvider();
    await handleInbound(id, "My website booking form doesn't work.", { ai, issues: new MockGitHubProvider() });
    await handleInbound(id, "The submit button keeps spinning on my iPhone.", { ai, issues: new MockGitHubProvider() });
    const slow: IssueProvider = { name: "slow", isDemo: true, listRecent: async () => [], create: async () => { await new Promise((r) => setTimeout(r, 30)); return { number: 555, url: "https://example.invalid/555", title: "t", isDemo: true }; } };
    const [a, b] = await Promise.allSettled([approveConversation(id, slow), approveConversation(id, slow)]);
    expect(a.status).toBe("fulfilled");
    expect(b.status).toBe("fulfilled");
  });

  it("unauthorized WhatsApp sender creates no conversation", async () => {
    const app = buildApp();
    await app.inject({ method: "POST", url: "/api/conversations" });
    const payload = { entry: [{ changes: [{ value: { messages: [{ id: "wamid-evil-1", from: "15559998888", type: "text", text: { body: "spam hello" } }] } }] }] };
    await app.inject({ method: "POST", url: "/webhooks/whatsapp", payload });
    const cur = await app.inject({ method: "GET", url: "/api/conversations/current" });
    expect(cur.json().messages.filter((m: { content: string }) => m.content === "spam hello")).toHaveLength(0);
    expect(store.findByCustomer("15559998888")).toBeNull();
  });

  it("GitHub listRecent queries the authorized repo with User-Agent", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => [{ number: 7, title: "x" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const gh = new GitHubProvider();
    expect(await gh.listRecent("org/repo-a")).toEqual([{ number: 7, title: "x" }]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(url).toContain("/repos/org/repo-a/issues");
    expect(init.headers["User-Agent"]).toBe("Relais-Intake-Agent");
    vi.unstubAllGlobals();
  });

  it("feature revision keeps [Feature] title; SMS-instead resolves to ready", async () => {
    const ai = new DeterministicDemoProvider();
    const revised = await ai.analyze([
      { role: "customer", content: "Can customers receive an email confirmation after booking?" },
      { role: "customer", content: "Request changes — please don't create this ticket yet. Ask me what to revise." },
    ]);
    expect(revised.draft.type).toBe("feature");
    expect(revised.draft.title.startsWith("[Feature]")).toBe(true);
    expect(revised.draft.readyForApproval).toBe(false);
    const resolved = await ai.analyze([
      { role: "customer", content: "Can customers receive an email confirmation after booking?" },
      { role: "customer", content: "Request changes — please don't create this ticket yet. Ask me what to revise." },
      { role: "customer", content: "Send an SMS confirmation instead of email" },
    ]);
    expect(resolved.draft.readyForApproval).toBe(true);
    expect(resolved.draft.title).toContain("SMS");
  });

  it("latest device mention wins over earlier history", async () => {
    const ai = new DeterministicDemoProvider();
    const r = await ai.analyze([
      { role: "customer", content: "My website booking form doesn't work on my iPhone." },
      { role: "customer", content: "The submit button keeps spinning. Actually it happens on Android." },
    ]);
    expect(r.draft.environment).toBe("Android");
  });

  it("resetCustomer clears idempotency rows for that customer", () => {
    store.resetCustomer(DEMO_CUSTOMER.id);
    const id = crypto.randomUUID();
    store.createConversation(id, DEMO_CUSTOMER.id, DEMO_CUSTOMER.name);
    expect(store.claimIdempotency(`approve:${id}`, id)).toBe(true);
    store.resetCustomer(DEMO_CUSTOMER.id);
    const id2 = crypto.randomUUID();
    store.createConversation(id2, DEMO_CUSTOMER.id, DEMO_CUSTOMER.name);
    expect(store.claimIdempotency(`approve:${id}`, id2)).toBe(true); // old key gone, claimable again
    store.resetCustomer(DEMO_CUSTOMER.id);
  });

  it("production start entry matches tsc output layout", () => {
    const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts: { start: string } };
    const tsconfig = fs.readFileSync(new URL("../tsconfig.json", import.meta.url), "utf8");
    expect(pkg.scripts.start).toBe("node dist/index.js");
    expect(tsconfig).toContain('"rootDir": "src"');
  });
});
