import { useState, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Send,
  ThumbsUp,
  ThumbsDown,
  Edit2,
  Paperclip,
  Mic,
  RotateCw,
  Copy,
  Check,
  X,
  Loader2,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Code2,
  Sliders,
  Sparkles,
} from 'lucide-react';
import { SuggestionCard } from './Common';

// ── CodeBlock — rendered inside markdown for fenced code ─────
function CodeBlock({ language, children }) {
  const [copied, setCopied] = useState(false);
  const code = String(children).replace(/\n$/, '');

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group/code my-3 rounded-lg overflow-hidden border border-border-color">
      {/* Header bar */}
      <div className="flex items-center justify-between bg-[#1e1e2e] dark:bg-[#0d1117] px-4 py-1.5 text-xs">
        <span className="text-gray-400 flex items-center gap-1.5">
          <Code2 size={12} />
          {language || 'code'}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-gray-400 hover:text-white transition-colors"
        >
          {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
        </button>
      </div>
      {/* Code content */}
      <pre className="bg-[#1e1e2e] dark:bg-[#0d1117] px-4 py-3 overflow-x-auto text-sm leading-relaxed">
        <code className={`text-gray-200 ${language ? `language-${language}` : ''}`}>
          {code}
        </code>
      </pre>
    </div>
  );
}

// ── Markdown renderer with custom code blocks ────────────────
function formatReferences(text) {
  const marker = 'references';
  const idx = text.toLowerCase().indexOf(marker);
  if (idx === -1) return text;

  const before = text.slice(0, idx);
  const after = text.slice(idx + marker.length).replace(/^:\s*/i, '');
  const matches = [...after.matchAll(/\[(\d+)\]\s*([\s\S]*?)(?=\s*\[\d+\]|$)/g)];

  if (matches.length === 0) return text;

  const items = matches.map((match) => {
    const num = match[1];
    const body = match[2].replace(/\s+/g, ' ').trim();
    return `- [${num}] ${body}`;
  });

  return `${before}References\n${items.join('\n')}`.trimEnd();
}

function MarkdownContent({ text }) {
  const formatted = formatReferences(text);
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ inline, className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || '');
          if (!inline && (match || String(children).includes('\n'))) {
            return <CodeBlock language={match?.[1]}>{children}</CodeBlock>;
          }
          return (
            <code className="bg-black/10 dark:bg-white/10 px-1.5 py-0.5 rounded text-[13px] font-mono" {...props}>
              {children}
            </code>
          );
        },
        a({ href, children }) {
          return (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-sjsu-gold hover:underline inline-flex items-center gap-0.5">
              {children}<ExternalLink size={11} className="inline ml-0.5" />
            </a>
          );
        },
        p({ children }) {
          return <p className="mb-3 last:mb-0">{children}</p>;
        },
        ul({ children }) {
          return <ul className="list-disc ml-5 mb-3 space-y-1">{children}</ul>;
        },
        ol({ children }) {
          return <ol className="list-decimal ml-5 mb-3 space-y-1">{children}</ol>;
        },
        li({ children }) {
          return <li className="leading-relaxed">{children}</li>;
        },
        strong({ children }) {
          return <strong className="font-semibold">{children}</strong>;
        },
        blockquote({ children }) {
          return <blockquote className="border-l-3 border-sjsu-gold pl-4 italic text-text-secondary my-3">{children}</blockquote>;
        },
        h1({ children }) { return <h1 className="text-xl font-bold mb-2 mt-4">{children}</h1>; },
        h2({ children }) { return <h2 className="text-lg font-bold mb-2 mt-3">{children}</h2>; },
        h3({ children }) { return <h3 className="text-base font-semibold mb-1 mt-2">{children}</h3>; },
      }}
    >
      {formatted}
    </ReactMarkdown>
  );
}


