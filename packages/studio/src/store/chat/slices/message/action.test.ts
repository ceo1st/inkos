import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createStore } from "zustand/vanilla";
import type { ChatStore } from "../../types";
import { initialChatState } from "../../initialState";
import { createCreateSlice } from "../create/action";
import { createMessageSlice } from "./action";

const { fetchJson } = vi.hoisted(() => ({
  fetchJson: vi.fn(),
}));

vi.mock("../../../../hooks/use-api", () => ({ fetchJson }));

class FakeEventSource {
  readonly url: string;
  readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  constructor(url: string) {
    this.url = url;
    fakeEventSources.push(this);
  }
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const current = this.listeners.get(type) ?? [];
    current.push(listener);
    this.listeners.set(type, current);
  }
  close() {}
  emit(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(data) } as MessageEvent);
    }
  }
}

const fakeEventSources: FakeEventSource[] = [];

function createTestStore() {
  return createStore<ChatStore>()((...args) => ({
    ...initialChatState,
    ...createMessageSlice(...args),
    ...createCreateSlice(...args),
  }));
}

describe("chat message actions", () => {
  const originalEventSource = globalThis.EventSource;

  beforeEach(() => {
    fetchJson.mockReset();
    fetchJson.mockResolvedValue({});
    fakeEventSources.length = 0;
    (globalThis as any).EventSource = FakeEventSource;
  });

  afterEach(() => {
    (globalThis as any).EventSource = originalEventSource;
  });

  it("keeps play mode local for draft sessions until the first message persists them", () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "play", "open");

    store.getState().setSessionPlayMode(sessionId, "guided");

    expect(store.getState().sessions[sessionId]?.playMode).toBe("guided");
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("syncs the created book id returned by /agent back into the current runtime session", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "book-create");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");
    fetchJson
      .mockResolvedValueOnce({ session: { sessionId, bookId: null, sessionKind: "book-create" } })
      .mockResolvedValueOnce({
        response: "已创建书籍。",
        session: { sessionId, activeBookId: "new-book", sessionKind: "book" },
      });

    await store.getState().sendMessage(sessionId, "创建一本债务悬疑长篇", { sessionKind: "book-create" });

    expect(store.getState().sessions[sessionId]).toMatchObject({
      bookId: "new-book",
      sessionKind: "book",
      isDraft: false,
    });
    expect(store.getState().sessionIdsByBook["new-book"]).toContain(sessionId);
  });

  it("sends the session-bound book id when no explicit activeBookId option is provided", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession("harbor-book", "book");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");
    store.getState().setSelectedModel("MiniMax-M2.7", "minimax");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");
    fetchJson
      .mockResolvedValueOnce({ session: { sessionId, bookId: "harbor-book", sessionKind: "book" } })
      .mockResolvedValueOnce({
        response: "ok",
        session: { sessionId, activeBookId: "harbor-book", sessionKind: "book" },
      });

    await store.getState().sendMessage(sessionId, "审第 1 章");

    const agentCall = fetchJson.mock.calls.find(([path]) => path === "/agent");
    expect(agentCall).toBeDefined();
    const body = JSON.parse((agentCall?.[1] as { body: string }).body);
    expect(body.activeBookId).toBe("harbor-book");
    expect(body.sessionKind).toBe("book");
    expect(body.service).toBe("kkaiapi");
    expect(body.model).toBe("deepseek-v4-flash");
  });

  it("parses @skill directives into requestedSkills and strips them from the agent instruction", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "play", "open");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");
    fetchJson
      .mockResolvedValueOnce({ session: { sessionId, bookId: null, sessionKind: "play" } })
      .mockResolvedValueOnce({
        response: "ok",
        session: { sessionId, bookId: null, sessionKind: "play" },
      });

    await store.getState().sendMessage(sessionId, "@open-world-play 做一个魔兽风开放世界", {
      sessionKind: "play",
    });

    const agentCall = fetchJson.mock.calls.find(([path]) => path === "/agent");
    expect(agentCall).toBeDefined();
    const body = JSON.parse((agentCall?.[1] as { body: string }).body);
    expect(body.instruction).toBe("做一个魔兽风开放世界");
    expect(body.requestedSkills).toEqual(["open-world-play"]);
  });

  it("keeps a tool-only stream when /agent returns an empty response after a proposal", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "book-create");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");

    let resolveAgent!: (value: unknown) => void;
    fetchJson
      .mockResolvedValueOnce({ session: { sessionId, bookId: null, sessionKind: "book-create" } })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveAgent = resolve;
      }));

    const sent = store.getState().sendMessage(sessionId, "创建一本债务悬疑长篇", { sessionKind: "book-create" });
    await vi.waitFor(() => expect(fakeEventSources).toHaveLength(1));

    fakeEventSources[0].emit("tool:start", {
      sessionId,
      id: "proposal-1",
      tool: "propose_action",
    });
    fakeEventSources[0].emit("tool:end", {
      sessionId,
      id: "proposal-1",
      tool: "propose_action",
      details: {
        kind: "proposed_action",
        action: "create_book",
        targetSessionKind: "book-create",
        sameSession: true,
        title: "确认建书",
        instruction: "创建一本债务悬疑长篇",
      },
    });

    resolveAgent({ response: "", session: { sessionId, sessionKind: "book-create" } });
    await sent;

    const messages = store.getState().sessions[sessionId]?.messages ?? [];
    const assistant = messages.find((message) => message.role === "assistant");
    expect(assistant?.content).not.toContain("模型未返回文本内容");
    expect(assistant?.parts).toEqual([
      expect.objectContaining({
        type: "tool",
        execution: expect.objectContaining({
          tool: "propose_action",
          status: "completed",
        }),
      }),
    ]);
  });

  it("restores confirmed proposal cards when loading persisted session messages", () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "play", "open");

    store.getState().loadSessionMessages(sessionId, [
      {
        role: "assistant",
        content: "",
        timestamp: 1,
        toolExecutions: [
          {
            id: "proposal-1",
            tool: "propose_action",
            label: "确认动作",
            status: "completed",
            startedAt: 1,
            details: {
              kind: "proposed_action",
              action: "play_start",
              targetSessionKind: "play",
              instruction: "启动旧影院",
            },
          },
        ],
      },
      {
        role: "assistant",
        content: "",
        timestamp: 2,
        toolExecutions: [
          {
            id: "play-1",
            tool: "play_start",
            label: "启动互动世界",
            status: "completed",
            startedAt: 2,
            details: { kind: "play_world_started" },
          },
        ],
      },
    ]);

    expect(store.getState().resolvedProposals).toEqual({ "proposal-1": "confirmed" });
  });

  it("does not replace an active local stream while session detail is loading", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "short");
    const stream = new FakeEventSource(`/api/v1/events?sessionId=${sessionId}`);
    store.setState((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: {
          ...state.sessions[sessionId]!,
          isDraft: false,
          isStreaming: true,
          stream: stream as unknown as EventSource,
        },
      },
    }));
    fetchJson.mockClear();

    await store.getState().loadSessionDetail(sessionId);

    expect(fetchJson).not.toHaveBeenCalled();
    expect(store.getState().sessions[sessionId]).toMatchObject({
      isStreaming: true,
      stream,
    });
  });

  it("restores and reconnects a running production task when session detail reloads", async () => {
    const store = createTestStore();
    fetchJson.mockResolvedValueOnce({
      session: { sessionId: "short-session-1", bookId: null, sessionKind: "short", title: "雨夜账本" },
    });
    const sessionId = await store.getState().createSession(null, "short");
    fetchJson.mockResolvedValueOnce({
      session: {
        sessionId,
        bookId: null,
        sessionKind: "short",
        title: "雨夜账本",
        messages: [],
      },
      task: {
        version: 1,
        sessionId,
        requestedIntent: "short_run",
        updatedAt: 20,
        execution: {
          id: "short-task-1",
          tool: "short_fiction_run",
          label: "生成短篇",
          status: "running",
          startedAt: 10,
          logs: ["正在生成大纲"],
        },
      },
    });

    await store.getState().loadSessionDetail(sessionId);

    expect(store.getState().sessions[sessionId]).toMatchObject({ isStreaming: true });
    expect(store.getState().sessions[sessionId]?.messages[0]?.toolExecutions?.[0]).toMatchObject({
      id: "short-task-1",
      status: "running",
      logs: ["正在生成大纲"],
    });
    expect(fakeEventSources).toHaveLength(1);
    expect(fakeEventSources[0]?.url).toBe(`/api/v1/events?sessionId=${encodeURIComponent(sessionId)}`);

    fakeEventSources[0]?.emit("task:snapshot", {
      version: 1,
      sessionId,
      requestedIntent: "short_run",
      updatedAt: 30,
      execution: {
        id: "short-task-1",
        tool: "short_fiction_run",
        label: "生成短篇",
        status: "completed",
        startedAt: 10,
        completedAt: 30,
        result: "短篇已完成",
      },
    });

    expect(store.getState().sessions[sessionId]).toMatchObject({ isStreaming: false, stream: null });
    expect(store.getState().sessions[sessionId]?.messages).toHaveLength(1);
    expect(store.getState().sessions[sessionId]?.messages[0]?.toolExecutions?.[0]).toMatchObject({
      id: "short-task-1",
      status: "completed",
      result: "短篇已完成",
    });
  });

  it("marks the active tool card as stopped without requiring a refresh", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "short");
    store.getState().loadSessionMessages(sessionId, [{
      role: "assistant",
      content: "",
      timestamp: 10,
      toolExecutions: [{
        id: "short-task-1",
        tool: "short_fiction_run",
        label: "短篇生产",
        status: "running",
        startedAt: 10,
      }],
    }]);

    await store.getState().abortSession(sessionId);

    expect(store.getState().sessions[sessionId]?.messages[0]?.toolExecutions?.[0]).toMatchObject({
      status: "error",
      error: "已由用户停止",
      completedAt: expect.any(Number),
    });
    expect(fetchJson).toHaveBeenCalledWith(`/sessions/${sessionId}/abort`, { method: "POST" });
  });

  it("keeps one stopped task card when the aborted agent request later rejects", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "short");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");

    let rejectAgent!: (error: Error) => void;
    fetchJson
      .mockResolvedValueOnce({ session: { sessionId, bookId: null, sessionKind: "short" } })
      .mockImplementationOnce(() => new Promise((_resolve, reject) => {
        rejectAgent = reject;
      }))
      .mockResolvedValueOnce({});

    const sent = store.getState().sendMessage(sessionId, "确认生成短篇", { sessionKind: "short" });
    await vi.waitFor(() => expect(fakeEventSources).toHaveLength(1));
    fakeEventSources[0]?.emit("task:snapshot", {
      sessionId,
      execution: {
        id: "short-task-1",
        tool: "short_fiction_run",
        label: "短篇生产",
        status: "running",
        startedAt: 1_100,
      },
    });

    now.mockReturnValue(2_000);
    await store.getState().abortSession(sessionId);
    rejectAgent(new Error("This operation was aborted"));
    await sent;

    const taskExecutions = (store.getState().sessions[sessionId]?.messages ?? [])
      .flatMap((message) => message.toolExecutions ?? [])
      .filter((execution) => execution.id === "short-task-1");
    expect(taskExecutions).toEqual([
      expect.objectContaining({
        status: "error",
        error: "已由用户停止",
      }),
    ]);
    expect(store.getState().sessions[sessionId]?.messages).not.toContainEqual(
      expect.objectContaining({ content: expect.stringContaining("This operation was aborted") }),
    );
    now.mockRestore();
  });
});
