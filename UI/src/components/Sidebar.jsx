import { useState, useRef, useCallback } from 'react';
import {
  Plus,
  Search,
  GraduationCap,
  Calendar,
  Bell,
  User2Icon,
  Sun,
  Moon,
  LogOut,
  FolderPlus,
  Check,
  X,
} from 'lucide-react';
import { SidebarToolItem, HistoryItem, ProjectItem } from './Common';

export default function Sidebar({
  startNewChat,
  isDarkMode,
  setIsDarkMode,
  onProfileClick,
  onInternAlertsClick,
  onLogout,
  user,
  currentPage,
  // Standalone conversations (no project)
  conversations = [],
  currentConversationId,
  onSelectConversation,
  onRenameConversation,
  onDeleteConversation,
  hasMoreConversations,
  onLoadMoreConversations,
  // Projects
  projects = [],
  projectConversations = {},
  onCreateProject,
  onRenameProject,
  onDeleteProject,
  onNewChatInProject,
  onToggleProject,
  expandedProjects = {},
  onAssignToProject,
  onRemoveFromProject,
  onProjectBehaviorSettings,
}) {
  const scrollRef = useRef(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const newProjectInputRef = useRef(null);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !hasMoreConversations) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
      onLoadMoreConversations?.();
    }
  }, [hasMoreConversations, onLoadMoreConversations]);

  const submitNewProject = () => {
    const trimmed = newProjectName.trim();
    if (trimmed) onCreateProject?.(trimmed);
    setNewProjectName('');
    setCreatingProject(false);
  };



  return (
    <aside className="w-64 bg-bg-sidebar text-sidebar-text-main flex flex-col shrink-0 transition-colors duration-300">
      <div className="px-5 py-6">
        <h1 className="text-white text-xl font-display font-bold tracking-wide flex items-center gap-2">
          SJSU <span className="font-normal">COPILOT</span>
        </h1>
      </div>

      <div className="px-4 mb-3">
        <button
          onClick={startNewChat}
          className="w-full flex items-center gap-2.5 bg-white/10 hover:bg-white/20 text-white py-2.5 px-4 rounded-lg transition-colors border border-sidebar-border"
        >
          <Plus size={16} />
          <span className="text-sm font-medium">New Chat</span>
        </button>
      </div>

      {/* Search Bar */}
      <div className="px-4 mb-4">
        <div className="relative group">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-sidebar-text-muted transition-colors group-focus-within:text-white" />
          <input
            type="text"
            placeholder="Search chats..."
            className="w-full bg-white/5 border border-sidebar-border rounded-lg pl-9 pr-3 py-2.5 text-xs text-white placeholder-sidebar-text-muted focus:outline-none focus:bg-white/10 focus:border-white/30 transition-all"
          />
        </div>
      </div>

      {/* Tools / Shortcuts */}
      <div className="px-4 mb-5">
        <h3 className="text-[11px] font-semibold text-sidebar-text-muted px-2 mb-2 uppercase tracking-wider">Services</h3>
        <div className="space-y-1">
          <SidebarToolItem icon={<GraduationCap size={16} />} label="Degree Progress" />
          <SidebarToolItem icon={<Calendar size={16} />} label="Registration Info" />
          <SidebarToolItem
            icon={<Bell size={16} />}
            label="Intern Alerts"
            active={currentPage === 'intern-alerts'}
            onClick={onInternAlertsClick}
          />
        </div>
      </div>

      {/* Scrollable area: Projects + Recent */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 scrollbar-hide"
      >
        {/* Projects Section */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[11px] font-semibold text-sidebar-text-muted uppercase tracking-wider">Projects</h3>
            <button
              onClick={() => { setCreatingProject(true); setTimeout(() => newProjectInputRef.current?.focus(), 50); }}
              className="p-1 rounded hover:bg-white/10 text-sidebar-text-muted hover:text-white transition-colors"
              title="New project"
            >
              <FolderPlus size={14} />
            </button>
          </div>

          {/* Inline create project input */}
          {creatingProject && (
            <div className="flex items-center gap-1 px-2 mb-2">
              <input
                ref={newProjectInputRef}
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitNewProject();
                  if (e.key === 'Escape') { setCreatingProject(false); setNewProjectName(''); }
                }}
                placeholder="Project name..."
                className="bg-white/10 text-white text-sm rounded px-2 py-1.5 w-full focus:outline-none focus:ring-1 focus:ring-sjsu-gold/50 placeholder-sidebar-text-muted"
              />
              <button onClick={submitNewProject} className="shrink-0 p-1 text-green-400 hover:text-green-300"><Check size={14} /></button>
              <button onClick={() => { setCreatingProject(false); setNewProjectName(''); }} className="shrink-0 p-1 text-sidebar-text-muted hover:text-white"><X size={14} /></button>
            </div>
          )}

          <ul className="space-y-0.5">
            {projects.map((p) => (
              <ProjectItem
                key={p.id}
                id={p.id}
                name={p.name}
                conversations={projectConversations[p.id] || []}
                expanded={!!expandedProjects[p.id]}
                onToggle={onToggleProject}
                currentConversationId={currentConversationId}
                onSelectConversation={onSelectConversation}
                onRenameProject={onRenameProject}
                onDeleteProject={onDeleteProject}
                onNewChatInProject={onNewChatInProject}
                onRenameConversation={onRenameConversation}
                onDeleteConversation={onDeleteConversation}
                onRemoveFromProject={onRemoveFromProject}
                onBehaviorSettings={onProjectBehaviorSettings}
              />
            ))}
            {projects.length === 0 && !creatingProject && (
              <li className="text-xs text-sidebar-text-muted px-2 py-1">No projects yet</li>
            )}
          </ul>
        </div>

        {/* Recent (standalone) Conversations */}
        <div>
          <h3 className="text-[11px] font-semibold text-sidebar-text-muted mb-2 uppercase tracking-wider">Recent</h3>
          <ul className="space-y-0.5 text-sm">
            {conversations.map((c) => (
              <HistoryItem
                key={c.id}
                id={c.id}
                title={c.title}
                preview={c.last_message_preview}
                active={c.id === currentConversationId}
                onClick={onSelectConversation}
                onRename={onRenameConversation}
                onDelete={onDeleteConversation}
                projects={projects}
                onMoveToProject={onAssignToProject}
              />
            ))}
            {conversations.length === 0 && (
              <li className="text-xs text-sidebar-text-muted px-2 py-3">No conversations yet</li>
            )}
          </ul>
        </div>
      </div>

      {/* Bottom User Profile & Settings */}
      <div className="p-4 border-t border-sidebar-border">
        <div
          onClick={onProfileClick}
          className="flex items-center gap-3 px-2 py-2.5 rounded-lg cursor-pointer group hover:bg-white/10 transition-colors"
        >
          <div className="w-8 h-8 rounded-full overflow-hidden bg-linear-to-br from-sjsu-gold to-orange-400 shrink-0 flex items-center justify-center">
            <User2Icon size={16} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-sidebar-text-main truncate">{user?.user_metadata?.full_name || user?.user_metadata?.name || 'Student'}</p>
          </div>
          <div className="flex items-center gap-0.5 transition-opacity">
            <button
              onClick={(e) => {
                  e.stopPropagation();
                  setIsDarkMode(!isDarkMode);
              }}
              className="p-1.5 rounded-md hover:bg-white/10 transition-colors text-sidebar-text-muted hover:text-white"
              title={isDarkMode ? "Light Mode" : "Dark Mode"}
            >
              {isDarkMode ? <Sun size={14} className="text-sjsu-gold" /> : <Moon size={14} />}
            </button>
            <button
              onClick={(e) => {
                  e.stopPropagation();
                  onLogout();
              }}
              className="p-1.5 rounded-md hover:bg-red-500/20 transition-colors text-sidebar-text-muted hover:text-red-400"
              title="Logout"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
