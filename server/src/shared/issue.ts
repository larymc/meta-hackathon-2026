import { z } from "zod";

export const IssueTypeSchema = z.enum(["bug", "feature", "question", "maintenance"]);
export const UrgencySchema = z.enum(["low", "medium", "high", "unknown"]);
export const WorkflowStateSchema = z.enum([
  "draft",
  "needs_clarification",
  "awaiting_approval",
  "approved",
  "creating_issue",
  "issue_created",
  "developer_review",
  "failed",
]);

export const IssueDraftSchema = z.object({
  type: IssueTypeSchema,
  title: z.string().min(3).max(200),
  summary: z.string().min(3).max(1200),
  impact: z.string().max(600).nullable(),
  urgency: UrgencySchema,
  environment: z.string().max(300).nullable(),
  stepsToReproduce: z.array(z.string().max(300)).max(10),
  expectedBehavior: z.string().max(600).nullable(),
  actualBehavior: z.string().max(600).nullable(),
  acceptanceCriteria: z.array(z.string().max(300)).max(10),
  clarificationQuestions: z.array(z.string().max(300)).max(6),
  missingInformation: z.array(z.string().max(200)).max(10),
  confidence: z.number().min(0).max(1),
  readyForApproval: z.boolean(),
});
export type IssueDraft = z.infer<typeof IssueDraftSchema>;
export type WorkflowState = z.infer<typeof WorkflowStateSchema>;

export const ALLOWED_TRANSITIONS: Record<WorkflowState, WorkflowState[]> = {
  draft: ["needs_clarification", "awaiting_approval", "failed"],
  needs_clarification: ["needs_clarification", "awaiting_approval", "failed"],
  awaiting_approval: ["approved", "failed", "needs_clarification", "draft"],
  approved: ["creating_issue", "failed"],
  creating_issue: ["issue_created", "failed"],
  issue_created: ["developer_review"],
  developer_review: [],
  failed: ["draft", "needs_clarification", "awaiting_approval"],
};
export function canTransition(from: WorkflowState, to: WorkflowState): boolean {
  return from === to || ALLOWED_TRANSITIONS[from].includes(to);
}
