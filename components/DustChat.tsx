'use client';

import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Strip Dust citation tags like :cite[abc] or :cite[abc,:cite[def]]
function stripCitations(text: string): string {
  return text.replace(/:cite\[[^\]]*\]/g, '');
}

interface Message {
  id: string;
  type: 'user' | 'agent';
  content: string;
  thinking?: string;      // chain-of-thought text while streaming
  streaming?: boolean;
}

interface DustChatProps {
  agentId?: string;
  title?: string;
  subtitle?: string;
  compact?: boolean;
  headerImage?: string;
  headerImageAlt?: string;
}

export default function DustChat({ agentId, title = 'Dust Agent Chat', subtitle = 'AI-powered assistance', compact = false, headerImage, headerImageAlt = '' }: DustChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  /**
   * Creates a new conversation with the first user message.
   * Returns both conversationId and the user messageId needed for event streaming.
   */
  const createConversation = async (userMessage: string) => {
    const res = await fetch('/api/conversation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: userMessage, agentId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
    return { conversationId: data.conversationId, messageId: data.messageId };
  };

  /**
   * Posts a follow-up message to an existing conversation.
   * Returns the user messageId needed for event streaming.
   */
  const postMessage = async (convId: string, userMessage: string) => {
    const res = await fetch('/api/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: convId, message: userMessage, agentId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`);
    return data.messageId as string;
  };

  /**
   * Streams agent response events for a given conversation + user message.
   * Dust SSE format: each line is "data: {json}" where json.type identifies the event.
   */
  const streamEvents = async (convId: string, userMsgId: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const res = await fetch(
      `/api/events?conversationId=${convId}&messageId=${userMsgId}`,
      { signal: controller.signal }
    );

    if (!res.ok || !res.body) {
      throw new Error(`Events stream failed (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let agentMessageId = '';
    let agentContent = '';

    // Ensure the agent bubble exists for a given messageId
    const ensureBubble = (msgId: string) => {
      if (agentMessageId !== msgId) {
        agentMessageId = msgId;
        agentContent = '';
        setMessages((prev) => {
          if (prev.some((m) => m.id === msgId)) return prev;
          return [...prev, { id: msgId, type: 'agent' as const, content: '', streaming: true }];
        });
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;

        const raw = line.slice(5).trim();
        if (!raw || raw === '[DONE]') continue;

        let event: Record<string, unknown>;
        try {
          event = JSON.parse(raw);
        } catch {
          continue;
        }

        const type = event.type as string;
        // Most events carry messageId at top level
        const eventMsgId = event.messageId as string | undefined;

        if (type === 'agent_message_new') {
          const msg = event.message as Record<string, unknown> | undefined;
          const id = (msg?.sId ?? eventMsgId ?? `agent-${Date.now()}`) as string;
          ensureBubble(id);
        } else if (type === 'generation_tokens') {
          // Create the bubble on first token if agent_message_new wasn't received
          if (eventMsgId) ensureBubble(eventMsgId);

          const id = agentMessageId;
          if (event.classification === 'chain_of_thought' && event.text) {
            // Stream thinking text into the thinking field
            const thinkingDelta = event.text as string;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === id
                  ? { ...m, thinking: (m.thinking ?? '') + thinkingDelta, streaming: true }
                  : m
              )
            );
          } else if (event.classification === 'tokens' && event.text) {
            // Real answer tokens — accumulate and clear thinking display
            agentContent += event.text as string;
            const content = agentContent;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === id ? { ...m, content, thinking: undefined, streaming: true } : m
              )
            );
          }
        } else if (type === 'agent_message_success') {
          const msg = event.message as Record<string, unknown> | undefined;
          // Use final content from success event; fall back to accumulated tokens
          const finalContent = (msg?.content as string | null) ?? agentContent;
          const successId = (msg?.sId as string | undefined) ?? agentMessageId;

          if (successId) ensureBubble(successId);

          setMessages((prev) =>
            prev.map((m) =>
              m.id === successId ? { ...m, content: finalContent ?? '', streaming: false } : m
            )
          );
          setIsLoading(false);
          return;
        } else if (type === 'agent_error' || type === 'user_message_error') {
          const err = event.error as Record<string, unknown> | undefined;
          setError((err?.message as string) ?? 'Agent error');
          setMessages((prev) =>
            prev.map((m) => (m.streaming ? { ...m, streaming: false } : m))
          );
          setIsLoading(false);
          return;
        }
      }
    }

    // Stream ended without a success event — mark done and show what we have
    setMessages((prev) => prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)));
    setIsLoading(false);
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage = inputValue.trim();
    setInputValue('');
    setError(null);
    setIsLoading(true);

    setMessages((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, type: 'user', content: userMessage },
    ]);

    try {
      if (!conversationId) {
        const { conversationId: newConvId, messageId } = await createConversation(userMessage);
        setConversationId(newConvId);
        await streamEvents(newConvId, messageId);
      } else {
        const messageId = await postMessage(conversationId, userMessage);
        await streamEvents(conversationId, messageId);
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError(err instanceof Error ? err.message : 'An error occurred');
        setIsLoading(false);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className={compact ? 'w-full h-screen flex flex-col' : 'w-full h-screen flex items-center justify-center p-4'}>
      <div className={compact ? 'bg-white w-full h-full flex flex-col' : 'bg-white rounded-xl shadow-lg w-full max-w-4xl h-[90vh] max-h-[800px] flex flex-col'}>
        {/* Header */}
        <div className={`border-b border-slate-200 flex items-center gap-3 ${compact ? 'px-4 py-3' : 'p-6'}`}>
          {headerImage && (
            <img
              src={headerImage}
              alt={headerImageAlt}
              className={compact ? 'h-12 w-12 object-contain flex-shrink-0' : 'h-16 w-16 object-contain flex-shrink-0'}
            />
          )}
          <div>
            <h1 className={`font-semibold text-slate-900 ${compact ? 'text-lg' : 'text-2xl'}`}>{title}</h1>
            <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>
          </div>
        </div>

        {/* Messages */}
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.length === 0 && (
            <div className="flex items-center justify-center h-full text-center text-slate-400">
              <div>
                <p className="text-lg font-medium mb-2">Start a conversation</p>
                <p className="text-sm">Send a message to begin chatting with your AI agent</p>
              </div>
            </div>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`px-4 py-3 rounded-lg text-sm ${
                  message.type === 'user'
                    ? 'max-w-[70%] bg-blue-600 text-white'
                    : 'max-w-[85%] bg-slate-100 text-slate-900'
                }`}
              >
                {message.type === 'user' ? (
                  message.content
                ) : (
                  <div>
                    {/* Thinking section — visible only while chain-of-thought is streaming */}
                    {message.thinking !== undefined && (
                      <div className="mb-3 rounded-md bg-slate-200/60 px-3 py-2 text-xs text-slate-500 italic border-l-2 border-slate-300">
                        <span className="not-italic font-medium text-slate-400 block mb-1">Thinking…</span>
                        {message.thinking}
                        <span className="inline-block w-[2px] h-[0.9em] bg-slate-400 ml-0.5 align-middle animate-pulse" />
                      </div>
                    )}

                    {/* Final answer */}
                    {message.content ? (
                      <div className="prose prose-sm max-w-none prose-table:text-sm prose-td:py-1 prose-th:py-1">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {stripCitations(message.content)}
                        </ReactMarkdown>
                        {message.streaming && (
                          <span className="inline-block w-[2px] h-[1em] bg-slate-500 ml-0.5 align-middle animate-pulse" />
                        )}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Bouncing dots while waiting for agent_message_new */}
          {isLoading && (messages.length === 0 || messages[messages.length - 1]?.type === 'user') && (
            <div className="flex justify-start">
              <div className="bg-slate-100 px-4 py-3 rounded-lg flex gap-1 items-center">
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          )}

          {error && (
            <div className="flex justify-center">
              <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg max-w-md border border-red-200">
                <p className="font-medium text-sm">Error</p>
                <p className="text-sm">{error}</p>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t border-slate-200">
          <div className="flex gap-3">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your message..."
              disabled={isLoading}
              className="flex-1 px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
            />
            <button
              onClick={handleSendMessage}
              disabled={!inputValue.trim() || isLoading}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? '...' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
