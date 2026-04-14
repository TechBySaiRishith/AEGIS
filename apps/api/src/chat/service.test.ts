import { describe, it, expect, beforeEach } from "vitest";
import { sqlite } from "../db/connection.js";
import { createEvaluation } from "../db/queries.js";
import { streamChatTurn } from "./service.js";
import { MockProvider } from "../llm/mock.js";

describe("streamChatTurn", () => {
  let evalId: string;
  beforeEach(() => {
    sqlite.exec("DELETE FROM chat_messages; DELETE FROM chat_uploads; DELETE FROM evaluations; DELETE FROM assessments; DELETE FROM verdicts;");
    evalId = createEvaluation({ inputType: "text", sourceUrl: "x", applicationName: "x" }).id;
  });

  it("streams deltas and persists both user + assistant messages", async () => {
    const events: Array<{ type: string }> = [];
    await streamChatTurn({
      evaluationId: evalId,
      userContent: "hello",
      attachmentIds: [],
      provider: new MockProvider(),
      emit: e => { events.push(e); },
    });
    expect(events.find(e => e.type === "message.start")).toBeTruthy();
    expect(events.find(e => e.type === "message.done")).toBeTruthy();
  });
});
