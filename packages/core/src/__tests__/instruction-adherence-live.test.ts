import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildAgentSystemPrompt, type AgentSystemPromptOptions } from "../agent/agent-system-prompt.js";
import type { SessionKind } from "../interaction/session.js";
import { getServiceApiKey } from "../llm/secrets.js";
import { loadLLMEnvLayers } from "../utils/llm-env.js";

type ToolName =
  | "propose_action"
  | "sub_agent"
  | "short_fiction_run"
  | "generate_cover"
  | "play_start"
  | "play_step"
  | "read"
  | "write_truth_file"
  | "rename_entity"
  | "patch_chapter_text"
  | "grep"
  | "ls";

interface LiveCase {
  readonly name: string;
  readonly language: "zh" | "en";
  readonly sessionKind: SessionKind;
  readonly bookId: string | null;
  readonly options?: AgentSystemPromptOptions;
  readonly user: string;
  readonly tools: readonly ToolName[];
  readonly expectedTools?: readonly ToolName[];
  readonly forbiddenTools?: readonly ToolName[];
  readonly expectedArgs?: Record<string, Record<string, unknown>>;
  readonly requireNoTool?: boolean;
}

interface ToolCallResult {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

interface CaseReport {
  readonly name: string;
  readonly ok: boolean;
  readonly toolCalls: readonly ToolCallResult[];
  readonly content: string;
  readonly error?: string;
}

const enabled = process.env.INKOS_LIVE_E2E === "1";
const reportRows: CaseReport[] = [];

let liveConfig: { apiKey: string; baseUrl: string; model: string };
const liveMaxTokens = Number.parseInt(process.env.KKAIAPI_MAX_TOKENS ?? "2048", 10);

const CASES: readonly LiveCase[] = [
  {
    name: "chat discussion stays conversational",
    language: "zh",
    sessionKind: "chat",
    bookId: null,
    user: "我想先了解一下 InkOS 的能力，不要创建任何文件。你能做什么？",
    tools: ["propose_action"],
    requireNoTool: true,
  },
  {
    name: "chat book request proposes create_book",
    language: "zh",
    sessionKind: "chat",
    bookId: null,
    user: "我想创建一本长篇书，书名《雾城验尸官》，都市悬疑，平台番茄，第一人称，主角是法医，核心冲突是他发现每个案子都和十年前自己的失踪案有关。先给我确认。",
    tools: ["propose_action"],
    expectedTools: ["propose_action"],
    expectedArgs: { propose_action: { action: "create_book" } },
  },
  {
    name: "book-create free text proposes instead of running architect",
    language: "zh",
    sessionKind: "book-create",
    bookId: null,
    user: "书名《雨夜债主》，都市现实悬疑，平台番茄，200章，每章3000字，第一人称。主角是替人讨债的茶馆老板，核心冲突是他发现所有债务背后都指向同一家医院。先确认建书方案。",
    tools: ["propose_action"],
    expectedTools: ["propose_action"],
    expectedArgs: { propose_action: { action: "create_book" } },
    forbiddenTools: ["sub_agent"],
  },
  {
    name: "confirmed book-create runs architect",
    language: "zh",
    sessionKind: "book-create",
    bookId: null,
    options: { actionSource: "button", requestedIntent: "create_book" },
    user: "确认创建《雨夜债主》：都市现实悬疑，平台番茄，200章，每章3000字，第一人称。主角是替人讨债的茶馆老板，核心冲突是每一笔债务背后都指向同一家医院，第一阶段从落魄医生的讨债单切入。",
    tools: ["sub_agent"],
    expectedTools: ["sub_agent"],
    expectedArgs: { sub_agent: { agent: "architect" } },
  },
  {
    name: "short request proposes short_run",
    language: "zh",
    sessionKind: "short",
    bookId: null,
    user: "我要做一篇现言女频短篇，12章，主角离婚当天发现车机常用地址暴露丈夫另一个家庭，核心是证据反杀和财产回收。先给我确认。",
    tools: ["propose_action"],
    expectedTools: ["propose_action"],
    expectedArgs: { propose_action: { action: "short_run" } },
    forbiddenTools: ["short_fiction_run"],
  },
  {
    name: "confirmed short runs short_fiction_run",
    language: "zh",
    sessionKind: "short",
    bookId: null,
    options: { actionSource: "button", requestedIntent: "short_run" },
    user: "确认生成现言女频短篇：12章，暂定名《第187次导航》。主角离婚当天发现车机常用地址暴露丈夫另一个家庭，核心是证据反杀和财产回收，封面方向是女主冷笑看导航屏。",
    tools: ["short_fiction_run"],
    expectedTools: ["short_fiction_run"],
  },
  {
    name: "cover request proposes generate_cover",
    language: "zh",
    sessionKind: "short",
    bookId: null,
    user: "只给 shorts/第187次导航/final 重新做封面，人物要冷笑，手机导航地址做大符号。",
    tools: ["propose_action"],
    expectedTools: ["propose_action"],
    expectedArgs: { propose_action: { action: "generate_cover" } },
    forbiddenTools: ["generate_cover"],
  },
  {
    name: "play new world proposes play_start",
    language: "zh",
    sessionKind: "play",
    bookId: null,
    options: { playWorldExists: false },
    user: "开一个赛博酒馆互动世界，玩家是失忆调酒师，起始地点是雨夜地下酒吧，核心冲突是每杯酒都会暴露一个客人的秘密。先确认。",
    tools: ["propose_action"],
    expectedTools: ["propose_action"],
    expectedArgs: { propose_action: { action: "play_start" } },
    forbiddenTools: ["play_start", "play_step"],
  },
  {
    name: "confirmed play start runs play_start",
    language: "zh",
    sessionKind: "play",
    bookId: null,
    options: { actionSource: "button", requestedIntent: "play_start", playWorldExists: false },
    user: "确认启动赛博酒馆互动世界：玩家是失忆调酒师，起始地点是雨夜地下酒吧，压力是每调一杯酒都会暴露客人的秘密并牵动自己的记忆，核心冲突是玩家要在套取情报和暴露自己之间选择。",
    tools: ["play_start"],
    expectedTools: ["play_start"],
  },
  {
    name: "active play advances with play_step",
    language: "zh",
    sessionKind: "play",
    bookId: null,
    options: { playWorldExists: true },
    user: "我压低帽檐，先观察吧台后面那个一直擦杯子的男人。",
    tools: ["play_step"],
    expectedTools: ["play_step"],
  },
  {
    name: "active play exit does not call play_step",
    language: "zh",
    sessionKind: "play",
    bookId: null,
    options: { playWorldExists: true },
    user: "我先退出互动模式，别继续剧情，我们讨论一下这个世界观怎么改。",
    tools: ["play_step"],
    requireNoTool: true,
  },
  {
    name: "book discussion does not write",
    language: "zh",
    sessionKind: "book",
    bookId: "demo-book",
    user: "我想讨论下一章要不要改成第一人称，先别写，也别改文件，只给判断。",
    tools: ["sub_agent", "generate_cover", "read", "write_truth_file", "rename_entity", "patch_chapter_text", "grep", "ls"],
    forbiddenTools: ["sub_agent", "generate_cover", "write_truth_file", "rename_entity", "patch_chapter_text"],
  },
  {
    name: "book write-next uses writer",
    language: "zh",
    sessionKind: "book",
    bookId: "demo-book",
    user: "写下一章。",
    tools: ["sub_agent", "generate_cover", "read", "write_truth_file", "rename_entity", "patch_chapter_text", "grep", "ls"],
    expectedTools: ["sub_agent"],
    expectedArgs: { sub_agent: { agent: "writer" } },
  },
  {
    name: "book rewrite chapter uses reviser not writer",
    language: "zh",
    sessionKind: "book",
    bookId: "demo-book",
    user: "重写第3章，保留设定但增强压迫感。",
    tools: ["sub_agent", "generate_cover", "read", "write_truth_file", "rename_entity", "patch_chapter_text", "grep", "ls"],
    expectedTools: ["sub_agent"],
    expectedArgs: { sub_agent: { agent: "reviser", chapterNumber: 3 } },
  },
];

function toolSchema(name: ToolName): Record<string, unknown> {
  const base = (description: string, properties: Record<string, unknown>, required: string[] = []) => ({
    type: "function",
    function: {
      name,
      description,
      parameters: { type: "object", properties, required },
    },
  });

  if (name === "propose_action") {
    return base("Ask the user to confirm a production action before executing it.", {
      action: { type: "string", enum: ["create_book", "short_run", "play_start", "generate_cover"] },
      instruction: { type: "string" },
      title: { type: "string" },
      summary: { type: "string" },
    }, ["action", "instruction"]);
  }

  if (name === "sub_agent") {
    return base("Delegate a long-form book task to an InkOS sub-agent.", {
      agent: { type: "string", enum: ["architect", "writer", "auditor", "reviser", "exporter"] },
      instruction: { type: "string" },
      title: { type: "string" },
      chapterNumber: { type: "number" },
      chapterWordCount: { type: "number" },
      mode: { type: "string", enum: ["spot-fix", "polish", "rewrite", "rework", "anti-detect"] },
    }, ["agent", "instruction"]);
  }

  if (name === "short_fiction_run") {
    return base("Generate a standalone InkOS Short package.", {
      direction: { type: "string" },
      title: { type: "string" },
      chapters: { type: "number" },
    }, ["direction"]);
  }

  if (name === "generate_cover") {
    return base("Generate or regenerate a cover image and cover prompt.", {
      targetPath: { type: "string" },
      title: { type: "string" },
      instruction: { type: "string" },
    }, ["instruction"]);
  }

  if (name === "play_start") {
    return base("Start a new InkOS Play interactive world.", {
      title: { type: "string" },
      premise: { type: "string" },
      initialScene: { type: "string" },
      suggestedActions: { type: "array", items: { type: "string" } },
    }, ["title", "premise", "initialScene"]);
  }

  if (name === "play_step") {
    return base("Advance an active InkOS Play world by one user action.", {
      action: { type: "string" },
    }, ["action"]);
  }

  const textArg = name === "patch_chapter_text"
    ? {
        chapterNumber: { type: "number" },
        oldText: { type: "string" },
        newText: { type: "string" },
      }
    : name === "rename_entity"
      ? { oldName: { type: "string" }, newName: { type: "string" } }
      : name === "write_truth_file"
        ? { path: { type: "string" }, content: { type: "string" } }
        : { query: { type: "string" }, path: { type: "string" } };
  return base(`InkOS deterministic ${name} tool.`, textArg);
}

async function resolveLiveConfig(): Promise<{ apiKey: string; baseUrl: string; model: string }> {
  const root = process.cwd();
  await loadLLMEnvLayers(root);
  const testProjectKey = await getServiceApiKey(join(root, "test-project"), "kkaiapi");
  const rootProjectKey = await getServiceApiKey(root, "kkaiapi");
  const envBaseUrl = process.env.INKOS_LLM_BASE_URL ?? "";
  const envKeyOnlyIfKkai = envBaseUrl.includes("kkaiapi.com") ? process.env.INKOS_LLM_API_KEY : undefined;
  const apiKey = process.env.KKAIAPI_API_KEY
    ?? process.env.INKOS_KKAIAPI_API_KEY
    ?? testProjectKey
    ?? rootProjectKey
    ?? envKeyOnlyIfKkai;
  if (!apiKey) {
    throw new Error("Missing kkaiapi key. Set KKAIAPI_API_KEY or save kkaiapi in test-project/.inkos/secrets.json.");
  }

  return {
    apiKey,
    baseUrl: process.env.KKAIAPI_BASE_URL ?? "https://api.kkaiapi.com/v1",
    model: process.env.KKAIAPI_MODEL ?? "deepseek-v4-flash",
  };
}

async function runCase(testCase: LiveCase): Promise<CaseReport> {
  const prompt = buildAgentSystemPrompt(testCase.bookId, testCase.language, testCase.sessionKind, testCase.options);
  const response = await fetch(`${liveConfig.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${liveConfig.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: liveConfig.model,
      temperature: 0,
      max_tokens: liveMaxTokens,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: testCase.user },
      ],
      tools: testCase.tools.map(toolSchema),
      tool_choice: "auto",
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    return {
      name: testCase.name,
      ok: false,
      toolCalls: [],
      content: "",
      error: `HTTP ${response.status}: ${text.slice(0, 800)}`,
    };
  }

  const json = JSON.parse(text) as {
    choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }>;
  };
  const message = json.choices?.[0]?.message;
  const toolCalls = (message?.tool_calls ?? []).map((call) => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.function?.arguments || "{}") as Record<string, unknown>;
    } catch {
      args = { __raw: call.function?.arguments ?? "" };
    }
    return { name: call.function?.name ?? "", args };
  });

  const error = validateCase(testCase, toolCalls);
  return {
    name: testCase.name,
    ok: !error,
    toolCalls,
    content: message?.content ?? "",
    error,
  };
}

function validateCase(testCase: LiveCase, toolCalls: readonly ToolCallResult[]): string | undefined {
  const names = toolCalls.map((tool) => tool.name);
  if (testCase.requireNoTool && names.length > 0) {
    return `expected no tool calls, got ${names.join(", ")}`;
  }
  for (const expected of testCase.expectedTools ?? []) {
    if (!names.includes(expected)) return `missing expected tool ${expected}; got ${names.join(", ") || "(none)"}`;
  }
  for (const forbidden of testCase.forbiddenTools ?? []) {
    if (names.includes(forbidden)) return `called forbidden tool ${forbidden}`;
  }
  for (const [toolName, expectedArgs] of Object.entries(testCase.expectedArgs ?? {})) {
    const tool = toolCalls.find((call) => call.name === toolName);
    if (!tool) return `missing tool ${toolName} for expected args`;
    for (const [key, value] of Object.entries(expectedArgs)) {
      if (tool.args[key] !== value) {
        return `tool ${toolName}.${key} expected ${JSON.stringify(value)}, got ${JSON.stringify(tool.args[key])}`;
      }
    }
  }
  return undefined;
}

const liveDescribe = enabled ? describe : describe.skip;

liveDescribe("live kkaiapi instruction adherence benchmark", () => {
  beforeAll(async () => {
    liveConfig = await resolveLiveConfig();
  }, 10_000);

  afterAll(async () => {
    if (!liveConfig) return;
    const dir = process.env.INKOS_LIVE_E2E_REPORT_DIR ?? join(process.cwd(), "tmp", "live-e2e");
    await mkdir(dir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    await writeFile(
      join(dir, `instruction-adherence-${timestamp}.json`),
      JSON.stringify({
        baseUrl: liveConfig.baseUrl,
        model: liveConfig.model,
        cases: reportRows,
        passed: reportRows.filter((row) => row.ok).length,
        failed: reportRows.filter((row) => !row.ok).length,
      }, null, 2),
      "utf-8",
    );
  });

  it.each(CASES)("$name", async (testCase) => {
    const result = await runCase(testCase);
    reportRows.push(result);
    expect(result.ok, result.error ?? "case failed").toBe(true);
  }, 45_000);
});
