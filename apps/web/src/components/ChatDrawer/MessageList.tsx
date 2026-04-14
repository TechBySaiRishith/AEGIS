"use client";
import { useEffect, useRef } from "react";
import type { ChatMessage } from "@aegis/shared";
import { MessageBubble } from "./MessageBubble";
import { TypingIndicator } from "./TypingIndicator";

export function MessageList({ messages, streaming }: { messages: ChatMessage[]; streaming: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" }); }, [messages.length, streaming]);

  const lastAssistantStreaming = streaming && messages[messages.length - 1]?.role === "assistant" && !messages[messages.length - 1]?.content;

  return (
    <div ref={ref} className="py-3">
      {messages.map(m => <MessageBubble key={m.id} message={m} />)}
      {lastAssistantStreaming && <TypingIndicator />}
    </div>
  );
}
