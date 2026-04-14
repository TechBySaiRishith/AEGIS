"use client";
import { useCallback, useState } from "react";
import type { ChatMessage, ChatSSEEvent } from "@aegis/shared";

const API = process.env.NEXT_PUBLIC_API_BASE ?? "";

export function useChatStream(evaluationId: string, onHistoryUpdate: (m: ChatMessage[]) => void) {
  const [streaming, setStreaming] = useState(false);

  const send = useCallback(async (content: string, attachmentIds: string[]) => {
    setStreaming(true);
    try {
      const res = await fetch(`${API}/api/evaluations/${evaluationId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ content, attachmentIds }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      const streamingMsg: ChatMessage = {
        id: "tmp", evaluationId, role: "assistant", content: "", attachments: [],
        status: "streaming", createdAt: Date.now(),
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const dataLine = frame.split("\n").find(l => l.startsWith("data:"));
          if (!dataLine) continue;
          const evt = JSON.parse(dataLine.slice(5).trim()) as ChatSSEEvent;
          if (evt.type === "message.start") streamingMsg.id = evt.messageId;
          if (evt.type === "message.delta") streamingMsg.content += evt.delta;
          if (evt.type === "message.done") streamingMsg.status = "complete";
          if (evt.type === "message.error") { streamingMsg.status = "error"; streamingMsg.errorMessage = evt.message; }
          onHistoryUpdate([streamingMsg]);
        }
      }
    } finally {
      setStreaming(false);
    }
  }, [evaluationId, onHistoryUpdate]);

  return { send, streaming };
}
