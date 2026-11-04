<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import {
  Bug, CheckCheck, ChevronRight, CircleAlert, Clock3, ExternalLink, ImagePlus,
  MessageCircle, RotateCcw, Send, Sparkles, TicketCheck, Wand2,
} from "lucide-vue-next";

type Msg = { id: string; role: string; content: string; hasImage?: boolean; createdAt?: string };
type Draft = {
  type: string; title: string; summary: string; impact: string | null; urgency: string;
  environment: string | null; stepsToReproduce: string[]; expectedBehavior: string | null;
  actualBehavior: string | null; acceptanceCriteria: string[]; clarificationQuestions: string[];
  missingInformation: string[]; confidence: number; readyForApproval: boolean;
};
type Conv = {
  id: string; customerName: string; state: string; messages: Msg[]; draft: Draft | null;
  issue: { number: number; url: string; repo: string; isDemo?: boolean } | null;
  duplicates: { number: number; title: string; score: number }[]; issueBody: string;
};
const conv = ref<Conv | null>(null);
const health = ref<{ mode: string; ai: { provider: string; isDemo: boolean }; issues: { provider: string; isDemo: boolean } } | null>(null);
const input = ref("");
const typing = ref(false);
const error = ref("");
const mobileTab = ref<"chat" | "workbench">("chat");
const chatEl = ref<HTMLElement | null>(null);
const fileEl = ref<HTMLInputElement | null>(null);

const stateLabel: Record<string, string> = {
  draft: "Getting started", needs_clarification: "Clarifying details", awaiting_approval: "Ready for your review",
  approved: "Approved", creating_issue: "Creating ticket", issue_created: "Ticket created",
  developer_review: "With developer", failed: "Needs attention",
};
const flow = ["draft", "needs_clarification", "awaiting_approval", "issue_created", "developer_review"];
const flowIdx = computed(() => {
  if (!conv.value) return 0;
  if (conv.value.state === "issue_created") return 3;
  if (conv.value.state === "developer_review") return 4;
  return Math.max(0, flow.indexOf(conv.value.state));
});
const canApprove = computed(() => conv.value?.state === "awaiting_approval" && !conv.value?.issue);
const isLive = computed(() => health.value?.mode === "live" && !health.value?.ai.isDemo);

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) throw new Error((await res.json().catch(() => ({ error: res.statusText }))).error ?? res.statusText);
  return res.json() as Promise<T>;
}
async function scrollDown() { await nextTick(); if (chatEl.value) chatEl.value.scrollTop = chatEl.value.scrollHeight; }
async function loadHealth() { health.value = await api("/api/health"); }
async function newConversation() {
  error.value = "";
  conv.value = await api<Conv>("/api/conversations", { method: "POST" });
  input.value = "";
  await scrollDown();
}
async function send(text?: string, hasImage = false) {
  const value = (text ?? input.value).trim();
  if (!value || !conv.value || typing.value) return;
  input.value = "";
  typing.value = true;
  error.value = "";
  try {
    conv.value = await api<Conv>(`/api/conversations/${conv.value.id}/messages`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: value, hasImage }),
    });
  } catch (e) { error.value = e instanceof Error ? e.message : "Something went wrong. Please try again."; }
  finally { typing.value = false; await scrollDown(); }
}
async function approve() {
  if (!conv.value) return;
  typing.value = true; error.value = "";
  try { conv.value = await api<Conv>(`/api/conversations/${conv.value.id}/approve`, { method: "POST" }); }
  catch (e) { error.value = e instanceof Error ? e.message : "Could not create the ticket."; }
  finally { typing.value = false; await scrollDown(); }
}
async function onFile(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0];
  if (!file || !conv.value) return;
  typing.value = true;
  try {
    const fd = new FormData(); fd.append("file", file);
    conv.value = await api<Conv>(`/api/conversations/${conv.value.id}/screenshot`, { method: "POST", body: fd });
  } catch (e) { error.value = e instanceof Error ? e.message : "Screenshot upload failed."; }
  finally { typing.value = false; (ev.target as HTMLInputElement).value = ""; await scrollDown(); }
}
async function requestChanges() {
  await send("Request changes — please don't create this ticket yet. Ask me what to revise.");
  mobileTab.value = "chat";
}
async function playScenario(kind: "bug" | "feature") {
  await newConversation();
  if (kind === "bug") {
    await send("My website booking form doesn't work. Customers can't submit bookings.");
    await send("The submit button keeps spinning on my iPhone.");
    await send("[Screenshot shared] I attached a screenshot of the problem.", true);
  } else {
    await send("Can customers receive an email confirmation after booking?");
    await send("Yes please — include the booking date, time and a reference number.");
  }
  mobileTab.value = "workbench";
}
onMounted(async () => { await loadHealth(); conv.value = await api<Conv>("/api/conversations/current"); await scrollDown(); });
</script>

