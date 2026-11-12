import { parentPort } from "node:worker_threads";
import { findMentions, mentionText } from "../shared/mentions";
import { parseSearch, searchDocuments, type SearchDocument } from "../shared/search";
import type { NoteData } from "../shared/types";
parentPort!.on(
  "message",
  (message: {
    documents: SearchDocument[];
    query: string;
    kind?: string;
    notes?: NoteData[];
    names?: string[];
    own?: NoteData;
    targets?: { name: string; path: string }[];
    limit?: number;
  }) => {
    try {
      if (message.kind === "mentions-incoming") {
        const results = [];
        for (const note of message.notes || []) {
          results.push(
            ...findMentions(
              note.content,
              message.names || [],
              (message.limit || 500) - results.length,
            ).map((match) => ({ ...match, path: note.path, revision: note.revision })),
          );
          if (results.length >= (message.limit || 500)) break;
        }
        parentPort!.postMessage({ results });
        return;
      }
      if (message.kind === "mentions-outgoing" && message.own) {
        const own = message.own,
          masked = mentionText(own.content),
          targets = message.targets || [],
          byName = new Map(
            targets.map((entry) => [entry.name.toLocaleLowerCase(), entry.path]),
          );
        let matches: {
            from: number;
            to: number;
            text: string;
            line: number;
            context: string;
            target: string;
          }[] = [],
          truncated = false;
        for (let offset = 0; offset < targets.length; offset += 500) {
          const batch = findMentions(
            own.content,
            targets.slice(offset, offset + 500).map((entry) => entry.name),
            1000,
            masked,
          );
          matches.push(
            ...batch.map((match) => ({
              ...match,
              target: byName.get(match.text.toLocaleLowerCase())!,
            })),
          );
          if (matches.length > 2000) {
            truncated = true;
            matches.sort((a, b) => a.from - b.from || b.to - a.to);
            matches = matches.slice(0, 1000);
          }
        }
        matches.sort((a, b) => a.from - b.from || b.to - a.to);
        const results = [];
        let end = -1;
        for (const match of matches)
          if (match.from >= end) {
            results.push({ ...match, path: own.path, revision: own.revision });
            end = match.to;
          }
        parentPort!.postMessage({
          results: {
            matches: results.slice(0, 500),
            truncated: truncated || results.length > 500,
          },
        });
        return;
      }
      const { documents, query } = message;
      const expression = parseSearch(query);
      parentPort!.postMessage({
        results: expression ? searchDocuments(documents, expression) : [],
      });
    } catch (error: any) {
      parentPort!.postMessage({ error: error.message });
    }
  },
);
