import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const logMock = vi.fn();
const logErrorMock = vi.fn();
let projectRoot = "";

vi.mock("../utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils.js")>()),
  findProjectRoot: () => projectRoot,
  log: (message: string) => logMock(message),
  logError: (message: string) => logErrorMock(message),
}));

interface ChapterEntry {
  readonly number: number;
  readonly title: string;
  readonly status: string;
  readonly wordCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly auditIssues: ReadonlyArray<string>;
  readonly lengthWarnings: ReadonlyArray<string>;
}

function chapterEntry(number: number, title: string, wordCount: number): ChapterEntry {
  const now = new Date().toISOString();
  return {
    number,
    title,
    status: "ready-for-review",
    wordCount,
    createdAt: now,
    updatedAt: now,
    auditIssues: [],
    lengthWarnings: [],
  };
}

async function setupBook(params: {
  readonly bookId: string;
  readonly chapters: ReadonlyArray<{ readonly file: string; readonly content: string }>;
  readonly index: ReadonlyArray<ChapterEntry>;
}): Promise<string> {
  projectRoot = await mkdtemp(join(tmpdir(), "inkos-chapter-cmd-"));
  const bookDir = join(projectRoot, "books", params.bookId);
  await mkdir(join(bookDir, "chapters"), { recursive: true });
  await writeFile(
    join(bookDir, "book.json"),
    JSON.stringify({ id: params.bookId, title: params.bookId, language: "zh" }),
    "utf-8",
  );
  for (const chapter of params.chapters) {
    await writeFile(join(bookDir, "chapters", chapter.file), chapter.content, "utf-8");
  }
  await writeFile(join(bookDir, "chapters", "index.json"), JSON.stringify(params.index, null, 2), "utf-8");
  return bookDir;
}

describe("inkos chapter sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("recounts drifted chapters and prints JSON with --json", async () => {
    const bookDir = await setupBook({
      bookId: "driftbook",
      chapters: [
        // "风从码头吹进巷子。" → 9 chars after stripping heading + whitespace.
        { file: "0001_起风.md", content: "# 第1章 起风\n\n风从码头吹进巷子。" },
      ],
      index: [chapterEntry(1, "起风", 3000)],
    });

    const { chapterCommand } = await import("../commands/chapter.js");
    await chapterCommand.parseAsync(["node", "chapter", "sync", "driftbook", "--json"], { from: "node" });

    expect(logErrorMock).not.toHaveBeenCalled();
    const output = JSON.parse(logMock.mock.calls.at(-1)?.[0] as string) as {
      changes: ReadonlyArray<{ number: number; previousWordCount: number; wordCount: number }>;
    };
    expect(output.changes).toEqual([
      expect.objectContaining({ number: 1, previousWordCount: 3000, wordCount: 9 }),
    ]);

    const savedIndex = JSON.parse(await readFile(join(bookDir, "chapters", "index.json"), "utf-8")) as ChapterEntry[];
    expect(savedIndex[0]?.wordCount).toBe(9);
  });

  it("prints a bilingual summary when the index is already in sync", async () => {
    await setupBook({
      bookId: "steadybook",
      chapters: [{ file: "0001_起风.md", content: "# 第1章 起风\n\n风从码头吹进巷子。" }],
      index: [chapterEntry(1, "起风", 9)],
    });

    const { chapterCommand } = await import("../commands/chapter.js");
    await chapterCommand.parseAsync(["node", "chapter", "sync", "steadybook"], { from: "node" });

    expect(logErrorMock).not.toHaveBeenCalled();
    const printed = logMock.mock.calls.map((call) => call[0] as string).join("\n");
    expect(printed).toContain("无需修正");
  });
});
