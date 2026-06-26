import { saveStoryGraph, StoryGraphSchema } from "@actalk/inkos-core";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));
export const E2E_ROOT = resolve(dir, "../../../..", "test-project");
export const E2E_ANALYSIS_ID = "e2e-analysis-panel-demo";

/**
 * Seeds a story graph that exercises the full AnalysisPanel:
 *
 * - start node → 2 branches → 2 endings (≥2 runtime paths for emotion arc + path distribution)
 * - dialogue lines with known-lexicon emotion strings (坚定, 紧张, 喜悦, 绝望)
 * - one ISOLATED_NODE (normal node that nothing points to) → triggers validation-issue-ISOLATED_NODE
 */
export async function seedAnalysis(): Promise<void> {
  await saveStoryGraph(
    E2E_ROOT,
    E2E_ANALYSIS_ID,
    StoryGraphSchema.parse({
      schemaVersion: 1,
      projectId: E2E_ANALYSIS_ID,
      title: "E2E 分析面板样例",
      variables: [],
      nodes: [
        {
          id: "start",
          type: "start",
          title: "危机前夕",
          sceneDesc: "主角站在岔路口，前路未知。",
          dialogue: [
            { speaker: "主角", text: "我必须做出选择。", emotion: "坚定" },
            { speaker: "旁白", text: "空气中弥漫着紧张气息。", emotion: "紧张" },
          ],
          choices: [
            { id: "c1", text: "选择信任", targetNodeId: "good-end" },
            { id: "c2", text: "选择放弃", targetNodeId: "bad-end" },
          ],
        },
        {
          id: "good-end",
          type: "ending",
          title: "胜利结局",
          sceneDesc: "阳光照耀，一切圆满。",
          dialogue: [
            { speaker: "主角", text: "我们做到了！", emotion: "喜悦" },
          ],
          choices: [],
        },
        {
          id: "bad-end",
          type: "ending",
          title: "悲剧结局",
          sceneDesc: "黑暗笼罩，无力回天。",
          dialogue: [
            { speaker: "主角", text: "一切都结束了。", emotion: "绝望" },
          ],
          choices: [],
        },
        {
          // Intentional ISOLATED_NODE: no other node's choice points here.
          id: "orphan",
          type: "normal",
          title: "孤立节点",
          sceneDesc: "这个节点无法被任何路径到达。",
          dialogue: [],
          choices: [],
        },
      ],
      endings: [
        {
          id: "eg1",
          nodeId: "good-end",
          title: "信任得偿",
          type: "good",
          description: "主角选择信任，赢得了胜利。",
        },
        {
          id: "eb1",
          nodeId: "bad-end",
          title: "放弃的代价",
          type: "bad",
          description: "主角选择放弃，走向悲剧。",
        },
      ],
    }),
  );
}
