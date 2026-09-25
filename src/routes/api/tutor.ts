import { createFileRoute } from "@tanstack/react-router";
import { createOpenAI } from "@ai-sdk/openai";
import { convertToModelMessages, streamText, type UIMessage } from "ai";

type Ctx = {
  nodeId: string;
  nodeContext: string;
  linkContext: string;
  level: string;
} | null;

const system = (c: Ctx) => `You are the CodeMap.AI Socratic Engineering Tutor. Your core purpose is to guide computer science students through code comprehension without providing raw code solutions or immediate answers.

RULES:
1. NEVER output a refactored code block, solution snippet, or direct answer to a functional debugging request.
2. Formulate your response as a progressive, multi-step dialogue. Ask targeted questions that prompt the student to trace execution paths themselves.
3. Use the injected Codebase Context to guide them accurately based on actual system structure.
4. Frame code architecture conceptually. Use clear, real-world structural analogies (e.g., comparing routers to traffic controllers).
Keep replies short (under ~180 words), end with 1-2 guiding questions, and adapt vocabulary to the student level.

INJECTED CONTEXT:
Target Component: ${c?.nodeId ?? "(none selected — ask the student to pick a node on the map if needed)"}
Component Source & Meta: ${c?.nodeContext ?? "n/a"}
Adjacent Link Pathways: ${c?.linkContext ?? "n/a"}
Student Level: ${c?.level ?? "Intermediate"}`;

export const Route = createFileRoute("/api/tutor")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env['LOVABLE_API_KEY'];
        if (!apiKey) return new Response("AI is not configured.", { status: 500 });
        const { messages, context } = (await request.json()) as { messages: UIMessage[]; context: Ctx };
        const provider = createOpenAI({
          baseURL: "https://ai.gateway.lovable.dev/v1",
          apiKey,
          headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
        });
        const result = streamText({
          model: provider.responses("openai/gpt-6-astra"),
          system: system(context),
          messages: await convertToModelMessages(messages),
          abortSignal: request.signal,
          providerOptions: {
            openai: {
              forceReasoning: true,
              reasoningEffort: "low",
              reasoningSummary: "auto",
              store: false,
              include: ["reasoning.encrypted_content"],
            },
          },
        });
        return result.toUIMessageStreamResponse({
          onError: (e) => {
            const msg = e instanceof Error ? e.message : String(e);
            if (/402|credit/i.test(msg)) return "AI credits are used up. Add credits in Settings → Plans & credits.";
            if (/429|rate/i.test(msg)) return "The tutor is busy right now — try again in a moment.";
            return "The tutor couldn't respond. Please try again.";
          },
        });
      },
    },
  },
});
