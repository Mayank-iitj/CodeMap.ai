import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
} from "@/components/ai-elements/prompt-input";

export type TutorContext = { nodeId: string; nodeContext: string; linkContext: string; level: string } | null;

function Owl({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M4 5l3 2h10l3-2v9a8 8 0 0 1-16 0z" />
      <circle cx="9" cy="11" r="2" />
      <circle cx="15" cy="11" r="2" />
      <path d="M11 15l1 1.2 1-1.2" />
    </svg>
  );
}

export default function TutorChat({
  context,
  chips,
  onRemoveChip,
}: {
  context: TutorContext;
  chips: string[];
  onRemoveChip: (c: string) => void;
}) {
  const ctxRef = useRef(context);
  ctxRef.current = context;
  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/tutor", body: () => ({ context: ctxRef.current }) }),
    [],
  );
  const { messages, sendMessage, status, stop, error } = useChat({ transport });
  const [text, setText] = useState("");

  useEffect(() => {
    if (status === "error") console.error(error);
  }, [status, error]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Owl className="h-4 w-4" />
        </span>
        <div>
          <p className="font-display text-sm font-semibold">Socratic tutor</p>
          <p className="text-[11px] text-muted-foreground">Guides with questions — never hands you the answer</p>
        </div>
      </div>
      <Conversation className="min-h-0 flex-1">
        <ConversationContent className="gap-4 p-4">
          {messages.length === 0 ? (
            <ConversationEmptyState
              icon={<Owl className="h-8 w-8" />}
              title="Ask about the code"
              description="Pick a node on the map, then ask how it works or why it's connected."
            />
          ) : (
            messages.map((m) => (
              <Message key={m.id} from={m.role}>
                <MessageContent
                  className={
                    m.role === "user"
                      ? "group-[.is-user]:bg-primary group-[.is-user]:text-primary-foreground"
                      : "bg-transparent p-0 text-sm"
                  }
                >
                  {m.parts.map((p, i) =>
                    p.type === "text" ? (
                      m.role === "assistant" ? (
                        <MessageResponse key={i}>{p.text}</MessageResponse>
                      ) : (
                        <span key={i} className="whitespace-pre-wrap">{p.text}</span>
                      )
                    ) : null,
                  )}
                </MessageContent>
              </Message>
            ))
          )}
          {status === "submitted" && <p className="text-xs text-muted-foreground">Thinking…</p>}
          {error && <p className="text-xs text-destructive">{error.message || "The tutor couldn't respond."}</p>}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      <div className="border-t border-border p-3">
        {(context || chips.length > 0) && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {context && (
              <span className="rounded-full border border-primary/50 bg-primary/10 px-2 py-0.5 font-mono text-[11px] text-primary">
                @ {context.nodeId.split("::").pop()}
              </span>
            )}
            {chips.map((c) => (
              <button
                key={c}
                onClick={() => onRemoveChip(c)}
                className="rounded-full border border-border bg-muted px-2 py-0.5 font-mono text-[11px] hover:border-destructive"
                title="Remove"
              >
                {c} ×
              </button>
            ))}
          </div>
        )}
        <PromptInput
          onSubmit={({ text: t }) => {
            const body = [chips.join(" "), t.trim()].filter(Boolean).join("\n");
            if (!body) return;
            sendMessage({ text: body });
            setText("");
            chips.forEach(onRemoveChip);
          }}
        >
          <PromptInputTextarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={context ? "How does this piece fit in?" : "Select a node, then ask…"}
          />
          <PromptInputFooter className="justify-end">
            <PromptInputSubmit
              status={status}
              onClick={(e) => {
                if (status === "streaming" || status === "submitted") {
                  e.preventDefault();
                  stop();
                }
              }}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}
