import { Command } from "commander";
import { StateManager, syncChapterWordCounts } from "@actalk/inkos-core";
import {
  formatChapterSyncChange,
  formatChapterSyncMissingFiles,
  formatChapterSyncNoChanges,
  formatChapterSyncSummary,
  resolveCliLanguage,
} from "../localization.js";
import { findProjectRoot, log, logError, resolveBookId } from "../utils.js";

export const chapterCommand = new Command("chapter")
  .description("Manage chapters");

chapterCommand
  .command("sync")
  .description("Recount chapter word counts from chapter files and update chapters/index.json")
  .argument("[book-id]", "Book ID (auto-detected if only one book)")
  .option("--json", "Output JSON")
  .action(async (bookIdArg: string | undefined, opts) => {
    try {
      const root = findProjectRoot();
      const bookId = await resolveBookId(bookIdArg, root);
      const state = new StateManager(root);
      const book = await state.loadBookConfig(bookId);
      const language = resolveCliLanguage(book.language);

      const result = await syncChapterWordCounts(state, bookId);

      if (opts.json) {
        log(JSON.stringify(result, null, 2));
        return;
      }

      if (result.changes.length === 0) {
        log(formatChapterSyncNoChanges(language, result.checkedChapters));
      } else {
        for (const change of result.changes) {
          log(formatChapterSyncChange(language, change, result.countingMode));
        }
        log(formatChapterSyncSummary(language, result.changes.length, result.checkedChapters));
      }
      if (result.missingChapterFiles.length > 0) {
        log(formatChapterSyncMissingFiles(language, result.missingChapterFiles));
      }
    } catch (e) {
      if (opts.json) {
        log(JSON.stringify({ error: String(e) }));
      } else {
        logError(`Failed to sync chapter word counts: ${e}`);
      }
      process.exit(1);
    }
  });
