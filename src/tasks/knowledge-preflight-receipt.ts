import { z } from "zod";
import type { SandboxMode } from "../executors/executor.js";

const singleLine = z.string()
  .min(1)
  .max(2048)
  .refine((value) => !/[\r\n]/u.test(value), "must be a single line");

const boundedList = z.array(singleLine).min(1).max(32);
const boundedOptionalList = z.array(singleLine).max(32);

export const KnowledgePreflightReceiptSchema = z.object({
  knowledge_base_path: singleLine,
  knowledge_base_head: z.string().regex(/^[0-9a-f]{7,64}$/u),
  project_profile: singleLine,
  goal_id: singleLine.optional(),
  goal_summary: singleLine,
  acceptance_criteria: boundedList,
  relevant_topics: boundedList,
  critical_boundaries: boundedList,
  preflight_completed: z.boolean().optional(),
  memory_required: z.boolean().optional(),
  required_skills: boundedOptionalList.optional()
}).strict();

export type KnowledgePreflightReceipt = z.infer<typeof KnowledgePreflightReceiptSchema>;

export interface KnowledgePreflightExecutionBoundary {
  readonly workspaceId: string;
  readonly workspaceRoot: string;
  readonly executor: "codex" | "dsh";
  readonly sandbox: SandboxMode;
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
    ...(receipt.preflight_completed === true
      ? [
        "bootstrap_policy:",
        `- memory: ${receipt.memory_required === true ? "required" : "skip_unless_required"}`,
        "- skills: explicit_only",
        "- repo_discovery: bounded",
        "- goal_autostart: false",
        "required_skills:",
        ...(receipt.required_skills?.length ? bulletList(receipt.required_skills) : ["- none"])
      ]
      : []),
    "exact_execution_boundary:",
    `- workspace_id: ${boundary.workspaceId}`,
    `- workspace_root: ${boundary.workspaceRoot}`,
    `- executor: ${boundary.executor}`,
    `- sandbox: ${boundary.sandbox}`,
    "End Knowledge Preflight Receipt",
    "",
    "Task instruction:",
    instruction
  ];
  return lines.join("\n");
}