<template>
  <div class="min-h-screen bg-[#eef2f7] text-slate-800">
    <header class="bg-navy-950 text-white">
      <div class="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        <div class="flex items-center gap-3">
          <div class="grid size-10 place-items-center rounded-xl bg-cyan-400 font-black text-navy-950">R</div>
          <div>
            <p class="text-lg font-extrabold leading-none tracking-tight">Relais</p>
            <p class="text-xs text-cyan-200">From Conversation to Code · Gaismas Inc. · Alberta, Canada</p>
          </div>
        </div>
        <div class="ml-auto flex flex-wrap items-center gap-2 text-xs">
          <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold" :class="isLive ? 'bg-emerald-400/20 text-emerald-200' : 'bg-amber-400/20 text-amber-200'">
            <Sparkles class="size-3.5" /> {{ isLive ? "LIVE — Muse inference" : "DEMO — simulated integrations" }}
          </span>
          <span class="hidden rounded-full bg-white/10 px-2.5 py-1 sm:inline">Meta Global AI Developer Hackathon 2026</span>
        </div>
      </div>
      <div v-if="health" class="border-t border-white/10 bg-navy-900/70">
        <p class="mx-auto max-w-7xl px-4 py-1.5 text-[11px] text-slate-300 sm:px-6">
          AI: {{ health.ai.provider }} · Issues: {{ health.issues.provider }} · Nothing is sent externally in Demo mode.
        </p>
      </div>
    </header>

    <main class="mx-auto max-w-7xl px-4 py-4 sm:px-6">
      <section class="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <span class="mr-1 inline-flex items-center gap-1.5 text-sm font-bold text-navy-900"><Wand2 class="size-4 text-cyan-600" /> Try the demo</span>
        <button class="inline-flex items-center gap-1.5 rounded-md bg-navy-900 px-3 py-2 text-sm font-semibold text-white" @click="playScenario('bug')"><Bug class="size-4" /> Bug Report</button>
        <button class="inline-flex items-center gap-1.5 rounded-md bg-cyan-500 px-3 py-2 text-sm font-semibold text-navy-950" @click="playScenario('feature')"><Sparkles class="size-4" /> Feature Request</button>
        <button class="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold" @click="newConversation"><RotateCcw class="size-4" /> Reset demo</button>
        <span class="ml-auto hidden text-xs text-slate-500 lg:inline">Demo customer: Sarah — Maple &amp; Main Bakery (fictional)</span>
      </section>

      <div class="mb-3 flex gap-2 lg:hidden">
        <button class="flex-1 rounded-md py-2 text-sm font-bold" :class="mobileTab === 'chat' ? 'bg-navy-900 text-white' : 'bg-white border'" @click="mobileTab = 'chat'">Chat</button>
        <button class="flex-1 rounded-md py-2 text-sm font-bold" :class="mobileTab === 'workbench' ? 'bg-navy-900 text-white' : 'bg-white border'" @click="mobileTab = 'workbench'">Ticket workbench</button>
      </div>

      <div class="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <!-- Chat simulator -->
        <section :class="mobileTab === 'chat' ? '' : 'hidden lg:block'" class="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div class="flex items-center gap-3 bg-[#075e54] px-4 py-3 text-white">
            <div class="grid size-10 place-items-center rounded-full bg-white/20 font-bold">S</div>
            <div class="min-w-0">
              <p class="truncate font-bold leading-tight">Sarah · Maple &amp; Main Bakery</p>
              <p class="text-xs text-emerald-100">{{ typing ? "Relais is typing…" : "WhatsApp-style simulator · same workflow as live WhatsApp" }}</p>
            </div>
            <MessageCircle class="ml-auto size-5 shrink-0 opacity-80" />
          </div>
          <div ref="chatEl" role="log" aria-live="polite" class="chat-bg h-[420px] space-y-2 overflow-y-auto p-3 sm:p-4">
            <div v-if="!conv?.messages.length" class="mx-auto mt-16 max-w-xs rounded-md bg-white/90 p-4 text-center text-sm text-slate-600 shadow-sm">
              <p class="font-bold text-navy-900">Start by describing a problem</p>
              <p class="mt-1">Try “My booking form doesn't work” — Relais will ask what it needs, then draft a ticket for approval.</p>
            </div>
            <div v-for="m in conv?.messages" :key="m.id" class="flex" :class="m.role === 'customer' ? 'justify-end' : 'justify-start'">
              <div class="max-w-[82%] rounded-lg px-3 py-2 text-[15px] leading-snug shadow-sm" :class="m.role === 'customer' ? 'rounded-br-sm bg-[#dcf8c6]' : 'rounded-bl-sm bg-white'">
                <p v-if="m.hasImage" class="mb-1.5 rounded bg-slate-100 px-2 py-1.5 text-xs font-semibold text-slate-600">▣ Screenshot attached</p>
                <p class="whitespace-pre-wrap">{{ m.content }}</p>
                <p class="mt-1 flex items-center justify-end gap-1 text-[10px] text-slate-500">
                  {{ m.createdAt ? new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "" }}
                  <CheckCheck v-if="m.role === 'customer'" class="size-3 text-sky-500" />
                </p>
              </div>
            </div>
            <div v-if="typing" class="flex justify-start"><div class="rounded-lg rounded-bl-sm bg-white px-3 py-2 text-sm text-slate-500 shadow-sm">Relais is typing…</div></div>
          </div>
          <div v-if="error" class="flex items-start gap-2 border-t border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700"><CircleAlert class="mt-0.5 size-4 shrink-0" /> {{ error }}</div>
          <div v-if="canApprove" class="flex gap-2 border-t bg-cyan-50 px-3 py-2.5">
            <button class="flex-1 rounded-md bg-navy-900 py-2.5 text-sm font-bold text-white disabled:opacity-50" :disabled="typing" @click="approve">Approve &amp; create ticket</button>
            <button class="rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold" @click="requestChanges">Request changes</button>
          </div>
          <form class="flex items-end gap-2 border-t p-3" @submit.prevent="send()">
            <input ref="fileEl" type="file" accept="image/png,image/jpeg,image/webp" class="hidden" aria-label="Attach screenshot" @change="onFile" />
            <button type="button" title="Attach screenshot" class="rounded-full border border-slate-300 p-2.5 text-slate-600" @click="fileEl?.click()"><ImagePlus class="size-5" /></button>
            <input v-model="input" aria-label="Message as the customer" placeholder="Message as the customer…" class="min-w-0 flex-1 rounded-full border border-slate-300 px-4 py-2.5 outline-none focus:border-cyan-500" />
            <button aria-label="Send message" class="rounded-full bg-[#128c7e] p-2.5 text-white disabled:opacity-40" :disabled="!input.trim() || typing"><Send class="size-5" /></button>
          </form>
        </section>

        <!-- AI Workbench -->
        <section :class="mobileTab === 'workbench' ? '' : 'hidden lg:block'" class="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div class="flex flex-wrap items-center gap-2 bg-navy-900 px-4 py-3 text-white">
            <TicketCheck class="size-5 text-cyan-300" />
            <h2 class="font-bold">AI Workbench</h2>
            <span class="rounded-full bg-white/10 px-2 py-0.5 text-xs">{{ conv ? stateLabel[conv.state] : "—" }}</span>
            <span v-if="conv?.draft" class="ml-auto text-xs text-cyan-200">Confidence {{ Math.round(conv.draft.confidence * 100) }}%</span>
          </div>

          <ol class="flex items-center gap-1 border-b px-4 py-3 text-[11px] font-semibold text-slate-500">
            <li v-for="(s, i) in ['Intake', 'Clarify', 'Review', 'Ticket', 'Dev review']" :key="s" class="flex items-center gap-1">
              <span class="grid size-6 place-items-center rounded-full" :class="i <= flowIdx ? 'bg-cyan-500 text-navy-950' : 'bg-slate-100'">{{ i + 1 }}</span>
              <span class="hidden sm:inline" :class="i <= flowIdx ? 'text-navy-900' : ''">{{ s }}</span>
              <ChevronRight v-if="i < 4" class="size-3.5 text-slate-300" />
            </li>
          </ol>

          <div class="max-h-[620px] space-y-4 overflow-y-auto p-4">
            <div v-if="!conv?.draft" class="py-10 text-center text-sm text-slate-500">
              <Clock3 class="mx-auto mb-2 size-8 text-slate-300" />
              No ticket draft yet.<br />Send a message in the chat and Relais will interpret it here.
            </div>
            <template v-else>
              <div>
                <p class="text-xs font-bold uppercase tracking-wide text-slate-500">AI interpretation</p>
                <p class="mt-1 flex flex-wrap gap-1.5">
                  <span class="rounded bg-navy-900 px-2 py-0.5 text-xs font-bold text-white">{{ conv.draft.type }}</span>
                  <span class="rounded bg-slate-100 px-2 py-0.5 text-xs">Urgency: {{ conv.draft.urgency }}</span>
                  <span v-if="conv.draft.environment" class="rounded bg-slate-100 px-2 py-0.5 text-xs">{{ conv.draft.environment }}</span>
                </p>
                <h3 class="mt-2 text-base font-bold text-navy-950">{{ conv.draft.title }}</h3>
                <p class="mt-1 text-sm leading-relaxed text-slate-600">{{ conv.draft.summary }}</p>
              </div>

              <div v-if="conv.draft.missingInformation.length" class="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <p class="font-bold">Still clarifying</p>
                <ul class="mt-1 list-inside list-disc"><li v-for="q in conv.draft.clarificationQuestions" :key="q">{{ q }}</li></ul>
                <p class="mt-1 text-xs">Missing: {{ conv.draft.missingInformation.join(" · ") }}</p>
              </div>
              <p v-else class="rounded-md bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">Ready — waiting for explicit customer approval. No ticket is created before approval.</p>

              <div class="grid gap-3 text-sm sm:grid-cols-2">
                <div class="rounded-md bg-slate-50 p-3"><p class="text-xs font-bold text-slate-500">EXPECTED</p><p class="mt-1">{{ conv.draft.expectedBehavior ?? "Unknown" }}</p></div>
                <div class="rounded-md bg-slate-50 p-3"><p class="text-xs font-bold text-slate-500">ACTUAL</p><p class="mt-1">{{ conv.draft.actualBehavior ?? "Unknown" }}</p></div>
              </div>
              <div v-if="conv.draft.stepsToReproduce.length" class="text-sm">
                <p class="text-xs font-bold text-slate-500">STEPS TO REPRODUCE (customer-confirmed only)</p>
                <ol class="mt-1 list-inside list-decimal space-y-0.5"><li v-for="s in conv.draft.stepsToReproduce" :key="s">{{ s }}</li></ol>
              </div>
              <div class="text-sm">
                <p class="text-xs font-bold text-slate-500">ACCEPTANCE CRITERIA</p>
                <ul class="mt-1 list-inside list-disc space-y-0.5"><li v-for="s in conv.draft.acceptanceCriteria" :key="s">{{ s }}</li></ul>
              </div>

              <div v-if="conv.duplicates.length" class="rounded-md border border-slate-200 p-3 text-sm">
                <p class="font-bold text-navy-900">Possible duplicates — review before filing</p>
                <ul class="mt-1 space-y-1"><li v-for="d in conv.duplicates" :key="d.number" class="flex justify-between gap-2"><span>#{{ d.number }} {{ d.title }}</span><span class="shrink-0 text-xs text-slate-500">{{ Math.round(d.score * 100) }}% similar</span></li></ul>
              </div>

              <div v-if="conv.issue" class="rounded-md bg-navy-950 p-3.5 text-white">
                <p class="flex items-center gap-2 font-bold"><TicketCheck class="size-5 text-cyan-300" /> {{ conv.issue.isDemo ? "Demo issue" : "GitHub issue" }} #{{ conv.issue.number }} created</p>
                <p class="mt-1 break-all text-xs text-slate-300">Repository: {{ conv.issue.repo }} · Status: Awaiting Developer Review</p>
                <a :href="conv.issue.url" target="_blank" rel="noreferrer" class="mt-2 inline-flex items-center gap-1 text-sm font-bold text-cyan-300">View issue <ExternalLink class="size-4" /></a>
              </div>

              <details class="rounded-md border border-slate-200 p-3 text-sm">
                <summary class="cursor-pointer font-bold text-navy-900">Full GitHub issue preview</summary>
                <pre class="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-slate-600">{{ conv.issueBody }}</pre>
              </details>

              <div class="text-sm">
                <p class="text-xs font-bold text-slate-500">EVENT TIMELINE</p>
                <ul class="mt-1.5 space-y-1.5 border-l-2 border-slate-100 pl-3">
                  <li v-for="m in conv.messages" :key="'t' + m.id" class="text-xs text-slate-600"><span class="font-semibold text-navy-900">{{ m.role === "customer" ? "Customer" : "Relais" }}:</span> {{ m.content.slice(0, 110) }}{{ m.content.length > 110 ? "…" : "" }}</li>
                  <li v-if="conv.issue" class="text-xs font-semibold text-emerald-700">Issue #{{ conv.issue.number }} created after approval ({{ health?.issues.isDemo ? "simulated" : "live" }})</li>
                </ul>
              </div>

              <button v-if="canApprove" class="w-full rounded-md bg-navy-900 py-3 text-sm font-bold text-white disabled:opacity-50" :disabled="typing" @click="approve">Approve &amp; create ticket</button>
              <button v-if="canApprove" class="w-full rounded-md border border-slate-300 py-2.5 text-sm font-semibold" @click="requestChanges">Request changes</button>
            </template>
          </div>
        </section>
      </div>

      <footer class="mt-4 flex flex-wrap justify-between gap-2 text-xs text-slate-500">
        <p>Relais by Gaismas Inc. · AI translates and coordinates — humans keep engineering authority.</p>
        <p>Customer data in this demo is fictional. No external sends occur in Demo mode.</p>
      </footer>
    </main>
  </div>
</template>

