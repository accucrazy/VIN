'use client';

/**
 * VIN AIOS chat — minimal page.tsx wired to a local Ollama endpoint.
 *
 * This page deliberately bypasses the original the-pocket-pandora orchestrator
 * (Firebase auth, /api/ai/agent SSE, conversation persistence) and talks
 * directly to Ollama's native `/api/chat` (NDJSON stream) so the UI is usable
 * on a single machine with no backend.
 *
 * When you wire up a real VIN HTTP entry, swap `streamFromOllama` for the
 * SSE consumer that hits your endpoint and rebuilds Message / ToolCall events.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  ChatLayout,
  ChatHeader,
  CollapsibleSidebar,
  SidebarHeader,
  ConversationList,
  GeminiStyleInput,
  MessagesArea,
} from './chat/components';
import type { Message, ToolCall, ConversationListItem } from './chat/hooks/types';
import type { FileAttachment } from './chat/types';
import { parseMentions } from '@/lib/utils/mention-parser';

const OLLAMA_BASE = process.env.NEXT_PUBLIC_OLLAMA_BASE_URL ?? 'http://localhost:11434';
const DEFAULT_MODEL = process.env.NEXT_PUBLIC_OLLAMA_MODEL ?? 'qwen3.5:9b';
const MODEL_STORAGE_KEY = 'vin-chat-model';

type AgentId = 'vin' | 'researcher';

interface AgentSpec {
  id: AgentId;
  name: string;
  persona: string;
}

const AGENT_SPECS: Record<AgentId, AgentSpec> = {
  vin: {
    id: 'vin',
    name: 'Vin',
    persona: 'You are "Vin", a general-purpose orchestrator agent. Be direct and concise.',
  },
  researcher: {
    id: 'researcher',
    name: 'Researcher',
    persona: [
      'You are "Researcher", a focused research sub-agent.',
      'Always give a substantive answer in the user\'s language.',
      'Prefer concrete facts and short bullet points. If you are unsure about a detail, briefly note the uncertainty inside the answer, but never reply with only a disclaimer.',
    ].join(' '),
  },
};

function buildSystemPrompt(modelName: string, agent: AgentSpec): string {
  return [
    `You are an AI agent running inside VIN AIOS by The Pocket Company.`,
    `The underlying model you are running on is "${modelName}" (served locally via Ollama).`,
    `If the user asks which model / version / backend you are, answer truthfully with "${modelName}" served by Ollama.`,
    `Do NOT claim to be ChatGPT, Claude, Gemini, or any other product — answer based on the model name above.`,
    `Reply in the same language the user writes in.`,
    // Tool-use grounding: make the model TRUST and USE web_search results.
    `You have a web_search tool that returns LIVE results from the internet (titles, URLs, snippets).`,
    `When you receive web_search results, treat them as current, up-to-date information.`,
    `Read the snippets carefully and answer DIRECTLY using the concrete facts in them — including numbers such as stock prices, dates, and statistics — and cite the source name/URL.`,
    `Do NOT reply that you "lack real-time data" or "cannot access the internet" when search results are present; the results ARE your real-time data.`,
    `For stock/price questions, search with the entity's local-language name plus its ticker (e.g. "騰雲 6870 股價"), then quote the latest price found in the snippets.`,
    `Important entity alias: "TurnCloud", "Turn Cloud", and "騰雲科技" refer to Turn Cloud / 騰雲科技, Taiwan OTC ticker 6870 (6870.TWO). If the user asks about TurnCloud's stock price, search "騰雲科技 6870 股價".`,
    `TSpace is part of the Turn Cloud / The Pocket Company ecosystem in this project narrative.`,
    `Only say information is unavailable if the search results genuinely do not contain it.`,
    agent.persona,
  ].join(' ');
}

const EXAMPLE_QUESTIONS = [
  '介紹一下 VIN AIOS 的多 agent 架構',
  '搜尋一下 Taipei 101 有多高',
  '用一段 Python 寫一個排序函數',
  'accucrazy 肖準是什麼？',
];

// 🥚 Easter egg — accucrazy / 肖準
const EASTER_EGG_RE = /accucrazy|肖準|痟準/i;
const EASTER_EGG_ANSWER = [
  '🥚 **你發現彩蛋了！**',
  '',
  '**accucrazy = 肖準（台語）**',
  '',
  '- 「肖（痟）」= 瘋狂、狂熱 → **crazy**',
  '- 「準」= 精準、準確 → **accu**rate',
  '',
  '合起來就是「**又狂又準**」——瘋狂的執行力 ＋ 精準的判斷力。',
  '',
  '這正是 VIN AIOS 的精神：把最瘋狂的點子，準準地落地。⚡',
].join('\n');

const MAX_TOOL_ROUNDS = 4;

// Ollama native function-calling schema for the web_search tool.
const WEB_SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'web_search',
    description:
      'Search the web for a query and return {title, url, snippet} results. ' +
      'Use this whenever the user asks to search, or for current/factual info you are unsure about.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query string.' },
      },
      required: ['query'],
    },
  },
};

interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

function formatSearchForModel(query: string, results: SearchResultItem[]): string {
  if (!results.length) return `No results found for "${query}".`;
  return results
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
    .join('\n\n');
}

export default function HomePage() {
  // ============ Conversation state ============
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentToolCalls, setCurrentToolCalls] = useState<ToolCall[]>([]);
  const [activeAgents, setActiveAgents] = useState<string[]>([]);
  const [completedAgents, setCompletedAgents] = useState<string[]>([]);
  const [enabledAgents] = useState<string[]>(['vin', 'researcher']);

  // ============ UI state ============
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [conversations] = useState<ConversationListItem[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);

  // ============ Model state ============
  const [model, setModel] = useState<string>(DEFAULT_MODEL);
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  // ============ Refs ============
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ============ Sidebar persistence ============
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.innerWidth < 768) {
      setIsSidebarCollapsed(true);
      return;
    }
    const saved = localStorage.getItem('vin-chat-sidebar-collapsed');
    if (saved) setIsSidebarCollapsed(JSON.parse(saved));
  }, []);

  // ============ URL ?q=… prefill (deep-link to a question) ============
  // ?send=1 additionally auto-submits the prefilled question once.
  const [pendingAutoSend, setPendingAutoSend] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    if (q) {
      setInput(q);
      if (params.get('send') === '1') setPendingAutoSend(true);
    }
  }, []);

  // ============ Fetch available Ollama models (one-shot on mount) ============
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${OLLAMA_BASE}/api/tags`);
        if (!r.ok) return;
        const data = await r.json();
        const names: string[] = (data?.models ?? [])
          .map((m: any) => m?.name)
          .filter((n: unknown): n is string => typeof n === 'string')
          .sort();
        if (cancelled) return;
        setAvailableModels(names);

        // Pick a model: previously-saved → default if available → first
        const saved = typeof window !== 'undefined'
          ? localStorage.getItem(MODEL_STORAGE_KEY)
          : null;
        let initial = DEFAULT_MODEL;
        if (saved && names.includes(saved)) initial = saved;
        else if (names.includes(DEFAULT_MODEL)) initial = DEFAULT_MODEL;
        else if (names.length > 0) initial = names[0];
        setModel(initial);
      } catch {
        /* Ollama not reachable — leave defaults; will surface at send-time */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleModelChange = useCallback((next: string) => {
    setModel(next);
    try { localStorage.setItem(MODEL_STORAGE_KEY, next); } catch {}
  }, []);

  const toggleSidebar = useCallback(() => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem('vin-chat-sidebar-collapsed', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  // ============ Agentic turn: streaming /api/chat + native function calling ============
  // Loops: stream a round; if the model emits tool_calls, run them (surfacing each
  // call in the UI), feed results back, and continue until it answers in prose.
  const runAgentTurn = useCallback(
    async (
      history: Message[],
      userText: string,
      assistantMsgId: string,
      agent: AgentSpec,
    ) => {
      const controller = new AbortController();
      abortRef.current = controller;

      // Running transcript sent to Ollama (system + prior turns + this user turn).
      const convo: any[] = [
        { role: 'system', content: buildSystemPrompt(model, agent) },
        ...history
          .filter((m) => !m.status)
          .map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: userText },
      ];

      // Tool calls collected across rounds — drives both the in-bubble tool cards
      // and the header "Search" indicator (via setCurrentToolCalls).
      const collectedCalls: ToolCall[] = [];
      const syncCalls = () => {
        setCurrentToolCalls([...collectedCalls]);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId ? { ...m, toolCalls: [...collectedCalls] } : m,
          ),
        );
      };

      // One streaming round. Returns accumulated text + any tool_calls Ollama emitted.
      // useTools=false is the fallback for models without function-calling support.
      const streamRound = async (
        useTools: boolean,
      ): Promise<{ content: string; toolCalls: any[]; toolsUnsupported: boolean }> => {
        const r = await fetch(`${OLLAMA_BASE}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: convo,
            stream: true,
            think: false,
            ...(useTools ? { tools: [WEB_SEARCH_TOOL] } : {}),
          }),
          signal: controller.signal,
        });

        if (!r.ok || !r.body) {
          const errText = await r.text().catch(() => '');
          if (useTools && /tool|function/i.test(errText) && /support/i.test(errText)) {
            return { content: '', toolCalls: [], toolsUnsupported: true };
          }
          throw new Error(`Ollama HTTP ${r.status}: ${errText || 'unreachable'}`);
        }

        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let content = '';
        const toolCalls: any[] = [];

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const t = line.trim();
            if (!t) continue;
            try {
              const chunk = JSON.parse(t);
              const delta = chunk?.message?.content;
              if (delta) {
                content += delta;
                const snapshot = content;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, content: snapshot, chunks: [{ type: 'text', content: snapshot }] }
                      : m,
                  ),
                );
              }
              const tcs = chunk?.message?.tool_calls;
              if (Array.isArray(tcs)) toolCalls.push(...tcs);
            } catch {
              /* incomplete NDJSON frame — wait for more */
            }
          }
        }
        return { content, toolCalls, toolsUnsupported: false };
      };

      // Execute a single tool call and return text + the provider that served it.
      const execTool = async (
        name: string,
        args: any,
      ): Promise<{ output: string; provider?: string }> => {
        if (name === 'web_search') {
          const q = typeof args?.query === 'string' ? args.query : String(args?.query ?? '');
          const r = await fetch(`/api/web-search?q=${encodeURIComponent(q)}&n=5`);
          const j = await r.json().catch(() => ({ results: [] }));
          const results: SearchResultItem[] = j?.results ?? [];
          return { output: formatSearchForModel(q, results), provider: j?.provider };
        }
        return { output: `Unknown tool: ${name}` };
      };

      try {
        let useTools = true;
        let finalText = '';

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          const { content, toolCalls, toolsUnsupported } = await streamRound(useTools);

          if (toolsUnsupported) {
            // Model can't do function calling (e.g. gemma3) — redo without tools.
            useTools = false;
            round--;
            continue;
          }

          if (toolCalls.length === 0) {
            finalText = content;
            break;
          }

          // Any prose the model emitted in a tool-calling round is its reasoning,
          // not the final answer. Capture it as the call's "thought" and clear it
          // from the main bubble (the final round will fill the real answer).
          const reasoning = content.trim();
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId ? { ...m, content: '', chunks: [] } : m,
            ),
          );

          // Record the assistant's tool-calling turn in the transcript.
          convo.push({ role: 'assistant', content, tool_calls: toolCalls });

          for (let ti = 0; ti < toolCalls.length; ti++) {
            const tc = toolCalls[ti];
            const name = tc?.function?.name ?? 'unknown';
            let args = tc?.function?.arguments ?? {};
            if (typeof args === 'string') {
              try { args = JSON.parse(args); } catch { /* leave as string */ }
            }

            // Surface the call immediately (output null = "running").
            const call: ToolCall = {
              tool: name,
              input: args,
              output: null,
              // attach reasoning to the first call of the round only
              thought: ti === 0 && reasoning ? reasoning : undefined,
              timestamp: new Date().toISOString(),
              agentId: agent.id,
              agentName: agent.name,
            };
            collectedCalls.push(call);
            syncCalls();

            const startedAt = Date.now();
            const { output, provider } = await execTool(name, args);
            call.output = output;
            call.provider = provider;
            call.duration = Date.now() - startedAt;
            syncCalls();

            convo.push({ role: 'tool', content: output });
          }
          // loop again so the model can use the tool results
        }

        // Clear the in-flight indicator; completed tool cards stay on the bubble.
        setCurrentToolCalls([]);

        if (!finalText.trim()) {
          const hint = `_(模型 "${model}" 沒有回傳文字答案。可能它把全部內容放進了工具呼叫，或對這個 prompt 反應不佳。試試換個模型或換個問法。)_`;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, content: hint, chunks: [{ type: 'text', content: hint }] }
                : m,
            ),
          );
        }
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
        setCurrentToolCalls([]);
        const msg = `**Error**\n${e?.message || String(e)}`;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId ? { ...m, content: msg, chunks: [{ type: 'text', content: msg }] } : m,
          ),
        );
      }
    },
    [model],
  );

  // ============ Sending ============
  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    // Resolve target agent from @mention (first mention wins; default Vin).
    const parsed = parseMentions(text);
    const firstMention = parsed.mentions[0];
    const targetAgent: AgentSpec =
      firstMention && firstMention.agentId in AGENT_SPECS
        ? AGENT_SPECS[firstMention.agentId as AgentId]
        : AGENT_SPECS.vin;

    // If the user used @mention, strip it from the prompt body so the model
    // doesn't echo "@Researcher ..." back at the user.
    const promptText = parsed.hasMentions
      ? parsed.mentions.map((m) => m.task).join('\n\n') || parsed.rawMessage || text
      : text;

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date(),
    };
    const assistantMsg: Message = {
      id: `agent-${Date.now()}`,
      role: 'assistant',
      content: '',
      chunks: [],
      timestamp: new Date(),
      agentId: targetAgent.id,
      agentName: targetAgent.name,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
    setIsLoading(true);
    setActiveAgents([targetAgent.id]);
    setCompletedAgents((prev) => prev.filter((id) => id !== targetAgent.id));
    if (!conversationId) setConversationId(`conv-${Date.now()}`);

    try {
      if (EASTER_EGG_RE.test(text)) {
        // Easter egg: still do a *real* web search first (so the tool trace +
        // header indicator light up), then reveal the curated answer.
        const eggQuery = 'accucrazy 肖準 台語';
        const eggCall: ToolCall = {
          tool: 'web_search',
          input: { query: eggQuery },
          output: null,
          thought: '使用者問到「肖準 / accucrazy」，先上網查證一下再回答。',
          timestamp: new Date().toISOString(),
          agentId: targetAgent.id,
          agentName: targetAgent.name,
        };
        const syncEgg = () => {
          setCurrentToolCalls([{ ...eggCall }]);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id ? { ...m, toolCalls: [{ ...eggCall }] } : m,
            ),
          );
        };
        syncEgg();
        const startedAt = Date.now();
        try {
          const r = await fetch(`/api/web-search?q=${encodeURIComponent(eggQuery)}&n=5`);
          const j = await r.json().catch(() => ({ results: [] }));
          eggCall.output = formatSearchForModel(eggQuery, j?.results ?? []);
          eggCall.provider = j?.provider;
        } catch (e: any) {
          eggCall.output = `搜尋失敗：${e?.message || String(e)}`;
        }
        eggCall.duration = Date.now() - startedAt;
        syncEgg();
        setCurrentToolCalls([]);

        // Type the easter egg out char-by-char for a little flair.
        let acc = '';
        for (const ch of EASTER_EGG_ANSWER) {
          acc += ch;
          const snapshot = acc;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id
                ? { ...m, content: snapshot, chunks: [{ type: 'text', content: snapshot }] }
                : m,
            ),
          );
          await new Promise((r) => setTimeout(r, 12));
        }
      } else {
        await runAgentTurn(messages, promptText, assistantMsg.id, targetAgent);
      }
    } finally {
      setIsLoading(false);
      setActiveAgents([]);
      setCompletedAgents((prev) =>
        prev.includes(targetAgent.id) ? prev : [...prev, targetAgent.id],
      );
      abortRef.current = null;
    }
  }, [input, isLoading, messages, conversationId, runAgentTurn]);

  // Fire the one-shot ?send=1 auto-submit once input + model are ready.
  // autoSentRef guards against React Strict Mode's double effect invocation.
  const autoSentRef = useRef(false);
  useEffect(() => {
    if (pendingAutoSend && input.trim() && !isLoading && !autoSentRef.current) {
      autoSentRef.current = true;
      setPendingAutoSend(false);
      void sendMessage();
    }
  }, [pendingAutoSend, input, isLoading, sendMessage]);

  const startNewConversation = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setConversationId(null);
    setInput('');
  }, []);

  // ============ File attachments (UI only — Ollama upstream doesn't accept binary here) ============
  const handleFileSelect = useCallback(async () => {
    // File upload UI is wired but not sent through to Ollama (needs vision-capable
    // model + native binary support). Surface it explicitly instead of silently dropping.
    alert('File attachments aren\'t wired to Ollama in this demo. See VIN docs for vision-model setup.');
  }, []);
  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);
  const noopPaste = useCallback((_e: React.ClipboardEvent) => {}, []);
  const noopDrop = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragOver(false); }, []);
  const noopDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); }, []);
  const noopDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragOver(false); }, []);

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={() => { /* not wired */ }}
      />

      <ChatLayout
        sidebar={
          <CollapsibleSidebar isCollapsed={isSidebarCollapsed} onClose={toggleSidebar}>
            <SidebarHeader onNewChat={startNewConversation} onCollapse={toggleSidebar} />
            <ConversationList
              conversations={conversations}
              currentId={conversationId}
              isLoading={false}
              isLoadingMore={false}
              hasMore={false}
              onSelect={() => { /* persistence not wired */ }}
              onDelete={async () => { /* persistence not wired */ }}
              onLoadMore={async () => { /* persistence not wired */ }}
            />
          </CollapsibleSidebar>
        }
        header={
          <ChatHeader
            isSidebarCollapsed={isSidebarCollapsed}
            onExpandSidebar={toggleSidebar}
            isLoading={isLoading}
            currentToolCalls={currentToolCalls}
            activeAgents={activeAgents}
            completedAgents={completedAgents}
            enabledAgents={enabledAgents}
            model={model}
            availableModels={availableModels}
            onModelChange={handleModelChange}
          />
        }
        messages={
          <MessagesArea
            messages={messages}
            isLoading={isLoading}
            isDeepThinking={false}
            isReviewing={false}
            isReconnecting={false}
            reconnectProgress={null}
            currentToolCalls={currentToolCalls}
            currentAgentId={activeAgents[0]}
            currentAgentName={
              activeAgents[0] === 'researcher' ? 'Researcher'
              : activeAgents[0] === 'vin' ? 'Vin'
              : undefined
            }
            exampleQuestions={EXAMPLE_QUESTIONS}
            onExampleClick={(q) => setInput(q)}
          />
        }
        input={
          <GeminiStyleInput
            value={input}
            onChange={setInput}
            onSend={sendMessage}
            onFileSelect={handleFileSelect}
            onPaste={noopPaste}
            onDrop={noopDrop}
            onDragOver={noopDragOver}
            onDragLeave={noopDragLeave}
            isLoading={isLoading}
            isDragOver={isDragOver}
            attachments={attachments}
            onRemoveAttachment={removeAttachment}
          />
        }
      />
    </>
  );
}
