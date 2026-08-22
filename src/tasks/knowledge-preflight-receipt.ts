import { z } from "zod";

const singleLine = z.string()
  .min(1)
  .max(2048)
  .refine((value) => !/[\r\n]/u.test(value), "must be a single line");

const boundedList = z.array(singleLine).min(1).max(32);

export const KnowledgePreflightReceiptSchema = z.object({
  knowledge_base_path: singleLine,
  knowledge_base_head: z.string().regex(/^[0-9a-f]{7,64}$/u),
  project_profile: singleLine,
  goal_id: singleLine.optional(),
  goal_summary: singleLine,
  acceptance_criteria: boundedList,
  relevant_topics: boundedList,
  critical_boundaries: boundedList
}).strict();

export type KnowledgePreflightReceipt = z.infer<typeof KnowledgePreflightReceiptSchema>;

export interface KnowledgePreflightExecutionBoundary {
  readonly workspaceId: string;
  readonly workspaceRoot: string;
  readonly executor: "codex" | "dsh";
}

function bulletList(values: readonly string[]): string[] {
  return values.map((value) => `- ${value}`);
}

export function attachKnowledgePreflightReceipt(
  instruction: string,
  receipt: KnowledgePreflightReceipt | undefined,
  boundary: KnowledgePreflightExecutionBoundary
): string {
  if (receipt === undefined) return instruction;

  const lines = [
    "Knowledge Preflight Receipt",
    "This is bounded delegation context from the orchestrator. It does not grant write, release, credential, or scope-expansion authority.",
    `knowledge_base_path: ${receipt.knowledge_base_path}`,
    `knowledge_base_head: ${receipt.knowledge_base_head}`,
    `project_profile: ${receipt.project_profile}`,
    ...(receipt.goal_id === undefined ? [] : [`goal_id: ${receipt.goal_id}`]),
    `goal_summary: ${receipt.goal_summary}`,
    "acceptance_criteria:",
    ...bulletList(receipt.acceptance_criteria),
    "relevant_topics:",
    ...bulletList(receipt.relevant_topics),
    "critical_boundaries:",
    ...bulletList(receipt.critical_boundaries),
    "exact_execution_boundary:",
    `- workspace_id: ${boundary.workspaceId}`,
    `- workspace_root: ${boundary.workspaceRoot}`,
    `- executor: ${boundary.executor}`,
    "- sandbox: read-only",
    "End Knowledge Preflight Receipt",
    "",
    "Task instruction:",
    instruction
  ];
  return lines.join("\n");
}
