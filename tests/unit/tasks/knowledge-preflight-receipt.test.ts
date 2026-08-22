import assert from "node:assert/strict";
import test from "node:test";

import {
  KnowledgePreflightReceiptSchema,
  attachKnowledgePreflightReceipt
} from "../../../src/tasks/knowledge-preflight-receipt.js";

const receipt = KnowledgePreflightReceiptSchema.parse({
  knowledge_base_path: "D:/AI_Knowledge_Base",
  knowledge_base_head: "670414561cb44acfd79bc1d5e858ee814a09a240",
  project_profile: "wiki/projects/biaogu-hunter/PROJECT_PROFILE.md",
  goal_id: "bridge-preflight-v1",
  goal_summary: "Carry bounded current knowledge into delegated engineering work.",
  acceptance_criteria: ["Preserve the original task instruction.", "Do not widen authority."],
  relevant_topics: ["wiki/global/KNOWLEDGE_PREFLIGHT_PROTOCOL.md"],
  critical_boundaries: ["No secret values.", "No production release authority."]
});

test("attaches a bounded receipt and exact registered execution boundary", () => {
  const instruction = "Inspect the current task and report only evidence.";
  const rendered = attachKnowledgePreflightReceipt(instruction, receipt, {
    workspaceId: "biaogu-wt",
    workspaceRoot: "D:/WORKTREE_ZONE/biaogu-wt",
    executor: "codex"
  });

  assert.match(rendered, /Knowledge Preflight Receipt/u);
  assert.match(rendered, /knowledge_base_head: 670414561cb44acfd79bc1d5e858ee814a09a240/u);
  assert.match(rendered, /goal_id: bridge-preflight-v1/u);
  assert.match(rendered, /workspace_id: biaogu-wt/u);
  assert.match(rendered, /workspace_root: D:\/WORKTREE_ZONE\/biaogu-wt/u);
  assert.match(rendered, /sandbox: read-only/u);
  assert.match(rendered, /does not grant write, release, credential, or scope-expansion authority/u);
  assert.equal(rendered.endsWith(`Task instruction:\n${instruction}`), true);
});

test("keeps legacy calls byte-for-byte unchanged when no receipt is supplied", () => {
  const instruction = "  exact instruction\nwith bytes $()  ";
  assert.equal(attachKnowledgePreflightReceipt(instruction, undefined, {
    workspaceId: "known",
    workspaceRoot: "/registered/root",
    executor: "dsh"
  }), instruction);
});

test("schema rejects multiline metadata, oversized lists, and non-SHA knowledge heads", () => {
  assert.equal(KnowledgePreflightReceiptSchema.safeParse({
    ...receipt,
    goal_summary: "line one\nline two"
  }).success, false);
  assert.equal(KnowledgePreflightReceiptSchema.safeParse({
    ...receipt,
    relevant_topics: Array.from({ length: 33 }, (_, index) => `topic-${index}`)
  }).success, false);
  assert.equal(KnowledgePreflightReceiptSchema.safeParse({
    ...receipt,
    knowledge_base_head: "main"
  }).success, false);
});
