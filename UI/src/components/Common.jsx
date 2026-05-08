import { useState, useRef, useEffect } from 'react';
import { MessageSquare, Link as LinkIcon, Pencil, Trash2, Check, X, ChevronRight, ChevronDown, FolderOpen, Plus, ArrowRightFromLine, ArrowRightToLine, Sliders } from 'lucide-react';

export function SuggestionCard({ title, subtitle, onClick }) {
    return (
        <button onClick={onClick} className="bg-bg-surface hover:bg-bg-hover border border-border-color px-5 py-5 rounded-xl text-left transition-colors h-24 flex flex-col justify-center shadow-sm w-full">
            <h4 className="font-semibold text-text-primary text-sm mb-1">{title}</h4>
            <p className="text-xs text-text-secondary leading-snug">{subtitle}</p>
        </button>
    );
}

export function FollowUpChip({ text }) {
    return (
        <button className="bg-transparent hover:bg-bg-hover text-text-primary border border-border-color px-4 py-2 rounded-full text-xs font-medium transition-colors">
            {text}
        </button>
    );
}

export function LinkItem({ label, href, isFirst = false }) {
    const Wrapper = href ? 'a' : 'div';
    return (
        <Wrapper
            {...(href ? { href, target: '_blank', rel: 'noreferrer' } : {})}
            className={`flex items-center justify-between px-4 py-3.5 bg-bg-surface hover:bg-bg-hover transition-colors cursor-pointer group ${!isFirst ? 'border-t border-border-color' : ''}`}
        >
            <span className="text-sm underline text-text-primary font-medium group-hover:text-black dark:group-hover:text-white">
                {label}
            </span>
            <LinkIcon size={14} className="text-sjsu-gold group-hover:text-black dark:group-hover:text-white" />
        </Wrapper>
    );
}

export function SidebarToolItem({ icon, label, active = false, onClick }) {
    return (
        <button
            onClick={onClick}
            className={`w-full flex items-center gap-3 px-2 py-2 rounded-lg cursor-pointer transition-colors group ${
                active ? 'bg-white/15' : 'hover:bg-white/10'
            }`}
        >
            <div className={`transition-colors ${active ? 'text-white' : 'text-sidebar-text-muted group-hover:text-white'}`}>
                {icon}
            </div>
            <span className="text-sm text-sidebar-text-main font-medium">{label}</span>
        </button>
    );
}

