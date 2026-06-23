import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDraftStructureTool, createRemoveNodeTool } from "../agent/film-authoring-tools.js";
import { loadStoryGraph, saveStoryGraph } from "../interactive-film/graph-store.js";
import { StoryGraphSchema } from "../interactive-film/graph-schema.js";

const structure = JSON.stringify({ nodes: [
  { id: "s", type: "start", choices: [{ id: "c", text: "go", targetNodeId: "e" }] },
  { id: "e", type: "ending", choices: [] },
] });

describe("confirm-class authoring tools", () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "if-cf-")); await mkdir(join(root, "interactive-films", "p"), { recursive: true }); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("draft_structure (stubbed LLM) creates the node skeleton", async () => {
    const tool = createDraftStructureTool(root, "p", { chat: async () => structure });
    await tool.execute("call-1", { instruction: "三幕" } as never);
    expect((await loadStoryGraph(root, "p"))?.nodes.map(n => n.id).sort()).toEqual(["e", "s"]);
  });

  it("remove_node deletes the node", async () => {
    await saveStoryGraph(root, "p", StoryGraphSchema.parse({ schemaVersion: 1, projectId: "p", title: "T", variables: [], nodes: [{ id: "s", type: "start", choices: [] }, { id: "x", type: "normal", choices: [] }], endings: [] }));
    const tool = createRemoveNodeTool(root, "p");
    await tool.execute("call-2", { nodeId: "x" } as never);
    expect((await loadStoryGraph(root, "p"))?.nodes.map(n => n.id)).toEqual(["s"]);
  });
});
