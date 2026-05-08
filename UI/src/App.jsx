import { useState, useRef, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import MainChat from './components/MainChat';
import RightPanel from './components/RightPanel';
import UserProfile from './components/UserProfile';
import InternJobsAlertsPage from './internAlerts/InternJobsAlertsPage.tsx';
import Login from './components/Login';
import Signup from './components/Signup';
import VerifyEmail from './components/VerifyEmail';
import { supabase } from './supabaseClient';
import { ensureProfile } from './supabaseHelpers';
import { sendMessage, generateTitle, fetchAutoBehavior } from './services/llamaService';
import {
  fetchConversations,
  createConversation,
  renameConversation,
  deleteConversation,
  fetchMessages,
  insertMessage,
  deleteMessage,
  deleteMessagesAfter,
  autoTitleIfNeeded,
} from './services/chatService';
import { fetchBehaviorSettings, updateBehaviorSettings, resolveEffectiveBehavior, upsertScopedBehavior, deleteScopedBehavior, DEFAULT_BEHAVIOR } from './services/behaviorService';
import ScopedBehaviorPanel from './components/ScopedBehaviorPanel';
import { insertFeedbackLog, updateFeedbackVote } from './services/feedbackLogService';
import {
  fetchProjects,
  createProject,
  renameProject,
  deleteProject,
  fetchProjectConversations,
  assignConversationToProject,
  unassignConversationFromProject,
} from './services/projectService';
import './App.css';
import {
  fetchNearbyRestaurants,
  formatRestaurantsMessage,
} from './services/restaurantsService';
import { retrieveMemoryContext, processMemoryExtraction } from './services/memoryService';

export default function App() {
  const [authPage, setAuthPage] = useState('login');
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [unverifiedEmail, setUnverifiedEmail] = useState('');

  useEffect(() => {
    let alive = true;

    const withTimeout = (promise, label, timeoutMs = 12000) =>
      Promise.race([
        promise,
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
        }),
      ]);

    const bootstrapAuth = async () => {
      try {
        const sessionRes = await withTimeout(supabase.auth.getSession(), 'Auth session check');
        const session = sessionRes?.data?.session;

        if (session?.user) {
          if (!session.user.email?.endsWith('@sjsu.edu')) {
            await supabase.auth.signOut();
            if (alive) {
              setUser(null);
              setAuthPage('login');
            }
            return;
          }

          const isOAuth = session.user.app_metadata?.provider !== 'email';
          if (!isOAuth && !session.user.email_confirmed_at) {
            if (alive) {
              setUnverifiedEmail(session.user.email);
              setAuthPage('verify-email');
            }
            return;
          }

          if (alive) {
            setUser(session.user);
            setAuthPage(null);
            setAuthError('');
          }

          withTimeout(ensureProfile(session.user), 'Profile check').catch((profileError) => {
            if (alive) {
              console.warn('Profile sync warning:', profileError?.message || profileError);
            }
          });
        } else if (alive) {
          setUser(null);
          setAuthPage('login');
        }
      } catch (error) {
        if (alive) {
          setUser(null);
          setAuthPage('login');
          setAuthError(error?.message || 'Failed to initialize authentication.');
        }
      } finally {
        if (alive) setAuthLoading(false);
      }
    };

    bootstrapAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      try {
        if (session?.user) {
          if (session.user.email && !session.user.email.endsWith('@sjsu.edu')) {
            await supabase.auth.signOut();
            if (alive) {
              setUser(null);
              setAuthPage('login');
            }
            return;
          }

          const isOAuth = session.user.app_metadata?.provider !== 'email';
          if (!isOAuth && !session.user.email_confirmed_at) {
            if (alive) {
              setUnverifiedEmail(session.user.email);
              setAuthPage('verify-email');
            }
            return;
          }

          if (alive) {
            setUser(session.user);
            setAuthPage(null);
            setAuthError('');
          }

          withTimeout(ensureProfile(session.user), 'Profile sync').catch((profileError) => {
            if (alive) {
              console.warn('Profile sync warning:', profileError?.message || profileError);
            }
          });
        } else if (alive) {
          setUser(null);
          setAuthPage('login');
        }
      } catch (error) {
        if (alive) {
          setAuthError(error?.message || 'Authentication state update failed.');
        }
      }
    });

    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);

  const [isDarkMode, setIsDarkMode] = useState(false);
  const [currentPage, setCurrentPage] = useState('chat');
  const [rightPanelContent, setRightPanelContent] = useState('empty');
  const [rightPanelLinks, setRightPanelLinks] = useState([]);
  const [selectedModel, setSelectedModel] = useState('8b');

  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [hasMoreConversations, setHasMoreConversations] = useState(false);
  const messagesEndRef = useRef(null);
  const abortRef = useRef(null);

  const [projects, setProjects] = useState([]);
  const [projectConversations, setProjectConversations] = useState({});
  const [expandedProjects, setExpandedProjects] = useState({});
  const [activeProjectId, setActiveProjectId] = useState(null); // project context for new chats

  // Behavior settings
  const [behaviorSettings, setBehaviorSettings] = useState(null);

  // Scoped behavior panel state
  const [scopedPanel, setScopedPanel] = useState({
    open: false,
    scope: null,          // 'project' | 'conversation'
    scopeId: null,        // project_id or conversation_id
    scopeLabel: '',       // display name
  });
  const [scopedBehavior, setScopedBehavior] = useState(null);        // the override row (null = no override)
  const [activeBehaviorScope, setActiveBehaviorScope] = useState('user'); // 'user' | 'project' | 'conversation'
  const [autoBehavior, setAutoBehavior] = useState(null);            // auto-detected behavior from backend

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  useEffect(() => {
    if (!user?.id) return undefined;

    const schedulerEnabled = import.meta.env.VITE_ENABLE_JOB_FETCHER_SCHEDULER === 'true';
    if (!schedulerEnabled) return undefined;

    const schedulerMs = Number(import.meta.env.VITE_JOB_FETCHER_SCHEDULER_MS || 300000);
    let running = false;

    const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';
    const runCycle = async () => {
      if (running) return;
      running = true;
      try {
        await fetch(`${API_BASE}/api/jobs/fetch`, { method: 'POST' });
      } catch (error) {
        console.error('Job scheduler cycle failed:', error?.message || error);
      } finally {
        running = false;
      }
    };

    runCycle();
    const intervalId = setInterval(runCycle, schedulerMs);
    return () => clearInterval(intervalId);
  }, [user?.id]);

  const loadConversations = useCallback(async (cursor = null) => {
    if (!user?.id) return;
    try {
      const data = await fetchConversations({ limit: 20, cursor });
      if (cursor) {
        setConversations(prev => [...prev, ...data]);
      } else {
        setConversations(data);
      }
      setHasMoreConversations(data.length === 20);
    } catch (err) {
      console.error('Failed to load conversations:', err.message);
    }
  }, [user?.id]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  const loadMoreConversations = useCallback(() => {
    if (!hasMoreConversations || !conversations.length) return;
    const oldest = conversations[conversations.length - 1];
    loadConversations(oldest.updated_at);
  }, [hasMoreConversations, conversations, loadConversations]);

  const loadProjects = useCallback(async () => {
    if (!user?.id) return;
    try {
      const data = await fetchProjects();
      setProjects(data);
    } catch (err) {
      console.error('Failed to load projects:', err.message);
    }
  }, [user?.id]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // ── Load behavior settings when user logs in ────────────
  useEffect(() => {
    if (!user?.id) return;
    fetchBehaviorSettings(user.id)
      .then(setBehaviorSettings)
      .catch(err => {
        console.warn('Failed to load behavior settings, using empty overrides:', err.message);
        setBehaviorSettings({});
      });
  }, [user?.id]);

  const handleUpdateBehavior = async (updates) => {
    if (!user?.id) return;
    try {
      const updated = await updateBehaviorSettings(user.id, updates);
      setBehaviorSettings(updated);
    } catch (err) {
      console.error('Failed to update behavior settings:', err.message);
    }
  };

  // ── Scoped behavior panel helpers ──────────────────────────────────────────

  // Detect which scope is active for the current conversation
  useEffect(() => {
    if (!user?.id || !currentConversationId) {
      setActiveBehaviorScope('user');
      return;
    }
    const detect = async () => {
      try {
        const { data } = await supabase
          .from('behavior_settings')
          .select('project_id, conversation_id')
          .eq('user_id', user.id);
        const rows = data || [];
        if (rows.some(r => r.conversation_id === currentConversationId)) {
          setActiveBehaviorScope('conversation');
        } else if (activeProjectId && rows.some(r => r.project_id === activeProjectId && !r.conversation_id)) {
          setActiveBehaviorScope('project');
        } else {
          setActiveBehaviorScope('user');
        }
      } catch {
        setActiveBehaviorScope('user');
      }
    };
    detect();
  }, [user?.id, currentConversationId, activeProjectId, scopedPanel.open]);

  const openScopedPanel = async (scope, scopeId, scopeLabel) => {
    if (!user?.id) return;
    // Fetch the existing override for this scope
    try {
      let query = supabase
        .from('behavior_settings')
        .select('response_tone, response_length, response_format, emoji_usage, priority_stack, project_id, conversation_id')
        .eq('user_id', user.id);

      if (scope === 'project') {
        query = query.eq('project_id', scopeId).is('conversation_id', null);
      } else {
        query = query.eq('conversation_id', scopeId);
      }

      const { data } = await query.maybeSingle();
      setScopedBehavior(data || null);
    } catch {
      setScopedBehavior(null);
    }

    setScopedPanel({ open: true, scope, scopeId, scopeLabel });

    // Fetch auto-detected behavior for this conversation's context
    const context = messages.slice(-20).map(m => ({
      role: m.sender === 'user' ? 'user' : 'assistant',
      content: m.text,
    }));
    if (context.length > 0) {
      fetchAutoBehavior(context).then(result => {
        if (result?.behavior) setAutoBehavior(result.behavior);
      }).catch(() => {});
    }
  };

  const handleSaveScopedBehavior = async (updates) => {
    if (!user?.id || !scopedPanel.scopeId) return;
    try {
      const result = await upsertScopedBehavior(user.id, updates, {
        projectId: scopedPanel.scope === 'project' ? scopedPanel.scopeId : null,
        conversationId: scopedPanel.scope === 'conversation' ? scopedPanel.scopeId : null,
      });
      setScopedBehavior(result);
    } catch (err) {
      console.error('Failed to save scoped behavior:', err.message);
    }
  };

  const handleDeleteScopedBehavior = async () => {
    if (!user?.id || !scopedPanel.scopeId) return;
    try {
      await deleteScopedBehavior(user.id, {
        projectId: scopedPanel.scope === 'project' ? scopedPanel.scopeId : null,
        conversationId: scopedPanel.scope === 'conversation' ? scopedPanel.scopeId : null,
      });
      setScopedBehavior(null);
    } catch (err) {
      console.error('Failed to delete scoped behavior:', err.message);
    }
  };

  const handleOpenProjectBehavior = (projectId, projectName) => {
    openScopedPanel('project', projectId, projectName);
  };

  const handleOpenConversationBehavior = () => {
    if (!currentConversationId) return;
    const convo = conversations.find(c => c.id === currentConversationId);
    // Also check project conversations
    let title = convo?.title;
    if (!title) {
      for (const convos of Object.values(projectConversations)) {
        const found = convos.find(c => c.id === currentConversationId);
        if (found) { title = found.title; break; }
      }
    }
    openScopedPanel('conversation', currentConversationId, title || 'Current Chat');
  };

  const loadProjectConvos = useCallback(async (projectId) => {
    try {
      const convos = await fetchProjectConversations(projectId);
      setProjectConversations(prev => ({ ...prev, [projectId]: convos }));
    } catch (err) {
      console.error('Failed to load project conversations:', err.message);
    }
  }, []);

  const handleCreateProject = async (name) => {
    if (!user?.id) return;
    try {
      const project = await createProject(user.id, name);
      setProjects(prev => [project, ...prev]);
      setExpandedProjects(prev => ({ ...prev, [project.id]: true }));
      setProjectConversations(prev => ({ ...prev, [project.id]: [] }));
    } catch (err) {
      console.error('Create project failed:', err.message);
    }
  };

  const handleRenameProject = async (projectId, newName) => {
    try {
      await renameProject(projectId, newName);
      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, name: newName } : p));
    } catch (err) {
      console.error('Rename project failed:', err.message);
    }
  };

  const handleDeleteProject = async (projectId) => {
    try {
      await deleteProject(projectId);
      setProjects(prev => prev.filter(p => p.id !== projectId));
      setProjectConversations(prev => {
        const next = { ...prev };
        delete next[projectId];
        return next;
      });
      if (activeProjectId === projectId) setActiveProjectId(null);
      loadConversations();
    } catch (err) {
      console.error('Delete project failed:', err.message);
    }
  };

  const handleToggleProject = useCallback((projectId) => {
    setExpandedProjects(prev => {
      const nowExpanded = !prev[projectId];
      if (nowExpanded) loadProjectConvos(projectId);
      return { ...prev, [projectId]: nowExpanded };
    });
  }, [loadProjectConvos]);

  const handleNewChatInProject = (projectId) => {
    setActiveProjectId(projectId);
    setCurrentConversationId(null);
    setMessages([]);
    setRightPanelContent('empty');
    setRightPanelLinks([]);
    setCurrentPage('chat');
  };

  const handleAssignToProject = async (conversationId, projectId) => {
    try {
      await assignConversationToProject(conversationId, projectId);
      setConversations(prev => prev.filter(c => c.id !== conversationId));
      loadProjectConvos(projectId);
      setExpandedProjects(prev => ({ ...prev, [projectId]: true }));
    } catch (err) {
      console.error('Assign to project failed:', err.message);
    }
  };

  const handleRemoveFromProject = async (conversationId) => {
    try {
      await unassignConversationFromProject(conversationId);
      setProjectConversations(prev => {
        const next = {};
        for (const [pid, convos] of Object.entries(prev)) {
          next[pid] = convos.filter(c => c.id !== conversationId);
        }
        return next;
      });
      loadConversations();
    } catch (err) {
      console.error('Remove from project failed:', err.message);
    }
  };

  const openConversation = useCallback(async (conversationId) => {
    setCurrentConversationId(conversationId);
    setMessages([]);
    setCurrentPage('chat');
    setLoadingMessages(true);
    setRightPanelContent('empty');
    setRightPanelLinks([]);

    try {
      const msgs = await fetchMessages({ conversationId, limit: 30 });
      const mapped = msgs.map(m => ({
        id: m.id,
        text: m.content,
        sender: m.role === 'user' ? 'user' : 'bot',
        created_at: m.created_at,
      }));
      setMessages(mapped);
      setHasMoreMessages(msgs.length === 30);
      if (mapped.length > 0) setRightPanelContent('empty');
    } catch (err) {
      console.error('Failed to load messages:', err.message);
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  const loadOlderMessages = useCallback(async () => {
    if (!currentConversationId || !hasMoreMessages || loadingMessages) return;
    setLoadingMessages(true);

    try {
      const oldest = messages[0];
      const cursor = oldest?.created_at || null;
      const older = await fetchMessages({ conversationId: currentConversationId, limit: 30, cursor });
      const mapped = older.map(m => ({
        id: m.id,
        text: m.content,
        sender: m.role === 'user' ? 'user' : 'bot',
        created_at: m.created_at,
      }));
      setMessages(prev => [...mapped, ...prev]);
      setHasMoreMessages(older.length === 30);
    } catch (err) {
      console.error('Failed to load older messages:', err.message);
    } finally {
      setLoadingMessages(false);
    }
  }, [currentConversationId, hasMoreMessages, loadingMessages, messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (!loadingMessages) scrollToBottom();
  }, [messages, loadingMessages]);

  const isRestaurantQuery = (text) => {
    const q = text.toLowerCase().trim();

    return (
      q.includes('restaurant') ||
      q.includes('restaurants') ||
      q.includes('food') ||
      q.includes('eat') ||
      q.includes('lunch') ||
      q.includes('dinner') ||
      q.includes('breakfast') ||
      q.includes('cafe') ||
      q.includes('hungry') ||
      q.includes('places to eat') ||
      q.includes('near by restaurants') ||
      q.includes('nearby restaurants')
    );
  };

  const handleSend = async () => {
    if (!input.trim() || !user?.id) return;

    const userText = input.trim();
    const restaurantMode = isRestaurantQuery(userText);

    setInput('');
    setIsTyping(true);
    setRightPanelContent('empty');
    setRightPanelLinks([]);

    try {
      let convoId = currentConversationId;

      if (!convoId) {
        const convo = await createConversation(user.id, null, activeProjectId);
        convoId = convo.id;
        setCurrentConversationId(convoId);

        if (activeProjectId) {
          setProjectConversations(prev => ({
            ...prev,
            [activeProjectId]: [convo, ...(prev[activeProjectId] || [])],
          }));
        } else {
          setConversations(prev => [convo, ...prev]);
        }
      }

      const userRow = await insertMessage({
        conversationId: convoId,
        role: 'user',
        content: userText,
      });

      const userMsg = {
        id: userRow.id,
        text: userText,
        sender: 'user',
        created_at: userRow.created_at,
      };

      setMessages(prev => [...prev, userMsg]);

      autoTitleIfNeeded(convoId, userText, generateTitle)
        .then(() => loadConversations())
        .catch(() => {});

      if (restaurantMode) {
        const tempId = `temp-${Date.now()}`;

        setMessages(prev => [
          ...prev,
          {
            id: tempId,
            text: '🔍 Finding restaurants near SJSU...',
            sender: 'bot',
          },
        ]);

        try {
          const restaurants = await fetchNearbyRestaurants();
          const restaurantReply = formatRestaurantsMessage(restaurants);

          setMessages(prev =>
            prev.map(m =>
              m.id === tempId ? { ...m, text: restaurantReply } : m
            )
          );

          const assistantRow = await insertMessage({
            conversationId: convoId,
            role: 'assistant',
            content: restaurantReply,
          });

          setMessages(prev =>
            prev.map(m =>
              m.id === tempId
                ? {
                    ...m,
                    id: assistantRow.id,
                    created_at: assistantRow.created_at,
                  }
                : m
            )
          );

          loadConversations();
          return;
        } catch (error) {
          const fallback = `**Error:** ${error.message || 'Could not fetch nearby restaurants.'}`;

          setMessages(prev =>
            prev.map(m =>
              m.id === tempId ? { ...m, text: fallback } : m
            )
          );

          const assistantRow = await insertMessage({
            conversationId: convoId,
            role: 'assistant',
            content: fallback,
          });

          setMessages(prev =>
            prev.map(m =>
              m.id === tempId
                ? {
                    ...m,
                    id: assistantRow.id,
                    created_at: assistantRow.created_at,
                  }
                : m
            )
          );

          loadConversations();
          return;
        }
      }

      const currentMessages = [...messages, userMsg];
      const context = currentMessages.slice(-20).map(m => ({
        role: m.sender === 'user' ? 'user' : 'assistant',
        content: m.text,
      }));

      const tempId = `temp-${Date.now()}`;
      setMessages(prev => [...prev, { id: tempId, text: '', sender: 'bot' }]);

      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      // Resolve manual overrides + memory in parallel
      const [manualBehavior, memoryPrompt] = await Promise.all([
        resolveEffectiveBehavior(user.id, activeProjectId, convoId).catch(() => null),
        retrieveMemoryContext(convoId).catch(() => ''),
      ]);
      let fullResponse = '';
      const assistantMeta = await sendMessage({
        messages: context,
        model: selectedModel,
        signal: controller.signal,
        behavior: manualBehavior,
        memoryPrompt,
        onChunk: (chunk) => {
          fullResponse += chunk;
          setMessages(prev =>
            prev.map(m =>
              m.id === tempId ? { ...m, text: m.text + chunk } : m
            )
          );
        },
        onReplace: (text) => {
          fullResponse = text;
          setMessages(prev => prev.map(m => m.id === tempId ? { ...m, text } : m));
        },
      });

      const sources = assistantMeta?.sources || [];
      setRightPanelLinks(sources);
      setRightPanelContent(sources.length > 0 ? 'links' : 'empty');

      // Persist assistant message
      const assistantRow = await insertMessage({
        conversationId: convoId,
        role: 'assistant',
        content: fullResponse,
      });

      // Fire-and-forget: feedback log + memory extraction
      insertFeedbackLog({
        responseId:       assistantRow.id,
        userId:           user.id,
        conversationId:   convoId,
        behaviorSnapshot: manualBehavior,
        validatorsRun:    assistantMeta?.validatorsRun    ?? [],
        validatorsPassed: assistantMeta?.validatorsPassed ?? true,
        repairsApplied:   assistantMeta?.repairsApplied   ?? [],
        modelUsed:        selectedModel,
      }).catch(() => {});

      processMemoryExtraction(convoId, assistantRow.id, userText, fullResponse).catch(() => {});

      // Replace temp message with persisted one
      setMessages(prev =>
        prev.map(m =>
          m.id === tempId
            ? { ...m, id: assistantRow.id, created_at: assistantRow.created_at }
            : m
        )
      );

      loadConversations();
    } catch (err) {
      if (err.name === 'AbortError') return;

      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.sender === 'bot') {
          return prev.map(m =>
            m.id === last.id ? { ...m, text: `**Error:** ${err.message}` } : m
          );
        }
        return [
          ...prev,
          {
            id: `err-${Date.now()}`,
            text: `**Error:** ${err.message}`,
            sender: 'bot',
          },
        ];
      });
    } finally {
      setIsTyping(false);
      abortRef.current = null;
    }
  };

  const handleRegenerate = async () => {
    if (!currentConversationId || !user?.id || isTyping) return;

    const lastBotIdx = [...messages].reverse().findIndex(m => m.sender === 'bot');
    if (lastBotIdx === -1) return;

    const botIdx = messages.length - 1 - lastBotIdx;
    const botMsg = messages[botIdx];

    let userMsg = null;
    for (let i = botIdx - 1; i >= 0; i--) {
      if (messages[i].sender === 'user') {
        userMsg = messages[i];
        break;
      }
    }
    if (!userMsg) return;

    if (
      botMsg.id &&
      !String(botMsg.id).startsWith('temp-') &&
      !String(botMsg.id).startsWith('err-')
    ) {
      try {
        await deleteMessage(botMsg.id);
      } catch {
        // best-effort delete; continue regenerating even if the row is gone
      }
    }

    setMessages(prev => prev.filter(m => m.id !== botMsg.id));
    setIsTyping(true);

    const context = messages
      .slice(0, botIdx)
      .slice(-20)
      .map(m => ({
        role: m.sender === 'user' ? 'user' : 'assistant',
        content: m.text,
      }));

    const tempId = `temp-${Date.now()}`;
    setMessages(prev => [...prev, { id: tempId, text: '', sender: 'bot' }]);

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Resolve manual overrides + memory in parallel
      const [manualBehavior, memoryPrompt] = await Promise.all([
        resolveEffectiveBehavior(user.id, activeProjectId, currentConversationId).catch(() => null),
        retrieveMemoryContext(currentConversationId).catch(() => ''),
      ]);
      let fullResponse = '';
      const assistantMeta = await sendMessage({
        messages: context,
        model: selectedModel,
        signal: controller.signal,
        behavior: manualBehavior,
        memoryPrompt,
        onChunk: (chunk) => {
          fullResponse += chunk;
          setMessages(prev => prev.map(m => m.id === tempId ? { ...m, text: m.text + chunk } : m));
        },
        onReplace: (text) => {
          fullResponse = text;
          setMessages(prev => prev.map(m => m.id === tempId ? { ...m, text } : m));
        },
      });

      const sources = assistantMeta?.sources || [];
      setRightPanelLinks(sources);
      setRightPanelContent(sources.length > 0 ? 'links' : 'empty');

      const assistantRow = await insertMessage({
        conversationId: currentConversationId,
        role: 'assistant',
        content: fullResponse,
      });

      insertFeedbackLog({
        responseId:       assistantRow.id,
        userId:           user.id,
        conversationId:   currentConversationId,
        behaviorSnapshot: manualBehavior,
        validatorsRun:    assistantMeta?.validatorsRun    ?? [],
        validatorsPassed: assistantMeta?.validatorsPassed ?? true,
        repairsApplied:   assistantMeta?.repairsApplied   ?? [],
        modelUsed:        selectedModel,
      }).catch(() => {});

      processMemoryExtraction(currentConversationId, assistantRow.id, userMsg.text, fullResponse).catch(() => {});

      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, id: assistantRow.id, created_at: assistantRow.created_at } : m));
      loadConversations();
    } catch (err) {
      if (err.name === 'AbortError') return;
      setMessages(prev =>
        prev.map(m =>
          m.id === tempId ? { ...m, text: `**Error:** ${err.message}` } : m
        )
      );
    } finally {
      setIsTyping(false);
      abortRef.current = null;
    }
  };

  const handleEditAndResubmit = async (msgId, newText) => {
    if (!currentConversationId || !user?.id || isTyping) return;

    const msgIdx = messages.findIndex(m => m.id === msgId);
    if (msgIdx === -1) return;
    const originalMsg = messages[msgIdx];

    if (originalMsg.created_at) {
      try {
        await deleteMessagesAfter(currentConversationId, originalMsg.created_at);
      } catch {
        // best-effort cleanup; local state is the source of truth here
      }
    }

    const preceding = messages.slice(0, msgIdx);
    setMessages(preceding);
    setIsTyping(true);

    try {
      const userRow = await insertMessage({
        conversationId: currentConversationId,
        role: 'user',
        content: newText,
      });

      const userMsg = {
        id: userRow.id,
        text: newText,
        sender: 'user',
        created_at: userRow.created_at,
      };

      setMessages(prev => [...prev, userMsg]);

      const context = [...preceding, userMsg].slice(-20).map(m => ({
        role: m.sender === 'user' ? 'user' : 'assistant',
        content: m.text,
      }));

      const tempId = `temp-${Date.now()}`;
      setMessages(prev => [...prev, { id: tempId, text: '', sender: 'bot' }]);

      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      // Resolve manual overrides + memory in parallel
      const [manualBehavior, memoryPrompt] = await Promise.all([
        resolveEffectiveBehavior(user.id, activeProjectId, currentConversationId).catch(() => null),
        retrieveMemoryContext(currentConversationId).catch(() => ''),
      ]);
      let fullResponse = '';
      const assistantMeta = await sendMessage({
        messages: context,
        model: selectedModel,
        signal: controller.signal,
        behavior: manualBehavior,
        memoryPrompt,
        onChunk: (chunk) => {
          fullResponse += chunk;
          setMessages(prev => prev.map(m => m.id === tempId ? { ...m, text: m.text + chunk } : m));
        },
        onReplace: (text) => {
          fullResponse = text;
          setMessages(prev => prev.map(m => m.id === tempId ? { ...m, text } : m));
        },
      });

      const sources = assistantMeta?.sources || [];
      setRightPanelLinks(sources);
      setRightPanelContent(sources.length > 0 ? 'links' : 'empty');

      const assistantRow = await insertMessage({
        conversationId: currentConversationId,
        role: 'assistant',
        content: fullResponse,
      });

      insertFeedbackLog({
        responseId:       assistantRow.id,
        userId:           user.id,
        conversationId:   currentConversationId,
        behaviorSnapshot: manualBehavior,
        validatorsRun:    assistantMeta?.validatorsRun    ?? [],
        validatorsPassed: assistantMeta?.validatorsPassed ?? true,
        repairsApplied:   assistantMeta?.repairsApplied   ?? [],
        modelUsed:        selectedModel,
      }).catch(() => {});

      processMemoryExtraction(currentConversationId, assistantRow.id, newText, fullResponse).catch(() => {});

      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, id: assistantRow.id, created_at: assistantRow.created_at } : m));
      loadConversations();
    } catch (err) {
      if (err.name === 'AbortError') return;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.sender === 'bot') {
          return prev.map(m =>
            m.id === last.id ? { ...m, text: `**Error:** ${err.message}` } : m
          );
        }
        return [
          ...prev,
          {
            id: `err-${Date.now()}`,
            text: `**Error:** ${err.message}`,
            sender: 'bot',
          },
        ];
      });
    } finally {
      setIsTyping(false);
      abortRef.current = null;
    }
  };

  const handleSuggestionClick = (text) => {
    setInput(text);
  };

  // ── Feedback vote (thumbs-up / thumbs-down on bot messages) ──────────────
  const handleFeedback = useCallback((msgId, type) => {
    if (!user?.id || !type) return;
    updateFeedbackVote(msgId, user.id, type).catch(() => {});
  }, [user?.id]);

  // ── New chat ──────────────────────────────────────────────
  const startNewChat = () => {
    setCurrentConversationId(null);
    setActiveProjectId(null);
    setMessages([]);
    setRightPanelContent('empty');
    setRightPanelLinks([]);
    setCurrentPage('chat');
  };

  const handleRenameConversation = async (convoId, newTitle) => {
    try {
      await renameConversation(convoId, newTitle);
      setConversations(prev =>
        prev.map(c => (c.id === convoId ? { ...c, title: newTitle } : c))
      );
    } catch (err) {
      console.error('Rename failed:', err.message);
    }
  };

  const handleDeleteConversation = async (convoId) => {
    try {
      await deleteConversation(convoId);
      setConversations(prev => prev.filter(c => c.id !== convoId));
      setProjectConversations(prev => {
        const next = {};
        for (const [pid, convos] of Object.entries(prev)) {
          next[pid] = convos.filter(c => c.id !== convoId);
        }
        return next;
      });
      if (currentConversationId === convoId) {
        setCurrentConversationId(null);
        setMessages([]);
        setRightPanelContent('empty');
        setRightPanelLinks([]);
      }
    } catch (err) {
      console.error('Delete failed:', err.message);
    }
  };

  const handleLogin = (user) => {
    setUser(user);
    setAuthPage(null);
  };

  const handleSignup = (user) => {
    setUser(user);
    setAuthPage(null);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setAuthPage('login');
    setMessages([]);
    setConversations([]);
    setCurrentConversationId(null);
    setRightPanelContent('empty');
    setRightPanelLinks([]);
    setCurrentPage('chat');
    setProjects([]);
    setProjectConversations({});
    setExpandedProjects({});
    setActiveProjectId(null);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0F172A]">
        <div className="text-white text-lg">Loading...</div>
      </div>
    );
  }

  if (authPage === 'login') {
    return (
      <Login
        onLogin={handleLogin}
        onSwitchToSignup={() => setAuthPage('signup')}
        authError={authError}
      />
    );
  }

  if (authPage === 'signup') {
    return (
      <Signup
        onSignup={handleSignup}
        onSwitchToLogin={() => setAuthPage('login')}
      />
    );
  }

  if (authPage === 'verify-email') {
    return (
      <VerifyEmail
        email={unverifiedEmail}
        onBackToLogin={() => setAuthPage('login')}
      />
    );
  }

  return (
    <div className="flex h-screen text-text-primary font-sans overflow-hidden transition-colors duration-300 bg-bg-main">
      <Sidebar
        startNewChat={startNewChat}
        isDarkMode={isDarkMode}
        setIsDarkMode={setIsDarkMode}
        onProfileClick={() => setCurrentPage('profile')}
        onInternAlertsClick={() => setCurrentPage('intern-alerts')}
        onLogout={handleLogout}
        user={user}
        currentPage={currentPage}
        conversations={conversations}
        currentConversationId={currentConversationId}
        onSelectConversation={openConversation}
        onRenameConversation={handleRenameConversation}
        onDeleteConversation={handleDeleteConversation}
        hasMoreConversations={hasMoreConversations}
        onLoadMoreConversations={loadMoreConversations}
        projects={projects}
        projectConversations={projectConversations}
        onCreateProject={handleCreateProject}
        onRenameProject={handleRenameProject}
        onDeleteProject={handleDeleteProject}
        onNewChatInProject={handleNewChatInProject}
        onToggleProject={handleToggleProject}
        expandedProjects={expandedProjects}
        onAssignToProject={handleAssignToProject}
        onRemoveFromProject={handleRemoveFromProject}
        onProjectBehaviorSettings={handleOpenProjectBehavior}
      />

      {currentPage === 'profile' ? (
        <UserProfile
          onBack={() => setCurrentPage('chat')}
          user={user}
          behaviorSettings={behaviorSettings}
          onUpdateBehavior={handleUpdateBehavior}
          autoBehavior={autoBehavior}
        />
      ) : currentPage === 'intern-alerts' ? (
        <InternJobsAlertsPage onBack={() => setCurrentPage('chat')} />
      ) : (
        <>
          <MainChat
            messages={messages}
            input={input}
            setInput={setInput}
            handleSend={handleSend}
            isTyping={isTyping}
            messagesEndRef={messagesEndRef}
            selectedModel={selectedModel}
            setSelectedModel={setSelectedModel}
            hasMoreMessages={hasMoreMessages}
            loadingMessages={loadingMessages}
            onLoadOlderMessages={loadOlderMessages}
            onRegenerate={handleRegenerate}
            onEditAndResubmit={handleEditAndResubmit}
            onSuggestionClick={handleSuggestionClick}
            onFeedback={handleFeedback}
            onBehaviorSettings={handleOpenConversationBehavior}
            hasConversation={!!currentConversationId}
            activeBehaviorScope={activeBehaviorScope}
          />
          <RightPanel rightPanelContent={rightPanelContent} links={rightPanelLinks} />
        </>
      )}

      {/* Scoped Behavior Panel (project or conversation override) */}
      <ScopedBehaviorPanel
        open={scopedPanel.open}
        onClose={() => setScopedPanel(prev => ({ ...prev, open: false }))}
        scope={scopedPanel.scope}
        scopeLabel={scopedPanel.scopeLabel}
        scopeId={scopedPanel.scopeId}
        autoBehavior={autoBehavior || { ...DEFAULT_BEHAVIOR, ...(behaviorSettings || {}) }}
        scopedBehavior={scopedBehavior}
        onSave={handleSaveScopedBehavior}
        onDelete={handleDeleteScopedBehavior}
      />
    </div>
  );
}