"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChatMessage } from "@aegis/shared";
import { fetchChatHistory } from "@/lib/chat";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";
import { SuggestedPrompts } from "./SuggestedPrompts";
import { useChatStream } from "./useChatStream";

export interface ChatDrawerProps {
  evaluationId: string;
  verdict?: string;
  open: boolean;
  onClose: () => void;
}

export function ChatDrawer({ evaluationId, verdict, open, onClose }: ChatDrawerProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");

  useEffect(() => { if (open) fetchChatHistory(evaluationId).then(setMessages).catch(() => {}); }, [open, evaluationId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const applyStreamingMessage = useCallback((partial: ChatMessage[]) => {
    setMessages(prev => {
      const streaming = partial[0];
      if (!streaming) return prev;
      const idx = prev.findIndex(m => m.id === streaming.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = streaming; return next; }
      return [...prev, streaming];
    });
  }, []);
  const { send, streaming } = useChatStream(evaluationId, applyStreamingMessage);

  const isEmpty = useMemo(() => messages.length === 0, [messages]);

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/60 transition-opacity ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={onClose}
      />
      <aside
        className={`fixed right-0 top-0 z-50 flex h-full w-full flex-col border-l border-white/10 bg-[rgba(9,9,11,0.96)] backdrop-blur-xl transition-transform duration-200 ease-out sm:w-[640px] lg:w-[720px] xl:w-[820px] ${open ? "translate-x-0" : "translate-x-full"}`}
        aria-hidden={!open}
      >
        <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <div className="text-sm font-semibold text-white">Ask AEGIS</div>
            <div className="text-xs text-white/50">
              Evaluation #{evaluationId.slice(0, 8)}{verdict ? ` · verdict: ${verdict}` : ""}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close chat" className="rounded-full p-2 text-white/70 hover:bg-white/10">✕</button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {isEmpty ? (
            <SuggestedPrompts onPick={p => setDraft(p)} />
          ) : (
            <MessageList messages={messages} streaming={streaming} />
          )}
        </div>

        <Composer
          evaluationId={evaluationId}
          draft={draft}
          onDraftChange={setDraft}
          streaming={streaming}
          onSubmit={async (content, attachmentIds, attachmentMeta) => {
            setDraft("");
            // Optimistically show the user message right away
            const optimistic: ChatMessage = {
              id: `tmp-user-${Date.now()}`,
              evaluationId,
              role: "user",
              content,
              attachments: attachmentMeta ?? [],
              status: "complete",
              createdAt: Date.now(),
            };
            setMessages((prev) => [...prev, optimistic]);
            await send(content, attachmentIds);
            // Reconcile with server state to replace the tmp user message with its persisted row
            fetchChatHistory(evaluationId).then(setMessages).catch(() => {});
          }}
        />
      </aside>
    </>
  );
}
