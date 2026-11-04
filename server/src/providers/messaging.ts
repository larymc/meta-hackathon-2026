import crypto from "node:crypto";
import { config } from "../config.js";

export interface InboundMessage { externalId: string; customerId: string; text: string; hasImage?: boolean }
export interface MessagingProvider { name: string; isDemo: boolean; send(to: string, text: string): Promise<void> }

export class SimulatedMessagingProvider implements MessagingProvider {
  name = "SimulatedMessagingProvider (chat simulator)";
  isDemo = true;
  async send(): Promise<void> { /* simulator delivers via HTTP response */ }
}

export class WhatsAppCloudProvider implements MessagingProvider {
  name = "WhatsApp Cloud API";
  isDemo = false;
  async send(to: string, text: string): Promise<void> {
    const res = await fetch(`https://graph.facebook.com/v21.0/${config.whatsappPhoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.whatsappToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text } }),
    });
    if (!res.ok) throw new Error(`WhatsApp send failed: ${res.status}`);
  }
}

export function verifyWhatsAppSignature(rawBody: Buffer, signature: string | undefined): boolean {
  if (!config.whatsappAppSecret) return false;
  if (!signature?.startsWith("sha256=")) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", config.whatsappAppSecret).update(rawBody).digest("hex");
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature)); } catch { return false; }
}

export function parseWhatsAppPayload(body: any): { messages: InboundMessage[]; statusCount: number } {
  const messages: InboundMessage[] = [];
  let statusCount = 0;
  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value ?? {};
      statusCount += (value.statuses ?? []).length;
      for (const msg of value.messages ?? []) {
        if (msg.type === "text") messages.push({ externalId: String(msg.id), customerId: String(msg.from), text: String(msg.text?.body ?? "") });
        else if (msg.type === "image") messages.push({ externalId: String(msg.id), customerId: String(msg.from), text: msg.image?.caption ?? "[Screenshot shared]", hasImage: true });
      }
    }
  }
  return { messages, statusCount };
}

export function selectMessagingProvider(simulated: boolean): MessagingProvider {
  if (!simulated && config.whatsappToken && config.whatsappPhoneId) return new WhatsAppCloudProvider();
  return new SimulatedMessagingProvider();
}
