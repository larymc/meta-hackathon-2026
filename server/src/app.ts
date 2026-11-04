import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { z } from "zod";
import { appMode, authorizedRepoFor } from "./config.js";
import { selectAIProvider } from "./providers/ai.js";
import { selectIssueProvider } from "./providers/issues.js";
import { parseWhatsAppPayload, selectMessagingProvider, verifyWhatsAppSignature } from "./providers/messaging.js";
import { config } from "./config.js";
import { getDb, store } from "./store.js";
import { approveConversation, conversationView, getOrCreateConversation, handleInbound, newId, DEMO_CUSTOMER } from "./services/intake.js";

// NOTE: /api/* is the local simulator/operator interface for the hackathon demo.
// It has no per-customer auth; do not expose it publicly without adding auth.
export function buildApp() {
  getDb();
  const app = Fastify({ logger: false });
  const ai = selectAIProvider();
  const issues = selectIssueProvider();
  const messaging = selectMessagingProvider(false);
  const corsOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174").split(",").map((s) => s.trim());
  void app.register(cors, { origin: corsOrigins });
  void app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

  app.get("/api/health", async () => ({
    ok: true, mode: appMode(),
    ai: { provider: ai.name, isDemo: ai.isDemo, model: config.model },
    issues: { provider: issues.name, isDemo: issues.isDemo },
    whatsapp: { live: !messaging.isDemo, note: "Simulator shares the same intake workflow as the WhatsApp webhook." },
  }));

  app.post("/api/conversations", async () => {
    store.resetCustomer(DEMO_CUSTOMER.id); // Scoped reset, never a global wipe
    const id = newId();
    store.createConversation(id, DEMO_CUSTOMER.id, DEMO_CUSTOMER.name);
    return conversationView(id);
  });

  app.get("/api/conversations/current", async () => {
    const id = getOrCreateConversation();
    return conversationView(id);
  });
  app.get("/api/conversations/:id", async (req, reply) => {
    const v = conversationView((req.params as { id: string }).id);
    if (!v) return reply.code(404).send({ error: "Not found" });
    return v;
  });

  const MsgBody = z.object({ text: z.string().min(1).max(4000), hasImage: z.boolean().optional() });
  app.post("/api/conversations/:id/messages", async (req, reply) => {
    const parsed = MsgBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const id = (req.params as { id: string }).id;
    if (!store.getConversation(id)) return reply.code(404).send({ error: "Not found" });
    try {
      const r = await handleInbound(id, parsed.data.text, { hasImage: parsed.data.hasImage, ai, issues });
      return r.view;
    } catch (e) {
      return reply.code(502).send({ error: e instanceof Error ? e.message : "AI provider failed", failedLive: !ai.isDemo });
    }
  });

  app.post("/api/conversations/:id/approve", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    try {
      const r = await approveConversation(id, issues);
      return r.view;
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : "Approval failed" });
    }
  });

  app.post("/api/conversations/:id/screenshot", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    if (!store.getConversation(id)) return reply.code(404).send({ error: "Not found" });
    const data = await req.file().catch(() => null);
    if (!data) return reply.code(400).send({ error: "No file" });
    if (!["image/png", "image/jpeg", "image/webp"].includes(data.mimetype)) return reply.code(400).send({ error: "Only PNG, JPEG or WebP screenshots" });
    const buf = await data.toBuffer();
    if (buf.length > 5 * 1024 * 1024) return reply.code(400).send({ error: "Screenshot too large (max 5 MB)" });
    // Forward the real image (base64 data URL) to the AI provider.
    const imageDataUrl = `data:${data.mimetype};base64,${buf.toString("base64")}`;
    try {
      const r = await handleInbound(id, "[Screenshot shared] I attached a screenshot of the problem.", { hasImage: true, imageDataUrl, ai, issues });
      return r.view;
    } catch (e) {
      return reply.code(502).send({ error: e instanceof Error ? e.message : "AI provider failed", failedLive: !ai.isDemo });
    }
  });

  // WhatsApp webhook
  app.get("/webhooks/whatsapp", async (req, reply) => {
    const q = req.query as Record<string, string>;
    if (q["hub.mode"] === "subscribe" && q["hub.verify_token"] === config.whatsappVerifyToken) return reply.send(q["hub.challenge"]);
    return reply.code(403).send("Forbidden");
  });
  // WhatsApp signature verification needs the RAW body; API routes need parsed JSON.
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (req, body, done) => {
    if ((req.url ?? "").startsWith("/webhooks/")) return done(null, body);
    try {
      done(null, body.length ? JSON.parse(body.toString("utf8")) : {});
    } catch {
      done(new Error("Invalid JSON"), undefined);
    }
  });
  app.post("/webhooks/whatsapp", async (req, reply) => {
    const raw = req.body as Buffer;
    const sig = req.headers["x-hub-signature-256"] as string | undefined;
    if (config.whatsappAppSecret && !verifyWhatsAppSignature(raw, sig)) return reply.code(401).send({ error: "Invalid signature" });
    let body: unknown;
    try { body = JSON.parse(raw.toString("utf8") || "{}"); } catch { return reply.code(400).send({ error: "Bad JSON" }); }
    const { messages } = parseWhatsAppPayload(body);
    reply.send({ ok: true });
    for (const m of messages) {
      try {
        // Allowlist only — every sender must map to an authorized repo.
        if (!authorizedRepoFor(m.customerId)) continue;
        const convId = getOrCreateConversation(m.customerId, m.customerId);
        const r = await handleInbound(convId, m.text, { hasImage: m.hasImage, externalId: m.externalId, ai, issues });
        // Send the AI reply back over WhatsApp when live credentials exist.
        if (!r.deduped && r.reply && !messaging.isDemo) await messaging.send(m.customerId, r.reply);
      } catch {
        console.error("whatsapp intake failed for one message; continuing batch"); // no customer content logged
      }
    }
    return reply;
  });
  app.get("/", async () => ({ name: "Relais API", note: "Run the Vue client (npm run dev in client) and open http://localhost:5173" }));
  return app;
}
