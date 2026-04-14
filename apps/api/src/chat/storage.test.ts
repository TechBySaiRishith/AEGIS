// apps/api/src/chat/storage.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { sqlite } from "../db/connection.js";
import { createEvaluation } from "../db/queries.js";
import { insertChatMessage, listChatMessages, countChatMessages, insertChatUpload, getChatUpload } from "./storage.js";

describe("chat storage", () => {
  let evalId: string;
  beforeEach(() => {
    sqlite.exec("DELETE FROM chat_messages; DELETE FROM chat_uploads; DELETE FROM evaluations;");
    evalId = createEvaluation({ inputType: "text", sourceUrl: "x", applicationName: "x" }).id;
  });

  it("inserts and lists messages ordered by createdAt", () => {
    insertChatMessage({ id: "m1", evaluationId: evalId, role: "user", content: "hi", attachments: [], status: "complete", createdAt: 1 });
    insertChatMessage({ id: "m2", evaluationId: evalId, role: "assistant", content: "hello", attachments: [], status: "complete", createdAt: 2 });
    const list = listChatMessages(evalId);
    expect(list.map(m => m.id)).toEqual(["m1", "m2"]);
    expect(countChatMessages(evalId)).toBe(2);
  });

  it("persists upload metadata", () => {
    insertChatUpload({ id: "u1", evaluationId: evalId, originalName: "a.pdf", mime: "application/pdf", sizeBytes: 100, storagePath: "/tmp/a.pdf", createdAt: 1 });
    expect(getChatUpload("u1")?.originalName).toBe("a.pdf");
  });
});
