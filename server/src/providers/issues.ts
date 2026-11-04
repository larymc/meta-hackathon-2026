import { config } from "../config.js";
import type { IssueDraft } from "../shared/issue.js";

export interface CreatedIssue { number: number; url: string; title: string; isDemo: boolean }
export interface IssueProvider {
  name: string;
  isDemo: boolean;
  listRecent(repo: string): Promise<{ number: number; title: string }[]>;
  create(draft: IssueDraft, repo: string): Promise<CreatedIssue>;
}
export function issueBody(d: IssueDraft): string {
  const list = (xs: string[]) => (xs.length ? xs.map((x) => `- ${x}`).join("\n") : "_Unknown — not provided by customer._");
  return `### Summary\n${d.summary}\n\n### Customer Impact\n${d.impact ?? "_Unknown — not provided by customer._"}\n\n### Environment\n${d.environment ?? "_Unknown — not provided by customer._"}\n\n### Steps to Reproduce\n${list(d.stepsToReproduce)}\n\n### Expected Behavior\n${d.expectedBehavior ?? "_Unknown._"}\n\n### Actual Behavior\n${d.actualBehavior ?? "_Unknown._"}\n\n### Acceptance Criteria\n${list(d.acceptanceCriteria)}\n\n### Source\nRelais — WhatsApp Client Intake\n\n### Status\nAwaiting Developer Review`;
}
let demoCounter = 1240;
export class MockGitHubProvider implements IssueProvider {
  name = "MockGitHubProvider (simulation)";
  isDemo = true;
  private recent: { number: number; title: string }[] = [
    { number: 1217, title: "[Bug] Booking form submission hangs on Android Chrome" },
    { number: 1224, title: "[Feature] SMS reminder before appointment" },
  ];
  async listRecent() {
    return this.recent;
  }
  async create(draft: IssueDraft): Promise<CreatedIssue> {
    const number = ++demoCounter;
    const url = `https://github.com/${config.demoRepo}/issues/${number}?relais_demo=1`;
    this.recent.unshift({ number, title: draft.title });
    return { number, url, title: draft.title, isDemo: true };
  }
}
export class GitHubProvider implements IssueProvider {
  name = "GitHub REST API";
  isDemo = false;
  async listRecent(repo: string) {
    const [owner, name] = repo.split("/");
    if (!owner || !name) throw new Error("Invalid repository mapping");
    const res = await fetch(`https://api.github.com/repos/${owner}/${name}/issues?state=all&per_page=20`, {
      headers: { Authorization: `Bearer ${config.githubToken}`, Accept: "application/vnd.github+json", "User-Agent": "Relais-Intake-Agent" },
    });
    if (!res.ok) throw new Error(`GitHub list failed: ${res.status}`);
    const data = (await res.json()) as { number: number; title: string }[];
    return data.map((d) => ({ number: d.number, title: d.title }));
  }
  async create(draft: IssueDraft, repo: string): Promise<CreatedIssue> {
    const [owner, name] = repo.split("/");
    if (!owner || !name) throw new Error("Invalid repository mapping");
    const labels = draft.type === "bug" ? ["bug", "relais"] : draft.type === "feature" ? ["enhancement", "relais"] : ["relais"];
    const res = await fetch(`https://api.github.com/repos/${owner}/${name}/issues`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.githubToken}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "User-Agent": "Relais-Intake-Agent" },
      body: JSON.stringify({ title: draft.title, body: issueBody(draft), labels }),
    });
    if (!res.ok) throw new Error(`GitHub create failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { number: number; html_url: string };
    return { number: data.number, url: data.html_url, title: draft.title, isDemo: false };
  }
}
export function selectIssueProvider(): IssueProvider {
  return config.githubToken && config.githubOwner && config.githubRepo ? new GitHubProvider() : new MockGitHubProvider();
}
export function duplicatesFor(draft: IssueDraft, recent: { number: number; title: string }[]) {
  const words = new Set<string>(draft.title.toLowerCase().replace(/[^a-z ]/g, "").split(/\s+/).filter((w: string) => w.length > 3));
  return recent
    .map((r) => {
      const rw = new Set<string>(r.title.toLowerCase().replace(/[^a-z ]/g, "").split(/\s+/));
      const overlap = [...words].filter((w: string) => rw.has(w)).length / Math.max(1, words.size);
      return { ...r, score: Math.round(overlap * 100) / 100 };
    })
    .filter((r) => r.score >= 0.35)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}