export function HistoryItem({ id, title, preview, active, onClick, onRename, onDelete, projects = [], onMoveToProject }) {
    const [renaming, setRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState(title || '');
    const [showProjectPicker, setShowProjectPicker] = useState(false);
    const inputRef = useRef(null);

    useEffect(() => {
        if (renaming) inputRef.current?.focus();
    }, [renaming]);

    const submitRename = () => {
        const trimmed = renameValue.trim();
        if (trimmed && trimmed !== title) onRename?.(id, trimmed);
        setRenaming(false);
    };

    const displayTitle = title || preview || 'New Chat';

    return (
        <li
            onClick={() => !renaming && !showProjectPicker && onClick?.(id)}
            className={`flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition-all group relative overflow-hidden ${
                active ? 'bg-white/15' : 'hover:bg-white/10'
            }`}
        >
            <MessageSquare size={14} className="text-sidebar-text-muted shrink-0" />

            {renaming ? (
                /* ── Rename input ── */
                <div className="flex items-center gap-1 min-w-0 flex-1" onClick={(e) => e.stopPropagation()}>
                    <input
                        ref={inputRef}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') submitRename();
                            if (e.key === 'Escape') setRenaming(false);
                        }}
                        className="bg-white/10 text-white text-sm rounded px-1.5 py-0.5 w-full focus:outline-none focus:ring-1 focus:ring-sjsu-gold/50"
                    />
                    <button onClick={submitRename} className="shrink-0 p-1 rounded hover:bg-white/10 text-green-400 hover:text-green-300 transition-colors" title="Save">
                        <Check size={13} />
                    </button>
                    <button onClick={() => setRenaming(false)} className="shrink-0 p-1 rounded hover:bg-white/10 text-sidebar-text-muted hover:text-white transition-colors" title="Cancel">
                        <X size={13} />
                    </button>
                </div>
            ) : (
                <>
                    {/* Title */}
                    <div className="min-w-0 flex-1">
                        <span className="truncate block text-sm">{displayTitle}</span>
                    </div>

                    {/* Action icons — visible on hover */}
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" onClick={(e) => e.stopPropagation()}>
                        {projects.length > 0 && (
                            <div className="relative">
                                <button
                                    onClick={() => setShowProjectPicker(v => !v)}
                                    className="p-1.5 rounded-md hover:bg-white/15 text-sidebar-text-muted hover:text-sjsu-gold transition-colors"
                                    title="Move to project"
                                >
                                    <ArrowRightToLine size={13} />
                                </button>
                                {showProjectPicker && (
                                    <div className="absolute left-0 top-full mt-1 bg-[#1e293b] border border-white/10 rounded-lg shadow-xl py-1 z-20 min-w-[140px]">
                                        {projects.map((p) => (
                                            <button
                                                key={p.id}
                                                onClick={() => { onMoveToProject?.(id, p.id); setShowProjectPicker(false); }}
                                                className="w-full text-left px-3 py-1.5 text-xs text-white hover:bg-white/10 transition-colors truncate"
                                            >
                                                {p.name}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                        <button
                            onClick={() => { setRenameValue(title || ''); setRenaming(true); }}
                            className="p-1.5 rounded-md hover:bg-white/15 text-sidebar-text-muted hover:text-white transition-colors"
                            title="Rename"
                        >
                            <Pencil size={13} />
                        </button>
                        <button
                            onClick={() => onDelete?.(id)}
                            className="p-1.5 rounded-md hover:bg-red-500/20 text-sidebar-text-muted hover:text-red-400 transition-colors"
                            title="Delete"
                        >
                            <Trash2 size={13} />
                        </button>
                    </div>

                    {/* Gradient fade — hides on hover when icons appear */}
                    <div className="absolute right-0 top-0 bottom-0 w-12 bg-linear-to-l from-bg-sidebar via-bg-sidebar/80 to-transparent pointer-events-none group-hover:opacity-0 transition-opacity" />
                </>
            )}
        </li>
    );
}

// ── Project Item (collapsible group in sidebar) ────────────────────────

export function ProjectItem({
    id,
    name,
    conversations = [],
    expanded,
    onToggle,
    currentConversationId,
    onSelectConversation,
    onRenameProject,
    onDeleteProject,
    onNewChatInProject,
    onRenameConversation,
    onDeleteConversation,
    onRemoveFromProject,
    onBehaviorSettings,
}) {
    const [renaming, setRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState(name || '');
    const inputRef = useRef(null);

    useEffect(() => {
        if (renaming) inputRef.current?.focus();
    }, [renaming]);

    const submitRename = () => {
        const trimmed = renameValue.trim();
        if (trimmed && trimmed !== name) onRenameProject?.(id, trimmed);
        setRenaming(false);
    };

    return (
        <li className="mb-1">
            {/* Project header row */}
            <div
                onClick={() => !renaming && onToggle?.(id)}
                className="flex items-center gap-1.5 px-2 py-2 rounded-lg cursor-pointer transition-all group relative hover:bg-white/10"
            >
                <FolderOpen size={14} className="text-sjsu-gold shrink-0" />

                {renaming ? (
                    <div className="flex items-center gap-1 min-w-0 flex-1" onClick={(e) => e.stopPropagation()}>
                        <input
                            ref={inputRef}
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') submitRename();
                                if (e.key === 'Escape') setRenaming(false);
                            }}
                            className="bg-white/10 text-white text-sm rounded px-1.5 py-0.5 w-full focus:outline-none focus:ring-1 focus:ring-sjsu-gold/50"
                        />
                        <button onClick={submitRename} className="shrink-0 p-1 rounded hover:bg-white/10 text-green-400" title="Save">
                            <Check size={13} />
                        </button>
                        <button onClick={() => setRenaming(false)} className="shrink-0 p-1 rounded hover:bg-white/10 text-sidebar-text-muted" title="Cancel">
                            <X size={13} />
                        </button>
                    </div>
                ) : (
                    <>
                        <span className="truncate text-sm font-medium flex-1">{name}</span>
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                            <button
                                onClick={(e) => { e.stopPropagation(); onNewChatInProject?.(id); }}
                                className="p-1 rounded-md hover:bg-white/15 text-sidebar-text-muted hover:text-white transition-colors"
                                title="New chat in project"
                            >
                                <Plus size={13} />
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); onBehaviorSettings?.(id, name); }}
                                className="p-1 rounded-md hover:bg-white/15 text-sidebar-text-muted hover:text-sjsu-gold transition-colors"
                                title="Project behavior settings"
                            >
                                <Sliders size={13} />
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); setRenameValue(name || ''); setRenaming(true); }}
                                className="p-1 rounded-md hover:bg-white/15 text-sidebar-text-muted hover:text-white transition-colors"
                                title="Rename project"
                            >
                                <Pencil size={13} />
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); onDeleteProject?.(id); }}
                                className="p-1 rounded-md hover:bg-red-500/20 text-sidebar-text-muted hover:text-red-400 transition-colors"
                                title="Delete project"
                            >
                                <Trash2 size={13} />
                            </button>
                        </div>
                    </>
                )}
            </div>

            {/* Nested conversations */}
            {expanded && (
                <ul className="ml-5 mt-0.5 space-y-0.5 border-l border-white/10 pl-2">
                    {conversations.map((c) => (
                        <ProjectConversationItem
                            key={c.id}
                            id={c.id}
                            title={c.title}
                            preview={c.last_message_preview}
                            active={c.id === currentConversationId}
                            onClick={onSelectConversation}
                            onRename={onRenameConversation}
                            onDelete={onDeleteConversation}
                            onRemoveFromProject={onRemoveFromProject}
                        />
                    ))}
                    {conversations.length === 0 && (
                        <li className="text-[11px] text-sidebar-text-muted px-2 py-1.5 italic">No chats yet</li>
                    )}
                </ul>
            )}
        </li>
    );
}