// ── Main component ───────────────────────────────────────────
export default function MainChat({
  messages,
  input,
  setInput,
  handleSend,
  isTyping,
  messagesEndRef,
  selectedModel,
  setSelectedModel,
  hasMoreMessages,
  loadingMessages,
  onLoadOlderMessages,
  onRegenerate,
  onEditAndResubmit,
  onSuggestionClick,
  onFeedback,
  onBehaviorSettings,
  hasConversation,
  activeBehaviorScope,
}) {
  const chatContainerRef = useRef(null);

  // Scroll-to-load-older
  const handleChatScroll = useCallback(() => {
    const el = chatContainerRef.current;
    if (!el || !hasMoreMessages || loadingMessages) return;
    if (el.scrollTop < 80) {
      const prevHeight = el.scrollHeight;
      onLoadOlderMessages?.();
      requestAnimationFrame(() => {
        if (chatContainerRef.current) {
          chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight - prevHeight;
        }
      });
    }
  }, [hasMoreMessages, loadingMessages, onLoadOlderMessages]);

  // ── Edit state ────────────────────────────────────────────
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');

  const startEditing = (id, text) => { setEditingId(id); setEditText(text); };
  const cancelEditing = () => { setEditingId(null); setEditText(''); };
  const submitEdit = () => {
    if (editText.trim() && editText.trim() !== messages.find(m => m.id === editingId)?.text) {
      onEditAndResubmit?.(editingId, editText.trim());
    }
    setEditingId(null);
    setEditText('');
  };

  // ── Copy full response ────────────────────────────────────
  const [copiedMsgId, setCopiedMsgId] = useState(null);
  const copyResponse = async (msgId, text) => {
    await navigator.clipboard.writeText(text);
    setCopiedMsgId(msgId);
    setTimeout(() => setCopiedMsgId(null), 2000);
  };

  // ── Feedback state (thumbs) ───────────────────────────────
  const [feedback, setFeedback] = useState({}); // { [msgId]: 'up' | 'down' }
  const toggleFeedback = (msgId, type) => {
    setFeedback(prev => {
      const newType = prev[msgId] === type ? null : type;
      onFeedback?.(msgId, newType);
      return { ...prev, [msgId]: newType };
    });
  };

  // Check if a message is currently streaming (temp id, bot, last in list)
  const isStreaming = (msg) => {
    if (!isTyping || msg.sender !== 'bot') return false;
    const lastBot = [...messages].reverse().find(m => m.sender === 'bot');
    return lastBot?.id === msg.id;
  };

  // Is this the last bot message? (for showing regenerate)
  const isLastBot = (msg) => {
    if (msg.sender !== 'bot') return false;
    const lastBot = [...messages].reverse().find(m => m.sender === 'bot');
    return lastBot?.id === msg.id;
  };

  const handleSuggestionClick = (text) => {
    if (onSuggestionClick) {
      onSuggestionClick(text);
    } else {
      setInput(text);
    }
  };

  return (
    <main className="flex-1 flex flex-col relative bg-bg-main transition-colors duration-300 min-w-0">
      {/* Top Navigation */}
      <header className="flex items-center justify-between px-10 py-5 z-10 transition-colors duration-300">
        <div className="flex items-center gap-4 ml-auto">
          {hasConversation && (() => {
            const isConvo = activeBehaviorScope === 'conversation';
            const isProject = activeBehaviorScope === 'project';
            const isAuto = !isConvo && !isProject;
            const ScopeIcon = isAuto ? Sparkles : Sliders;
            return (
              <button
                onClick={onBehaviorSettings}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  isConvo
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500'
                    : isProject
                      ? 'bg-sjsu-gold/10 border-sjsu-gold/30 text-sjsu-gold'
                      : 'bg-violet-500/5 border-violet-500/20 text-violet-400 hover:bg-violet-500/10'
                }`}
                title={
                  isConvo ? 'Manual override active for this chat — click to edit'
                  : isProject ? 'Manual override active for this project — click to edit'
                  : 'Auto-adapted to your conversation — click to override'
                }
              >
                <ScopeIcon size={14} />
                <span className="hidden sm:inline">
                  {isConvo ? 'Chat Override' : isProject ? 'Project Override' : 'Auto'}
                </span>
              </button>
            );
          })()}
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="bg-bg-surface border border-border-color text-text-primary text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-sjsu-gold/30 cursor-pointer transition-colors"
          >
            <option value="8b">Fast</option>
            <option value="70b">Thinking</option>
          </select>
        </div>
      </header>

      {/* Chat Content */}
      <div
        ref={chatContainerRef}
        onScroll={handleChatScroll}
        className="flex-1 overflow-y-auto px-8 md:px-16 py-6 pb-40 scrollbar-hide"
      >
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center">
            <div className="relative text-center mb-12">
              <h1 className="text-7xl font-display font-bold text-text-primary/10 select-none pointer-events-none tracking-tighter leading-none transition-colors duration-300">
                SJSU <br /> COPILOT
              </h1>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-3xl">
              <SuggestionCard title="Degree Requirements" subtitle="What classes do I need to graduate?" onClick={() => handleSuggestionClick('What classes do I need to graduate?')} />
              <SuggestionCard title="Registration Dates" subtitle="When is the deadline for Spring 2026?" onClick={() => handleSuggestionClick('When is the deadline for Spring 2026?')} />
              <SuggestionCard title="Professor Office Hours" subtitle="Where can I find my professors?" onClick={() => handleSuggestionClick('Where can I find my professors?')} />
              <SuggestionCard title="Campus Dining" subtitle="What are the best places to eat near the SU?" onClick={() => handleSuggestionClick('nearby restaurants')} />
              <SuggestionCard title="Internship Opportunities" subtitle="Show me roles for Software Engineering" onClick={() => handleSuggestionClick('Show me roles for Software Engineering')} />
              <SuggestionCard title="Library Resources" subtitle="How do I book a private study room?" onClick={() => handleSuggestionClick('How do I book a private study room?')} />
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-8">
            {/* Load older indicator */}
            {loadingMessages && (
              <div className="flex justify-center py-3">
                <Loader2 size={18} className="animate-spin text-text-secondary" />
              </div>
            )}
            {hasMoreMessages && !loadingMessages && (
              <button
                onClick={onLoadOlderMessages}
                className="w-full text-center py-2 text-xs text-text-secondary hover:text-text-primary transition-colors"
              >
                Load older messages
              </button>
            )}

            <div className="flex items-center justify-between px-1 py-4">
              <h2 className="text-lg font-semibold text-text-primary">SJSU Academic Assistant</h2>
            </div>

            {/* ── Messages ────────────────────────────────── */}
            {messages.map((msg) => (
              <div key={msg.id} className={`flex flex-col mb-5 group ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}>

                {/* ── User message ──────────────────────── */}
                {msg.sender === 'user' ? (
                  <div className="flex flex-col items-end max-w-[80%]">
                    {editingId === msg.id ? (
                      <div className="w-full bg-[#f4f4f4] dark:bg-[#2f2f2f] rounded-[22px] p-2 border border-sjsu-gold/30">
                        <textarea
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitEdit(); }
                            if (e.key === 'Escape') cancelEditing();
                          }}
                          className="w-full bg-transparent text-text-primary px-3 py-2 focus:outline-none resize-none min-h-15"
                          autoFocus
                        />
                        <div className="flex justify-end gap-2 pt-1 pr-1">
                          <button onClick={cancelEditing} className="p-1.5 rounded-full hover:bg-white/10 text-text-secondary transition-colors">
                            <X size={16} />
                          </button>
                          <button
                            onClick={submitEdit}
                            className="p-1.5 rounded-full bg-sjsu-gold text-white hover:bg-sjsu-gold-hover transition-colors"
                            title="Submit edited message"
                          >
                            <Send size={16} />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-[#f4f4f4] dark:bg-[#2f2f2f] text-text-primary px-5 py-3.5 rounded-[20px] text-sm leading-relaxed relative group">
                        {msg.text}
                        <button
                          onClick={() => startEditing(msg.id, msg.text)}
                          className="absolute -left-10 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-2 hover:bg-bg-hover rounded-full transition-all text-text-secondary"
                          title="Edit & resubmit"
                        >
                          <Edit2 size={14} />
                        </button>
                      </div>
                    )}

                    {/* Branch navigation for user messages with versions */}
                    {msg.versions && msg.versions.length > 1 && (
                      <div className="flex items-center gap-1 mt-1 text-[11px] text-text-secondary">
                        <button
                          onClick={() => msg.onVersionChange?.(msg.versionIndex - 1)}
                          disabled={msg.versionIndex <= 0}
                          className="p-0.5 hover:bg-bg-hover rounded disabled:opacity-30 transition-colors"
                        >
                          <ChevronLeft size={12} />
                        </button>
                        <span>{msg.versionIndex + 1} / {msg.versions.length}</span>
                        <button
                          onClick={() => msg.onVersionChange?.(msg.versionIndex + 1)}
                          disabled={msg.versionIndex >= msg.versions.length - 1}
                          className="p-0.5 hover:bg-bg-hover rounded disabled:opacity-30 transition-colors"
                        >
                          <ChevronRight size={12} />
                        </button>
                      </div>
                    )}
                  </div>

                /* ── Bot message ──────────────────────────── */
                ) : (
                  <div className="w-full max-w-3xl pr-4">
                    {/* Markdown-rendered content */}
                    <div className="prose max-w-none text-text-primary leading-7 text-sm markdown-body">
                      <MarkdownContent text={msg.text} />
                      {/* Streaming cursor */}
                      {isStreaming(msg) && (
                        <span className="inline-block w-2 h-4 bg-sjsu-gold/80 rounded-sm animate-pulse ml-0.5 align-middle" />
                      )}
                    </div>

                    {/* Action buttons — only show when not streaming */}
                    {!isStreaming(msg) && msg.text && (
                      <div className="flex items-center gap-1 mt-2">
                        {/* Copy */}
                        <button
                          onClick={() => copyResponse(msg.id, msg.text)}
                          className="hover:bg-bg-hover p-1.5 rounded-md transition-colors text-text-secondary hover:text-text-primary"
                          title="Copy response"
                        >
                          {copiedMsgId === msg.id ? <Check size={15} className="text-green-500" /> : <Copy size={15} />}
                        </button>

                        {/* Regenerate — only on last bot message */}
                        {isLastBot(msg) && !msg.text.startsWith('**Error:**') && (
                          <button
                            onClick={() => onRegenerate?.()}
                            className="hover:bg-bg-hover p-1.5 rounded-md transition-colors text-text-secondary hover:text-text-primary"
                            title="Regenerate response"
                          >
                            <RotateCw size={15} />
                          </button>
                        )}

                        {/* Retry — only on error messages */}
                        {isLastBot(msg) && msg.text.startsWith('**Error:**') && (
                          <button
                            onClick={() => onRegenerate?.()}
                            className="hover:bg-bg-hover px-2.5 py-1 rounded-md transition-colors text-red-400 hover:text-red-300 text-xs font-medium flex items-center gap-1"
                            title="Retry"
                          >
                            <RotateCw size={13} /> Retry
                          </button>
                        )}

                        {/* Feedback */}
                        <button
                          onClick={() => toggleFeedback(msg.id, 'up')}
                          className={`hover:bg-bg-hover p-1.5 rounded-md transition-colors ${
                            feedback[msg.id] === 'up' ? 'text-green-500' : 'text-text-secondary hover:text-text-primary'
                          }`}
                          title="Good response"
                        >
                          <ThumbsUp size={15} fill={feedback[msg.id] === 'up' ? 'currentColor' : 'none'} />
                        </button>
                        <button
                          onClick={() => toggleFeedback(msg.id, 'down')}
                          className={`hover:bg-bg-hover p-1.5 rounded-md transition-colors ${
                            feedback[msg.id] === 'down' ? 'text-red-400' : 'text-text-secondary hover:text-text-primary'
                          }`}
                          title="Bad response"
                        >
                          <ThumbsDown size={15} fill={feedback[msg.id] === 'down' ? 'currentColor' : 'none'} />
                        </button>
                      </div>
                    )}

                    {/* Branch navigation for bot messages with versions */}
                    {msg.versions && msg.versions.length > 1 && (
                      <div className="flex items-center gap-1 mt-1 text-[11px] text-text-secondary">
                        <button
                          onClick={() => msg.onVersionChange?.(msg.versionIndex - 1)}
                          disabled={msg.versionIndex <= 0}
                          className="p-0.5 hover:bg-bg-hover rounded disabled:opacity-30 transition-colors"
                        >
                          <ChevronLeft size={12} />
                        </button>
                        <span>{msg.versionIndex + 1} / {msg.versions.length}</span>
                        <button
                          onClick={() => msg.onVersionChange?.(msg.versionIndex + 1)}
                          disabled={msg.versionIndex >= msg.versions.length - 1}
                          className="p-0.5 hover:bg-bg-hover rounded disabled:opacity-30 transition-colors"
                        >
                          <ChevronRight size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Typing indicator (shows when streaming hasn't started yet) */}
            {isTyping && !messages.some(m => isStreaming(m)) && (
              <div className="flex flex-col mb-4 items-start animate-fade-in">
                <div className="flex items-center space-x-2 h-7 px-3 text-text-secondary select-none">
                  <span className="text-sm font-medium animate-pulse italic">Thinking</span>
                  <div className="flex space-x-1 mt-1">
                    <div className="w-1.5 h-1.5 bg-[#E5A823] rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                    <div className="w-1.5 h-1.5 bg-[#E5A823] rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                    <div className="w-1.5 h-1.5 bg-[#E5A823] rounded-full animate-bounce"></div>
                  </div>
                </div>
              </div>
            )}

          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="absolute bottom-4 left-0 right-0 px-8 py-3 flex flex-col items-center bg-transparent z-20">
        <div className="w-full max-w-3xl relative">
          <div className="w-full bg-white dark:bg-bg-input border border-[#E5A823]/30 dark:border-border-color text-text-primary rounded-xl flex items-center shadow-sm transition-colors duration-300 focus-within:ring-2 focus-within:ring-[#E5A823]/20 dark:focus-within:ring-primary/20">
            <button className="pl-4 py-3.5 text-text-secondary hover:text-text-primary transition-colors">
              <Paperclip size={18} />
            </button>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
              className="flex-1 bg-transparent border-none text-sm text-text-primary pl-3 pr-14 py-3.5 focus:outline-none placeholder-text-secondary"
              placeholder="Send a message..."
            />
            <button className="absolute right-12 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary p-1.5 transition-colors">
              <Mic size={18} />
            </button>
            <button
              onClick={handleSend}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 bg-[#E5A823] hover:bg-[#c9921f] text-white p-1.5 rounded transition-colors"
              disabled={!input.trim()}
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
