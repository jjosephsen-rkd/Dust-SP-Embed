'use client';

import React, { useState, useEffect, useRef } from 'react';

interface Message {
  id: string;
  type: 'user' | 'agent';
  content: string;
}

export default function DustChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const createConversation = async (userMessage: string) => {
    const response = await fetch('/api/conversation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: userMessage }),
    });

    const data = await response.json();
    return data.conversationId;
  };

  const sendMessage = async (convId: string, userMessage: string) => {
    await fetch('/api/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: convId, message: userMessage }),
    });
  };

  const streamEvents = (convId: string) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = new EventSource(`/api/events?conversationId=${convId}`);
    eventSourceRef.current = eventSource;

    let currentAgentMessage = '';
    let currentMessageId = '';

    eventSource.addEventListener('agent_message_new', (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      currentMessageId = data.messageId;
      currentAgentMessage = '';
    });

    eventSource.addEventListener('generation_tokens', (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      currentAgentMessage += data.text;

      setMessages((prev) => {
        const filtered = prev.filter((msg) => msg.id !== currentMessageId);
        return [
          ...filtered,
          {
            id: currentMessageId,
            type: 'agent',
            content: currentAgentMessage,
          },
        ];
      });
    });

    eventSource.addEventListener('agent_message_success', () => {
      setIsLoading(false);
      eventSource.close();
    });

    eventSource.addEventListener('agent_error', (e: MessageEvent) => {
      const data = JSON.parse(e.data);
      setError(`Agent error: ${data.error.message}`);
      setIsLoading(false);
      eventSource.close();
    });

    eventSource.onerror = () => {
      eventSource.close();
    };
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage = inputValue.trim();
    setInputValue('');
    setError(null);
    setIsLoading(true);

    const newUserMessage: Message = {
      id: `user-${Date.now()}`,
      type: 'user',
      content: userMessage,
    };
    setMessages((prev) => [...prev, newUserMessage]);

    try {
      if (!conversationId) {
        const newConversationId = await createConversation(userMessage);
        setConversationId(newConversationId);
        streamEvents(newConversationId);
      } else {
        await sendMessage(conversationId, userMessage);
        streamEvents(conversationId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setIsLoading(false);
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
              </div>
            </div>
          ))}

          {isLoading && messages[messages.length - 1]?.type === 'user' && (
            <div className="flex justify-start">
              <div className="bg-slate-100 text-slate-500 px-4 py-3 rounded-lg text-sm">
                Thinking...
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