function ProjectConversationItem({ id, title, preview, active, onClick, onRename, onDelete, onRemoveFromProject }) {
    const [renaming, setRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState(title || '');
    const inputRef = useRef(null);

    useEffect(() => {
        if (renaming) inputRef.current?.focus();
    }, [renaming]);

    const submitRename = () => {
        const trimmed = renameValue.trim();
        if (trimmed && trimmed !== title) onRename?.(id, trimmed);
        setRenaming(false);
    };

    const displayTitle = title || preview || 'New Chat';

    return (
        <li
            onClick={() => !renaming && onClick?.(id)}
            className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer transition-all group relative overflow-hidden text-[13px] ${
                active ? 'bg-white/15' : 'hover:bg-white/10'
            }`}
        >
            <MessageSquare size={12} className="text-sidebar-text-muted shrink-0" />

            {renaming ? (
                <div className="flex items-center gap-1 min-w-0 flex-1" onClick={(e) => e.stopPropagation()}>
                    <input
                        ref={inputRef}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') submitRename();
                            if (e.key === 'Escape') setRenaming(false);
                        }}
                        className="bg-white/10 text-white text-xs rounded px-1.5 py-0.5 w-full focus:outline-none focus:ring-1 focus:ring-sjsu-gold/50"
                    />
                    <button onClick={submitRename} className="shrink-0 p-0.5 text-green-400"><Check size={11} /></button>
                    <button onClick={() => setRenaming(false)} className="shrink-0 p-0.5 text-sidebar-text-muted"><X size={11} /></button>
                </div>
            ) : (
                <>
                    <span className="truncate flex-1">{displayTitle}</span>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                            onClick={(e) => { e.stopPropagation(); setRenameValue(title || ''); setRenaming(true); }}
                            className="p-1 rounded hover:bg-white/15 text-sidebar-text-muted hover:text-white transition-colors"
                            title="Rename"
                        >
                            <Pencil size={11} />
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); onRemoveFromProject?.(id); }}
                            className="p-1 rounded hover:bg-white/15 text-sidebar-text-muted hover:text-white transition-colors"
                            title="Remove from project"
                        >
                            <ArrowRightFromLine size={11} />
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); onDelete?.(id); }}
                            className="p-1 rounded hover:bg-red-500/20 text-sidebar-text-muted hover:text-red-400 transition-colors"
                            title="Delete"
                        >
                            <Trash2 size={11} />
                        </button>
                    </div>
                    <div className="absolute right-0 top-0 bottom-0 w-8 bg-linear-to-l from-bg-sidebar via-bg-sidebar/80 to-transparent pointer-events-none group-hover:opacity-0 transition-opacity" />
                </>
            )}
        </li>
    );
}
