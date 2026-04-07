'use client';

import React, { useState, useEffect, useRef } from 'react';

interface Message {
  id: string;
  type: 'user' | 'agent';
  content: string;
  streaming?: boolean;
}

export default function DustChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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
      body: JSON.stringify({ message: userMessage }),
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
      body: JSON.stringify({ conversationId: convId, message: userMessage }),
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

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
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

        if (type === 'agent_message_new') {
          // Agent is starting a response — create a placeholder message
          const msg = event.message as Record<string, unknown>;
          agentMessageId = (msg?.sId ?? `agent-${Date.now()}`) as string;
          agentContent = '';
          setMessages((prev) => [
            ...prev,
            { id: agentMessageId, type: 'agent', content: '', streaming: true },
          ]);
        } else if (type === 'generation_tokens') {
          // Only show actual response tokens, not chain-of-thought
          if (event.classification === 'tokens' && event.text) {
            agentContent += event.text as string;
            const id = agentMessageId;
            const content = agentContent;
            setMessages((prev) =>
              prev.map((m) => (m.id === id ? { ...m, content, streaming: true } : m))
            );
          }
        } else if (type === 'agent_message_success') {
          // Use the final content from the success event as source of truth
          const msg = event.message as Record<string, unknown>;
          const finalContent = (msg?.content as string) ?? agentContent;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === agentMessageId
                ? { ...m, content: finalContent, streaming: false }
                : m
            )
          );
          setIsLoading(false);
          return;
        } else if (type === 'agent_error' || type === 'user_message_error') {
          const err = event.error as Record<string, unknown>;
          setError((err?.message as string) ?? 'Agent error');
          setMessages((prev) =>
            prev.map((m) => (m.id === agentMessageId ? { ...m, streaming: false } : m))
          );
          setIsLoading(false);
          return;
        }
      }
    }

    // Stream ended — mark any in-progress message as done
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
    <div className="w-full h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-lg w-full max-w-4xl h-[90vh] max-h-[800px] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-slate-200">
          <h1 className="text-2xl font-semibold text-slate-900">Dust Agent Chat</h1>
          <p className="text-sm text-slate-500 mt-1">AI-powered assistance</p>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
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
                className={`max-w-[70%] px-4 py-3 rounded-lg text-sm whitespace-pre-wrap ${
                  message.type === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-900'
                }`}
              >
                {message.content}
                {message.streaming && (
                  <span className="inline-block w-[2px] h-[1em] bg-slate-500 ml-0.5 align-middle animate-pulse" />
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
