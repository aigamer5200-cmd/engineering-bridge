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
    executor: "codex",
    sandbox: "danger-full-access"
  });

  assert.match(rendered, /Knowledge Preflight Receipt/u);
  assert.match(rendered, /knowledge_base_head: 670414561cb44acfd79bc1d5e858ee814a09a240/u);
  assert.match(rendered, /goal_id: bridge-preflight-v1/u);
  assert.match(rendered, /workspace_id: biaogu-wt/u);
  assert.match(rendered, /workspace_root: D:\/WORKTREE_ZONE\/biaogu-wt/u);
  assert.match(rendered, /sandbox: danger-full-access/u);
  assert.match(rendered, /does not grant write, release, credential, or scope-expansion authority/u);
  assert.equal(rendered.endsWith(`Task instruction:\n${instruction}`), true);
});

test("keeps legacy calls byte-for-byte unchanged when no receipt is supplied", () => {
  const instruction = "  exact instruction\nwith bytes $()  ";
  assert.equal(attachKnowledgePreflightReceipt(instruction, undefined, {
    workspaceId: "known",
    workspaceRoot: "/registered/root",
    executor: "dsh",
    sandbox: "read-only"
  }), instruction);
});

test("receipt without the new completion flag defaults to bounded DS-preflight bootstrap", () => {
  const rendered = attachKnowledgePreflightReceipt("Inspect only the bounded target.", receipt, {
    workspaceId: "known",
    workspaceRoot: "/registered/root",
    executor: "codex",
    sandbox: "read-only"
  });

  assert.match(rendered, /- memory: skip_unless_required/u);
  assert.match(rendered, /- skills: explicit_only/u);
  assert.match(rendered, /- repo_discovery: bounded/u);
  assert.match(rendered, /- goal_autostart: false/u);
  assert.match(rendered, /required_skills:\n- none/u);
});

test("explicit incomplete preflight keeps receipt text-only for forward-compatible callers", () => {
  const rendered = attachKnowledgePreflightReceipt("Keep legacy bootstrap behavior.", {
    ...receipt,
    preflight_completed: false
  }, {
    workspaceId: "known",
    workspaceRoot: "/registered/root",
    executor: "codex",
    sandbox: "read-only"
  });

  assert.equal(rendered.includes("bootstrap_policy:"), false);
  assert.equal(rendered.includes("required_skills:"), false);
});

test("completed DS preflight renders bounded bootstrap policy and explicit required skills", () => {
  const rendered = attachKnowledgePreflightReceipt("Inspect only the target file.", {
    ...receipt,
    preflight_completed: true,
    memory_required: false,
    required_skills: ["repo-safety-handoff"]
  }, {
    workspaceId: "known",
    workspaceRoot: "/registered/root",
    executor: "codex",
    sandbox: "read-only"
  });

  assert.match(rendered, /- memory: skip_unless_required/u);
  assert.match(rendered, /- skills: explicit_only/u);
  assert.match(rendered, /- repo_discovery: bounded/u);
  assert.match(rendered, /- goal_autostart: false/u);
  assert.match(rendered, /required_skills:\n- repo-safety-handoff/u);
});

test("completed DS preflight can explicitly require memory while allowing no skills", () => {
  const rendered = attachKnowledgePreflightReceipt("Use the requested memory context.", {
    ...receipt,
    preflight_completed: true,
    memory_required: true,
    required_skills: []
  }, {
    workspaceId: "known",
    workspaceRoot: "/registered/root",
    executor: "codex",
    sandbox: "read-only"
  });

  assert.match(rendered, /- memory: required/u);
  assert.match(rendered, /required_skills:\n- none/u);
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
