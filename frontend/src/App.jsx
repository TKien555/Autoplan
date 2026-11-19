import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import './App.css';
import EvaluationPanel from './EvaluationPanel.jsx';
import { evaluateWbs } from './evaluateWbs.js';

const API_BASE_URL = '/api';
const DEFAULT_TRELLO_APP_KEY = import.meta.env?.VITE_TRELLO_API_KEY || '';
const DEFAULT_APP_NAME = import.meta.env?.VITE_APP_NAME || 'AI WBS & RAG Planner';

const SUGGESTED_ROLES = [
  'Full-stack Developer',
  'Backend Developer',
  'Frontend Developer',
  'Mobile Developer',
  'UI/UX Designer',
  'QA / Tester',
  'Business Analyst (BA)',
  'Project Manager (PM)',
  'DevOps / AI Engineer'
];

const getTodayIso = () => new Date().toISOString().slice(0, 10);

const addDaysIso = (baseIso, days) => {
  const d = new Date(`${baseIso || getTodayIso()}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return getTodayIso();
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
};

const validateTaskItem = (task) => {
  const errors = {};
  if (!task.title || !task.title.trim()) {
    errors.title = 'Tên Task không được để trống.';
  } else if (task.title.trim().length < 3) {
    errors.title = 'Tên Task tối thiểu 3 ký tự.';
  }

  if (!task.sprint || !task.sprint.trim()) {
    errors.sprint = 'Tên Sprint không được để trống.';
  }

  const hours = Number(task.estimatedHours);
  if (Number.isNaN(hours) || hours < 0.5 || hours > 200) {
    errors.estimatedHours = 'Giờ ước tính phải từ 0.5h đến 200h.';
  }

  if (task.startDate && task.dueDate && task.dueDate < task.startDate) {
    errors.dates = 'Hạn hoàn thành (Due Date) không được nhỏ hơn Ngày bắt đầu.';
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 55000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: options.signal || controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 503) {
      const retryAfter = response.headers.get('Retry-After') || 10;
      throw new Error(data.error || `Hệ thống AI đang bận, vui lòng thử lại sau ${retryAfter} giây.`);
    }
    if (!response.ok && !data.error) {
      throw new Error(`Lỗi máy chủ (HTTP ${response.status})`);
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Yêu cầu đã vượt quá thời gian chờ (${Math.ceil(timeoutMs / 1000)} giây). Vui lòng thử lại.`);
    }
    throw err;
  } finally {
    clearTimeout(id);
  }
}

const App = () => {
  const [trello, setTrello] = useState(null);
  const [theme, setTheme] = useState('dark');
  const [activeTab, setActiveTab] = useState('planner');
  const [errorBanner, setErrorBanner] = useState('');

  // State dữ liệu Board Trello
  const [boardId, setBoardId] = useState('');
  const [boardMembers, setBoardMembers] = useState([]);
  const [memberRoles, setMemberRoles] = useState({});
  const [boardLists, setBoardLists] = useState([]);

  // State OAuth 1-Click & Cấu hình đẩy thẻ lên Trello ('sprint_lists' | 'existing' | 'new')
  const [targetListMode, setTargetListMode] = useState('sprint_lists');
  const [sprintListPrefix, setSprintListPrefix] = useState('');
  const [selectedListId, setSelectedListId] = useState('');
  const [newListName, setNewListName] = useState('');
  const [trelloApiKey, setTrelloApiKey] = useState(DEFAULT_TRELLO_APP_KEY);
  const [trelloToken, setTrelloToken] = useState('');
  const [isOAuthConnected, setIsOAuthConnected] = useState(false);
  const [showCredentials, setShowCredentials] = useState(false);
  const [pushingToTrello, setPushingToTrello] = useState(false);
  const [pushSuccessMsg, setPushSuccessMsg] = useState('');
  const [failedCards, setFailedCards] = useState([]);

  // State thông tin công việc & Cấu hình Đa Sprint
  const [cardName, setCardName] = useState('');
  const [description, setDescription] = useState('');
  const [sprintPrefix, setSprintPrefix] = useState('Sprint');
  const [sprintCount, setSprintCount] = useState(3);
  const [sprintStartDate, setSprintStartDate] = useState(getTodayIso());
  const [sprintDurationDays, setSprintDurationDays] = useState(14);
  const [useRag, setUseRag] = useState(true);

  // State kết quả WBS & Kéo thả (Drag & Drop)
  const [tasks, setTasks] = useState([]);
  const [latestEvaluation, setLatestEvaluation] = useState(null);
  const [ragMetadata, setRagMetadata] = useState(null);
  const [loading, setLoading] = useState(false);
  const [draggedTaskIndex, setDraggedTaskIndex] = useState(null);
  const [dragOverSprint, setDragOverSprint] = useState('');

  // State Quản lý Tài liệu chuyên môn (RAG)
  const [documents, setDocuments] = useState([]);
  const [uploadMode, setUploadMode] = useState('file');
  const [selectedFile, setSelectedFile] = useState(null);
  const [manualDocName, setManualDocName] = useState('');
  const [manualText, setManualText] = useState('');
  const [uploadingDoc, setUploadingDoc] = useState(false);

  const roleSaveTimerRef = useRef(null);
  const credSaveTimerRef = useRef(null);

  const resizeTrelloIframe = useCallback(() => {
    if (trello) {
      window.requestAnimationFrame(() => {
        trello.sizeTo('#powerup-content').done();
      });
    }
  }, [trello]);

  // Đồng bộ Theme Sáng / Tối theo Trello
  const applyTheme = useCallback((newTheme) => {
    const cleanTheme = newTheme === 'dark' ? 'dark' : 'light';
    setTheme(cleanTheme);
    document.documentElement.setAttribute('data-theme', cleanTheme);
  }, []);

  const getAuthHeaders = useCallback(async (extraHeaders = {}) => {
    let token = '';
    if (trello && boardId) {
      try {
        token = await trello.jwt({ state: JSON.stringify({ boardId }) });
      } catch (err) {
        console.warn('Không thể tạo Trello JWT, dùng token dev dự phòng:', err.message);
      }
    }
    if (!token) {
      token = btoa(JSON.stringify({ boardId: boardId || 'legacy', memberId: 'dev_member' }));
    }
    return {
      ...extraHeaders,
      Authorization: `Bearer ${token}`
    };
  }, [trello, boardId]);

  const fetchDocuments = useCallback(async () => {
    if (!boardId) return;
    try {
      const headers = await getAuthHeaders();
      const data = await fetchJsonWithTimeout(`${API_BASE_URL}/documents`, { headers }, 15000);
      if (data.success) {
        setDocuments(data.documents);
      }
    } catch (err) {
      console.error('Lỗi tải danh sách tài liệu:', err.message);
    }
  }, [boardId, getAuthHeaders]);

  const refreshBoardLists = useCallback(async () => {
    if (trello) {
      try {
        const listsData = await trello.lists('all');
        if (Array.isArray(listsData) && listsData.length > 0) {
          setBoardLists(listsData);
          setSelectedListId(prev => prev || listsData[0].id);
        }
      } catch (err) {
        console.warn('Không thể làm mới danh sách List:', err.message);
      }
    }
  }, [trello]);

  useEffect(() => {
    let unsubscribeTheme = null;

    if (window.TrelloPowerUp) {
      const t = window.TrelloPowerUp.iframe({
        appKey: DEFAULT_TRELLO_APP_KEY || undefined,
        appName: DEFAULT_APP_NAME
      });
      setTrello(t);

      // 1. Tự động đồng bộ Theme Sáng / Tối từ Trello
      try {
        const ctx = t.getContext();
        if (ctx?.theme) {
          applyTheme(ctx.theme);
        }
        if (typeof t.subscribeToThemeChanges === 'function') {
          unsubscribeTheme = t.subscribeToThemeChanges((updatedTheme) => {
            applyTheme(updatedTheme);
          });
        }
      } catch (themeErr) {
        console.warn('Không thể đọc theme từ Trello:', themeErr.message);
      }

      t.card('name', 'desc', 'idList').then(card => {
        if (card?.name) {
          setCardName(card.name);
          setNewListName(`WBS: ${card.name}`);
        }
        if (card?.desc) setDescription(card.desc);
        if (card?.idList) setSelectedListId(card.idList);
      });

      Promise.all([
        t.board('id', 'members'),
        t.lists('all'),
        t.get('board', 'shared', 'memberRoles', {})
      ]).then(async ([boardData, listsData, savedRoles]) => {
        if (boardData?.id) setBoardId(boardData.id);

        if (Array.isArray(boardData?.members)) {
          setBoardMembers(boardData.members);
          const initialRoles = { ...savedRoles };
          boardData.members.forEach(m => {
            if (!initialRoles[m.id]) {
              initialRoles[m.id] = 'Full-stack Developer';
            }
          });
          setMemberRoles(initialRoles);
        }

        if (Array.isArray(listsData) && listsData.length > 0) {
          setBoardLists(listsData);
          setSelectedListId(prev => prev || listsData[0].id);
        }

        // 2. Kiểm tra trạng thái OAuth 1-Click qua t.getRestApi()
        try {
          if (typeof t.getRestApi === 'function') {
            const restApi = t.getRestApi();
            const authorized = await restApi.isAuthorized();
            if (authorized) {
              const oauthToken = await restApi.getToken();
              if (oauthToken) {
                setTrelloToken(oauthToken);
                setIsOAuthConnected(true);
              }
            }
          }
        } catch (oauthErr) {
          console.warn('ℹ️ Chưa kích hoạt getRestApi OAuth:', oauthErr.message);
        }

        // 3. Fallback đọc từ trelloCredentials đã lưu
        try {
          const rawSecret = await t.loadSecret('trelloCredentials');
          if (rawSecret) {
            const parsed = JSON.parse(rawSecret);
            if (parsed?.apiKey) setTrelloApiKey(parsed.apiKey);
            if (parsed?.token) {
              setTrelloToken(prev => prev || parsed.token);
              setIsOAuthConnected(true);
            }
          }
        } catch (secretErr) {
          console.warn('⚠️ Không thể giải mã trelloCredentials:', secretErr.message);
        }
      });

      t.render(() => t.sizeTo('#powerup-content').done());
    } else {
      setBoardId('legacy');
      setCardName('Xây dựng Hệ thống Quản lý Đơn hàng & Thanh toán Đa kênh');
      setNewListName('WBS: Quản lý Đơn hàng');
    }

    return () => {
      if (typeof unsubscribeTheme === 'function') unsubscribeTheme();
      if (roleSaveTimerRef.current) clearTimeout(roleSaveTimerRef.current);
      if (credSaveTimerRef.current) clearTimeout(credSaveTimerRef.current);
    };
  }, [applyTheme]);

  useEffect(() => {
    if (boardId) {
      fetchDocuments();
    }
  }, [boardId, fetchDocuments]);

  useEffect(() => {
    resizeTrelloIframe();
  }, [
    tasks,
    documents,
    activeTab,
    uploadMode,
    loading,
    uploadingDoc,
    pushingToTrello,
    showCredentials,
    targetListMode,
    pushSuccessMsg,
    failedCards,
    errorBanner,
    resizeTrelloIframe
  ]);

  const plannedSprintSchedule = useMemo(() => {
    const cleanPref = (sprintPrefix || 'Sprint').trim().replace(/\s+\d+$/, '') || 'Sprint';
    const count = Math.max(1, Math.min(6, Number(sprintCount) || 1));
    const dur = Math.max(1, Math.min(60, Number(sprintDurationDays) || 14));
    const base = sprintStartDate || getTodayIso();

    const list = [];
    for (let i = 0; i < count; i++) {
      const sStart = addDaysIso(base, i * dur);
      const sEnd = addDaysIso(sStart, dur - 1);
      list.push({
        name: `${cleanPref} ${i + 1}`,
        startDate: sStart,
        endDate: sEnd
      });
    }
    return list;
  }, [sprintPrefix, sprintCount, sprintStartDate, sprintDurationDays]);

  const taskValidationList = useMemo(() => tasks.map(validateTaskItem), [tasks]);
  const hasAnyInvalidTask = useMemo(
    () => taskValidationList.some(v => !v.isValid),
    [taskValidationList]
  );
  const totalEstimatedHours = useMemo(
    () => tasks.reduce((sum, t) => sum + (Number(t.estimatedHours) || 0), 0),
    [tasks]
  );

  // Định mức giờ chuẩn của 1 nhân sự trong 1 Sprint (8h/ngày làm việc)
  const standardHoursPerSprint = useMemo(() => {
    const dur = Math.max(1, Number(sprintDurationDays) || 14);
    const workDays = Math.max(1, Math.round((dur * 5) / 7));
    return workDays * 8;
  }, [sprintDurationDays]);

  const groupedSprintBuckets = useMemo(() => {
    const map = new Map();
    for (const s of plannedSprintSchedule) {
      map.set(s.name, {
        sprintName: s.name,
        startDate: s.startDate,
        endDate: s.endDate,
        items: []
      });
    }

    tasks.forEach((task, originalIndex) => {
      const sName = (task.sprint || 'Sprint 1').trim() || 'Sprint 1';
      if (!map.has(sName)) {
        map.set(sName, {
          sprintName: sName,
          startDate: task.startDate || sprintStartDate,
          endDate: task.dueDate || addDaysIso(sprintStartDate, 13),
          items: []
        });
      }
      map.get(sName).items.push({ task, originalIndex });
    });

    return Array.from(map.values()).filter(
      bucket => bucket.items.length > 0 || plannedSprintSchedule.some(p => p.name === bucket.sprintName)
    );
  }, [tasks, plannedSprintSchedule, sprintStartDate]);

  // Tính toán Tải công việc (Workload Capacity Bar) của từng nhân sự
  const memberWorkloadSummary = useMemo(() => {
    if (tasks.length === 0) return [];
    const sprintCountActive = Math.max(1, groupedSprintBuckets.filter(b => b.items.length > 0).length);
    const maxCapacityTotal = standardHoursPerSprint * sprintCountActive;

    const map = new Map();
    tasks.forEach(t => {
      const key = t.assigneeId || t.assigneeName || 'Chưa gán';
      const name = t.assigneeName || 'Chưa gán';
      const role = t.role || 'Thành viên';
      const hours = Number(t.estimatedHours) || 0;
      const sName = (t.sprint || 'Sprint 1').trim();

      if (!map.has(key)) {
        map.set(key, {
          key,
          name,
          role,
          totalHours: 0,
          bySprint: {}
        });
      }
      const entry = map.get(key);
      entry.totalHours += hours;
      entry.bySprint[sName] = (entry.bySprint[sName] || 0) + hours;
    });

    return Array.from(map.values()).map(item => {
      let peakSprintName = '';
      let peakSprintHours = 0;
      for (const [sName, h] of Object.entries(item.bySprint)) {
        if (h > peakSprintHours) {
          peakSprintHours = h;
          peakSprintName = sName;
        }
      }
      const sprintUtilPercent = Math.round((peakSprintHours / standardHoursPerSprint) * 100);
      const totalUtilPercent = Math.round((item.totalHours / maxCapacityTotal) * 100);
      return {
        ...item,
        peakSprintName,
        peakSprintHours,
        standardHoursPerSprint,
        sprintUtilPercent,
        totalUtilPercent,
        isOverloaded: sprintUtilPercent > 100
      };
    });
  }, [tasks, groupedSprintBuckets, standardHoursPerSprint]);

  const availableSprintNames = useMemo(() => {
    const set = new Set(plannedSprintSchedule.map(s => s.name));
    tasks.forEach(t => {
      if (t.sprint?.trim()) set.add(t.sprint.trim());
    });
    return Array.from(set);
  }, [plannedSprintSchedule, tasks]);

  const handleRoleChange = (memberId, newRole) => {
    const updated = { ...memberRoles, [memberId]: newRole };
    setMemberRoles(updated);
    if (trello) {
      if (roleSaveTimerRef.current) clearTimeout(roleSaveTimerRef.current);
      roleSaveTimerRef.current = setTimeout(() => {
        trello.set('board', 'shared', 'memberRoles', updated);
      }, 400);
    }
  };

  const handleSaveCredentials = (key, token) => {
    setTrelloApiKey(key);
    setTrelloToken(token);
    setIsOAuthConnected(Boolean(token && token.trim()));
    if (trello) {
      if (credSaveTimerRef.current) clearTimeout(credSaveTimerRef.current);
      credSaveTimerRef.current = setTimeout(async () => {
        try {
          await trello.storeSecret('trelloCredentials', JSON.stringify({ apiKey: key, token }));
        } catch (err) {
          console.error('Lỗi khi lưu secret:', err.message);
        }
      }, 400);
    }
  };

  // OAuth 1-Click kết nối tài khoản Trello
  const handleOneClickOAuth = async () => {
    setErrorBanner('');
    const effectiveKey = (trelloApiKey || DEFAULT_TRELLO_APP_KEY).trim();

    if (trello && typeof trello.getRestApi === 'function' && effectiveKey) {
      try {
        const restApi = trello.getRestApi();
        await restApi.authorize({
          scope: 'read,write',
          expiration: 'never'
        });
        const token = await restApi.getToken();
        if (token) {
          handleSaveCredentials(effectiveKey, token);
          setIsOAuthConnected(true);
          setShowCredentials(false);
          return;
        }
      } catch (err) {
        console.warn('Trello getRestApi.authorize fallback:', err.message);
      }
    }

    if (effectiveKey) {
      const returnUrl = window.location.origin + window.location.pathname;
      const authUrl = `https://trello.com/1/authorize?expiration=never&name=${encodeURIComponent(DEFAULT_APP_NAME)}&scope=read,write&response_type=token&key=${encodeURIComponent(effectiveKey)}&return_url=${encodeURIComponent(returnUrl)}`;
      window.open(authUrl, 'trello_oauth_popup', 'width=620,height=680');
      setShowCredentials(true);
    } else {
      setShowCredentials(true);
      setErrorBanner('Vui lòng cấu hình VITE_TRELLO_API_KEY hoặc nhập API Key một lần để kích hoạt 1-Click OAuth.');
    }
  };

  const handleDisconnectOAuth = async () => {
    try {
      if (trello && typeof trello.getRestApi === 'function') {
        await trello.getRestApi().clearToken();
      }
      if (trello) {
        await trello.clearSecret('trelloCredentials');
      }
    } catch { }
    setTrelloToken('');
    setIsOAuthConnected(false);
  };

  const requestBreakdown = async input => {
    const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
    return fetchJsonWithTimeout(`${API_BASE_URL}/breakdown`, {
      method: 'POST',
      headers,
      body: JSON.stringify(input)
    }, 125000);
  };

  const handleBreakdown = async () => {
    if (loading) return;
    setErrorBanner('');

    if (!cardName || cardName.trim().length < 3) {
      return setErrorBanner('Tiêu đề công việc phải có ít nhất 3 ký tự.');
    }
    const countNum = Number(sprintCount);
    if (Number.isNaN(countNum) || countNum < 1 || countNum > 6) {
      return setErrorBanner('Số lượng Sprint phải từ 1 đến 6.');
    }
    const durationNum = Number(sprintDurationDays);
    if (Number.isNaN(durationNum) || durationNum < 1 || durationNum > 60) {
      return setErrorBanner('Thời lượng mỗi Sprint phải từ 1 đến 60 ngày.');
    }

    setLoading(true);
    setPushSuccessMsg('');
    setFailedCards([]);

    try {
      const teamMembersPayload = boardMembers.map(m => ({
        id: m.id,
        fullName: m.fullName || m.username,
        username: m.username,
        role: memberRoles[m.id] || 'Full-stack Developer'
      }));

      const rolesSummary = teamMembersPayload.map(m => `${m.fullName} (${m.role})`).join(', ');
      const input = {
        taskName: cardName.trim(),
        description: description.trim(),
        teamSize: teamMembersPayload.length || 1,
        roles: rolesSummary,
        teamMembers: teamMembersPayload,
        methodology: 'Agile',
        useRag,
        sprintPrefix: sprintPrefix.trim() || 'Sprint',
        sprintCount: countNum,
        sprintStartDate: sprintStartDate || getTodayIso(),
        sprintDurationDays: durationNum
      };
      const data = await requestBreakdown(input);

      if (data.success) {
        const enriched = (data.tasks || []).map((t, i) => ({
          ...t,
          _uid: `task_${Date.now()}_${i}`,
          priority: t.priority || 'Medium',
          subtasks: Array.isArray(t.subtasks) ? t.subtasks : [],
          sprint: t.sprint || plannedSprintSchedule[0]?.name || 'Sprint 1',
          startDate: t.startDate || sprintStartDate || getTodayIso(),
          dueDate: t.dueDate || addDaysIso(sprintStartDate, 2)
        }));
        setLatestEvaluation(evaluateWbs(data, input));
        setTasks(enriched);
        setRagMetadata(data.ragMetadata);
      } else {
        setErrorBanner(data.error || 'Có lỗi xảy ra từ máy chủ AI.');
      }
    } catch (error) {
      setErrorBanner(error.message || 'Không thể kết nối đến Backend.');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateTaskField = (taskIndex, field, value) => {
    setTasks(prev =>
      prev.map((task, idx) => {
        if (idx !== taskIndex) return task;
        if (field === 'sprint') {
          const matchedSchedule = plannedSprintSchedule.find(
            s => s.name.toLowerCase() === String(value || '').trim().toLowerCase()
          );
          if (matchedSchedule) {
            return {
              ...task,
              sprint: value,
              startDate: matchedSchedule.startDate,
              dueDate: addDaysIso(matchedSchedule.startDate, Math.min(3, Number(sprintDurationDays) - 1))
            };
          }
        }
        return { ...task, [field]: value };
      })
    );
  };

  // Quản lý Checklist (Subtasks) của từng Task
  const handleSubtaskChange = (taskIndex, subIdx, newVal) => {
    setTasks(prev =>
      prev.map((task, idx) => {
        if (idx !== taskIndex) return task;
        const updated = [...(task.subtasks || [])];
        updated[subIdx] = newVal;
        return { ...task, subtasks: updated };
      })
    );
  };

  const handleAddSubtask = (taskIndex) => {
    setTasks(prev =>
      prev.map((task, idx) => {
        if (idx !== taskIndex) return task;
        return {
          ...task,
          subtasks: [...(task.subtasks || []), `Bước thực hiện #${(task.subtasks?.length || 0) + 1}`]
        };
      })
    );
  };

  const handleRemoveSubtask = (taskIndex, subIdx) => {
    setTasks(prev =>
      prev.map((task, idx) => {
        if (idx !== taskIndex) return task;
        return {
          ...task,
          subtasks: (task.subtasks || []).filter((_, i) => i !== subIdx)
        };
      })
    );
  };

  // Xử lý Kéo thả (Drag & Drop) Task giữa các Sprint
  const handleDragStartTask = (e, originalIndex) => {
    setDraggedTaskIndex(originalIndex);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(originalIndex));
  };

  const handleDragOverSprintBucket = (e, sprintName) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverSprint !== sprintName) {
      setDragOverSprint(sprintName);
    }
  };

  const handleDropOnSprintBucket = (e, targetSprintName) => {
    e.preventDefault();
    const idxStr = e.dataTransfer.getData('text/plain');
    const sourceIndex = draggedTaskIndex !== null ? draggedTaskIndex : Number(idxStr);
    setDraggedTaskIndex(null);
    setDragOverSprint('');

    if (Number.isNaN(sourceIndex) || sourceIndex < 0 || sourceIndex >= tasks.length) return;
    handleUpdateTaskField(sourceIndex, 'sprint', targetSprintName);
  };

  const handleChangeTaskAssignee = (taskIndex, newMemberId) => {
    const selectedMember = boardMembers.find(m => m.id === newMemberId);
    setTasks(prev =>
      prev.map((task, idx) => {
        if (idx !== taskIndex) return task;
        return {
          ...task,
          assigneeId: selectedMember ? selectedMember.id : null,
          assigneeName: selectedMember ? (selectedMember.fullName || selectedMember.username) : 'Chưa gán',
          role: selectedMember ? (memberRoles[selectedMember.id] || task.role) : task.role
        };
      })
    );
  };

  const handleAddBlankTask = (targetSprintName = '') => {
    const defaultMember = boardMembers[0] || null;
    const chosenSprint = targetSprintName || plannedSprintSchedule[0]?.name || 'Sprint 1';
    const matchedSchedule = plannedSprintSchedule.find(s => s.name === chosenSprint);
    const baseStart = matchedSchedule ? matchedSchedule.startDate : (sprintStartDate || getTodayIso());

    const newTask = {
      _uid: `task_manual_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: `Công việc bổ sung #${tasks.length + 1}`,
      description: 'Mô tả chi tiết công việc cần thực hiện...',
      role: defaultMember ? (memberRoles[defaultMember.id] || 'Full-stack Developer') : 'Full-stack Developer',
      priority: 'Medium',
      subtasks: ['Thiết kế & chuẩn bị môi trường', 'Triển khai & kiểm thử'],
      assigneeId: defaultMember ? defaultMember.id : null,
      assigneeName: defaultMember ? (defaultMember.fullName || defaultMember.username) : 'Chưa gán',
      estimatedHours: 4,
      sprint: chosenSprint,
      startDate: baseStart,
      dueDate: addDaysIso(baseStart, 2),
      referenceSource: 'Thêm thủ công'
    };
    setTasks(prev => [...prev, newTask]);
  };

  const handleRemoveTask = (taskIndex) => {
    setTasks(prev => prev.filter((_, idx) => idx !== taskIndex));
  };

  const handleResetTasks = () => {
    setTasks([]);
    setRagMetadata(null);
    setPushSuccessMsg('');
    setFailedCards([]);
    setErrorBanner('');
  };

  // Xuất bảng WBS sang file Excel CSV (chuẩn UTF-8 BOM hiển thị đúng tiếng Việt) hoặc Markdown
  const handleExportWbsCsv = () => {
    if (tasks.length === 0) return;
    const headers = [
      'STT',
      'Sprint',
      'Tên công việc (Task)',
      'Vai trò (Role)',
      'Người phụ trách (Assignee)',
      'Độ ưu tiên (Priority)',
      'Giờ ước tính (Hours)',
      'Ngày bắt đầu (Start)',
      'Hạn hoàn thành (Due)',
      'Checklist (Definition of Done)',
      'Nguồn tham chiếu (RAG)'
    ];

    const escapeCsv = (val) => {
      const s = String(val ?? '').replace(/"/g, '""');
      return `"${s}"`;
    };

    const rows = tasks.map((t, idx) => [
      idx + 1,
      t.sprint || '',
      t.title || '',
      t.role || '',
      t.assigneeName || 'Chưa gán',
      t.priority || 'Medium',
      t.estimatedHours || 0,
      t.startDate || '',
      t.dueDate || '',
      Array.isArray(t.subtasks) ? t.subtasks.join(' | ') : '',
      t.referenceSource || ''
    ]);

    const csvContent =
      '\uFEFF' +
      [headers.map(escapeCsv).join(','), ...rows.map(r => r.map(escapeCsv).join(','))].join('\r\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const cleanFileName = (cardName || 'WBS_Project').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    link.setAttribute('download', `${cleanFileName}_WBS_${getTodayIso()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportWbsMarkdown = () => {
    if (tasks.length === 0) return;
    const lines = [
      `# BÁO CÁO PHÂN RÃ CÔNG VIỆC (WBS): ${cardName || 'Dự án'}`,
      `- **Tổng số Task:** ${tasks.length} công việc`,
      `- **Tổng quỹ giờ ước tính:** ${totalEstimatedHours.toFixed(1)} giờ`,
      `- **Ngày xuất báo cáo:** ${getTodayIso()}`,
      '',
      '| # | Sprint | Công việc | Vai trò | Phụ trách | Ưu tiên | Giờ | Bắt đầu -> Hạn chót | Checklist (DoD) |',
      '|---|---|---|---|---|---|---:|---|---|'
    ];

    tasks.forEach((t, i) => {
      const checklistStr = Array.isArray(t.subtasks) ? t.subtasks.map(s => `• ${s}`).join('<br/>') : '';
      lines.push(
        `| ${i + 1} | ${t.sprint} | **${t.title}** | ${t.role} | ${t.assigneeName} | ${t.priority || 'Medium'} | ${t.estimatedHours}h | ${t.startDate} → ${t.dueDate} | ${checklistStr} |`
      );
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `WBS_Report_${getTodayIso()}.md`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const pushTasksBatch = async (tasksToPush, isRetryFailed = false) => {
    if (tasksToPush.length === 0 || pushingToTrello) return;
    setErrorBanner('');

    for (let i = 0; i < tasksToPush.length; i++) {
      const check = validateTaskItem(tasksToPush[i]);
      if (!check.isValid) {
        const firstErr = Object.values(check.errors)[0];
        return setErrorBanner(`Task #${i + 1} ("${tasksToPush[i].title || 'Chưa đặt tên'}") chưa hợp lệ: ${firstErr}`);
      }
    }

    if (targetListMode === 'new' && !newListName.trim()) {
      return setErrorBanner('Vui lòng nhập tên cột (List) mới cần tạo trên bảng Trello.');
    }
    if (targetListMode === 'existing' && !selectedListId) {
      return setErrorBanner('Vui lòng chọn cột (List) đích trên bảng Trello.');
    }
    if (!trelloToken.trim()) {
      return setErrorBanner('Vui lòng bấm "🔗 Kết nối tài khoản Trello" trước khi đẩy thẻ.');
    }

    setPushingToTrello(true);
    if (!isRetryFailed) setPushSuccessMsg('');

    try {
      const requestId = window.crypto?.randomUUID
        ? window.crypto.randomUUID()
        : `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });

      const data = await fetchJsonWithTimeout(
        `${API_BASE_URL}/trello/push-tasks`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            requestId,
            targetMode: targetListMode,
            sprintListPrefix: sprintListPrefix.trim(),
            listId: targetListMode === 'existing' ? selectedListId : '',
            newListName: targetListMode === 'new' ? newListName.trim() : '',
            tasks: tasksToPush,
            parentCardName: cardName,
            trelloApiKey: (trelloApiKey || DEFAULT_TRELLO_APP_KEY).trim(),
            trelloToken: trelloToken.trim()
          })
        },
        55000
      );

      if (data.listId && targetListMode === 'new') {
        setSelectedListId(data.listId);
        setTargetListMode('existing');
      }

      if (data.success) {
        setPushSuccessMsg(data.message);
        setFailedCards(Array.isArray(data.failedCards) ? data.failedCards : []);

        // Lưu metadata vào từng Card trên Trello để hiển thị Card Badges ngoài mặt bảng
        if (trello && Array.isArray(data.createdCards)) {
          for (const c of data.createdCards) {
            if (c?.id && c?.meta) {
              trello.set(c.id, 'shared', 'aiTaskMeta', c.meta).catch(() => { });
            }
          }
        }

        await refreshBoardLists();
      } else {
        setFailedCards(Array.isArray(data.failedCards) ? data.failedCards : []);
        setErrorBanner(data.error || 'Không thể tạo thẻ trên Trello.');
      }
    } catch (err) {
      setErrorBanner(err.message || 'Lỗi kết nối khi đẩy dữ liệu lên Trello.');
    } finally {
      setPushingToTrello(false);
    }
  };

  const handleAddDocument = async (e) => {
    e.preventDefault();
    if (uploadingDoc) return;
    setErrorBanner('');

    if (uploadMode === 'file' && !selectedFile) {
      return setErrorBanner('Vui lòng chọn một file tài liệu (.pdf, .txt, .md, .json, .csv).');
    }
    if (uploadMode === 'text' && !manualText.trim()) {
      return setErrorBanner('Vui lòng nhập nội dung tài liệu chuyên môn.');
    }

    setUploadingDoc(true);
    try {
      let options;
      if (uploadMode === 'file') {
        const formData = new FormData();
        formData.append('file', selectedFile);
        const headers = await getAuthHeaders();
        options = { method: 'POST', headers, body: formData };
      } else {
        const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
        options = {
          method: 'POST',
          headers,
          body: JSON.stringify({
            docName: manualDocName.trim() || 'Tài liệu nội bộ',
            textContent: manualText
          })
        };
      }

      const data = await fetchJsonWithTimeout(`${API_BASE_URL}/documents`, options, 60000);
      if (data.success) {
        setSelectedFile(null);
        setManualDocName('');
        setManualText('');
        await fetchDocuments();
      } else {
        setErrorBanner(data.error || 'Lỗi khi nạp tài liệu.');
      }
    } catch (err) {
      setErrorBanner(err.message || 'Không thể tải tài liệu lên Backend.');
    } finally {
      setUploadingDoc(false);
    }
  };

  const handleDeleteDocument = async (docId) => {
    setErrorBanner('');
    try {
      const headers = await getAuthHeaders();
      const data = await fetchJsonWithTimeout(
        `${API_BASE_URL}/documents/${docId}`,
        { method: 'DELETE', headers },
        15000
      );
      if (data.success) {
        fetchDocuments();
      } else {
        setErrorBanner(data.error || 'Không thể xóa tài liệu.');
      }
    } catch (err) {
      setErrorBanner(err.message || 'Lỗi khi xóa tài liệu.');
    }
  };

  return (
    <div id="powerup-content" className="pu-container">
      {/* Thanh điều hướng Tab & Nút chuyển đổi Theme */}
      <div className="pu-tab-bar">
        <button
          type="button"
          onClick={() => { setActiveTab('planner'); setErrorBanner(''); }}
          className={`pu-tab-btn ${activeTab === 'planner' ? 'active' : ''}`}
        >
          📋 Lập kế hoạch Đa Sprint
        </button>
        <button
          type="button"
          onClick={() => { setActiveTab('team'); setErrorBanner(''); }}
          className={`pu-tab-btn ${activeTab === 'team' ? 'active' : ''}`}
        >
          👥 Vai trò nhóm ({boardMembers.length})
        </button>
        <button
          type="button"
          onClick={() => { setActiveTab('knowledge'); setErrorBanner(''); }}
          className={`pu-tab-btn ${activeTab === 'knowledge' ? 'active' : ''}`}
        >
          📚 RAG ({documents.length})
        </button>
        <button
          type="button"
          onClick={() => { setActiveTab('evaluation'); setErrorBanner(''); }}
          className={`pu-tab-btn ${activeTab === 'evaluation' ? 'active' : ''}`}
        >
          📊 Đánh giá
        </button>
        <button
          type="button"
          onClick={() => applyTheme(theme === 'dark' ? 'light' : 'dark')}
          className="pu-theme-toggle-btn"
          title="Chuyển đổi giao diện Sáng / Tối (Tự động đồng bộ với Trello)"
        >
          {theme === 'dark' ? '☀️ Sáng' : '🌙 Tối'}
        </button>
      </div>

      {errorBanner && (
        <div className="pu-error-banner">
          <span>⚠️ {errorBanner}</span>
          <button type="button" onClick={() => setErrorBanner('')} className="pu-close-btn">
            ✕
          </button>
        </div>
      )}

      {/* TAB 1: LẬP KẾ HOẠCH ĐA SPRINT */}
      {activeTab === 'planner' && (
        <div>
          <div className="pu-form-group">
            <label className="pu-label">Tiêu đề dự án / Epic cần phân rã:</label>
            <input
              type="text"
              value={cardName}
              onChange={(e) => setCardName(e.target.value)}
              placeholder="Nhập tên công việc hoặc dự án lớn..."
              className="pu-input"
            />
          </div>

          <div className="pu-form-group">
            <label className="pu-label">Mô tả chi tiết yêu cầu:</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Nhập chi tiết yêu cầu nghiệp vụ, phạm vi chức năng..."
              rows={3}
              className="pu-textarea"
            />
          </div>

          {/* Cấu hình Lộ trình Đa Sprint */}
          <div className="pu-sprint-config-box">
            <div className="pu-section-title">
              🗓️ Cấu hình Lộ trình Đa Sprint (Multi-Sprint Planning):
            </div>
            <div className="pu-sprint-grid">
              <div style={{ flex: '1 1 95px' }}>
                <label className="pu-sub-label">Tiền tố Sprint:</label>
                <input
                  type="text"
                  value={sprintPrefix}
                  onChange={(e) => setSprintPrefix(e.target.value)}
                  placeholder="VD: Sprint"
                  className="pu-input"
                />
              </div>
              <div style={{ flex: '0 0 90px' }}>
                <label className="pu-sub-label">Số Sprint (1-6):</label>
                <input
                  type="number"
                  min="1"
                  max="6"
                  value={sprintCount}
                  onChange={(e) => setSprintCount(e.target.value)}
                  className="pu-input"
                />
              </div>
              <div style={{ flex: '1 1 125px' }}>
                <label className="pu-sub-label">Ngày bắt đầu dự án:</label>
                <input
                  type="date"
                  value={sprintStartDate}
                  onChange={(e) => setSprintStartDate(e.target.value)}
                  className="pu-input"
                />
              </div>
              <div style={{ flex: '0 0 95px' }}>
                <label className="pu-sub-label">Ngày / Sprint:</label>
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={sprintDurationDays}
                  onChange={(e) => setSprintDurationDays(e.target.value)}
                  className="pu-input"
                />
              </div>
            </div>

            <div className="pu-chip-list">
              {plannedSprintSchedule.map((s) => (
                <span key={s.name} className="pu-sprint-chip">
                  <strong>{s.name}:</strong> {s.startDate} → {s.endDate}
                </span>
              ))}
            </div>
          </div>

          {/* Tóm tắt nhân sự */}
          <div className="pu-team-box">
            <div className="pu-team-header">
              <span style={{ fontSize: '12px', fontWeight: 700 }}>
                👥 Nhân sự trên bảng ({boardMembers.length} thành viên):
              </span>
              <button type="button" onClick={() => setActiveTab('team')} className="pu-link-btn">
                ✏️ Chỉnh sửa vai trò
              </button>
            </div>
            {boardMembers.length === 0 ? (
              <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                Đang đọc danh sách thành viên từ Board Trello (hoặc chế độ Local)...
              </span>
            ) : (
              <div className="pu-chip-list">
                {boardMembers.map(member => (
                  <span key={member.id} className="pu-member-chip">
                    <strong>{member.fullName || member.username}</strong>: {memberRoles[member.id] || 'Full-stack'}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Bật/tắt RAG */}
          <div className="pu-rag-toggle-box">
            <label className="pu-checkbox-label">
              <input
                type="checkbox"
                checked={useRag}
                onChange={(e) => setUseRag(e.target.checked)}
              />
              <span>
                <strong>Sử dụng tri thức chuyên môn của Bảng (RAG)</strong> ({documents.length} tài liệu sẵn sàng)
              </span>
            </label>
          </div>

          <button
            type="button"
            onClick={handleBreakdown}
            disabled={loading || !cardName.trim()}
            className="pu-primary-btn"
          >
            {loading
              ? `🤖 AI đang phân tích & chia việc vào ${sprintCount} Sprint...`
              : tasks.length > 0
                ? `🔄 Chia lại Task từ đầu vào ${sprintCount} Sprint bằng AI`
                : `⚡ Tự động phân rã & Chia lộ trình ${sprintCount} Sprint`}
          </button>

          {ragMetadata && (
            <div className="pu-rag-banner">
              {ragMetadata.usedRag ? (
                <span>
                  ✅ Đã tham chiếu <strong>{ragMetadata.matchedChunks.length}</strong> phân đoạn từ tài liệu chuyên môn.
                </span>
              ) : (
                <span>ℹ️ Phân rã theo tiêu chuẩn ngành.</span>
              )}
            </div>
          )}

          {/* Danh sách kết quả WBS gom nhóm theo Sprint */}
          {tasks.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '10px' }}>
              {/* Thanh Cảnh báo Tải Nhân Sự (Workload Capacity Bar) */}
              <div className="pu-workload-box">
                <div className="pu-workload-header">
                  <strong>📊 Cân bằng tải Nhân sự (Workload Capacity • Định mức {standardHoursPerSprint}h / Sprint):</strong>
                </div>
                <div className="pu-workload-list">
                  {memberWorkloadSummary.map((mw) => {
                    const barPercent = Math.min(100, mw.sprintUtilPercent);
                    const statusClass = mw.sprintUtilPercent > 100
                      ? 'overloaded'
                      : mw.sprintUtilPercent >= 80
                        ? 'warning'
                        : 'normal';

                    return (
                      <div key={mw.key} className="pu-workload-item">
                        <div className="pu-workload-top">
                          <span>
                            <strong>👤 {mw.name}</strong> <span className="pu-muted-inline">({mw.role})</span>
                          </span>
                          <span className={`pu-workload-badge ${statusClass}`}>
                            Đỉnh tải {mw.peakSprintName}: {mw.peakSprintHours.toFixed(1)}h / {mw.standardHoursPerSprint}h ({mw.sprintUtilPercent}%)
                            {mw.isOverloaded ? ' ⚠️ Quá tải!' : ''} • Tổng: {mw.totalHours.toFixed(1)}h
                          </span>
                        </div>
                        <div className="pu-workload-track">
                          <div
                            className={`pu-workload-fill ${statusClass}`}
                            style={{ width: `${barPercent}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Thanh Công cụ WBS & Xuất Báo cáo (Excel CSV / Markdown) */}
              <div className="pu-result-header">
                <div>
                  <strong style={{ fontSize: '13px' }}>
                    Lộ trình {groupedSprintBuckets.length} Sprint ({tasks.length} tasks • Tổng: {totalEstimatedHours.toFixed(1)}h)
                  </strong>
                  <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)' }}>
                    💡 Mẹo: Nắm kéo thẻ công việc thả sang khung Sprint khác để tự động dời lịch Start/Due Date.
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={handleExportWbsCsv}
                    className="pu-small-btn export"
                    title="Xuất bảng WBS ra file CSV chuẩn Excel"
                  >
                    📥 Xuất Excel (.csv)
                  </button>
                  <button
                    type="button"
                    onClick={handleExportWbsMarkdown}
                    className="pu-small-btn export"
                    title="Xuất bảng báo cáo định dạng Markdown"
                  >
                    📄 Xuất .md
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddBlankTask()}
                    className="pu-small-btn primary"
                  >
                    ➕ Thêm Task
                  </button>
                  <button
                    type="button"
                    onClick={handleResetTasks}
                    className="pu-small-btn danger"
                  >
                    🗑️ Xóa hết
                  </button>
                </div>
              </div>

              <datalist id="available-sprints-list">
                {availableSprintNames.map(sName => (
                  <option key={sName} value={sName} />
                ))}
              </datalist>

              {groupedSprintBuckets.map((bucket) => {
                const sprintHours = bucket.items.reduce(
                  (sum, item) => sum + (Number(item.task.estimatedHours) || 0),
                  0
                );
                const isDropTarget = dragOverSprint === bucket.sprintName;

                return (
                  <div
                    key={bucket.sprintName}
                    onDragOver={(e) => handleDragOverSprintBucket(e, bucket.sprintName)}
                    onDragLeave={() => setDragOverSprint('')}
                    onDrop={(e) => handleDropOnSprintBucket(e, bucket.sprintName)}
                    className={`pu-sprint-bucket ${isDropTarget ? 'drag-over' : ''}`}
                  >
                    <div className="pu-sprint-bucket-header">
                      <div>
                        <strong style={{ fontSize: '13px', color: 'var(--accent-primary-hover)' }}>
                          🗂️ Cột (List): {sprintListPrefix.trim() ? `${sprintListPrefix.trim()} - ${bucket.sprintName}` : bucket.sprintName}
                        </strong>
                        <span style={{ fontSize: '11.5px', color: 'var(--text-secondary)', marginLeft: '8px' }}>
                          ({bucket.items.length} tasks • {sprintHours.toFixed(1)}h • {bucket.startDate} → {bucket.endDate})
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleAddBlankTask(bucket.sprintName)}
                        className="pu-small-btn primary"
                      >
                        ➕ Thêm vào {bucket.sprintName}
                      </button>
                    </div>

                    <div className="pu-task-list">
                      {bucket.items.length === 0 ? (
                        <div className="pu-empty-dropzone">
                          Kéo thả Task vào đây để chuyển sang {bucket.sprintName}
                        </div>
                      ) : (
                        bucket.items.map(({ task, originalIndex }, localIdx) => {
                          const validation = taskValidationList[originalIndex] || { isValid: true, errors: {} };
                          return (
                            <div
                              key={task._uid || originalIndex}
                              draggable
                              onDragStart={(e) => handleDragStartTask(e, originalIndex)}
                              onDragEnd={() => { setDraggedTaskIndex(null); setDragOverSprint(''); }}
                              className={`pu-task-card ${validation.isValid ? '' : 'invalid'} ${draggedTaskIndex === originalIndex ? 'dragging' : ''}`}
                            >
                              {/* Dòng 1: Tay nắm kéo thả + STT + Tên Task + Độ ưu tiên + Giờ ước tính + Xóa */}
                              <div className="pu-task-top-row">
                                <span className="pu-drag-handle" title="Nắm kéo để chuyển sang Sprint khác">⠿</span>
                                <span className="pu-task-index">#{localIdx + 1}</span>
                                <input
                                  type="text"
                                  value={task.title}
                                  onChange={(e) => handleUpdateTaskField(originalIndex, 'title', e.target.value)}
                                  placeholder="Nhập tên công việc..."
                                  className={`pu-input pu-title-input ${validation.errors.title ? 'input-error' : ''}`}
                                />
                                <select
                                  value={task.priority || 'Medium'}
                                  onChange={(e) => handleUpdateTaskField(originalIndex, 'priority', e.target.value)}
                                  className={`pu-priority-select priority-${(task.priority || 'Medium').toLowerCase()}`}
                                  title="Độ ưu tiên (Tự động gắn Label màu trên Trello)"
                                >
                                  <option value="High">🔥 High</option>
                                  <option value="Medium">⚡ Medium</option>
                                  <option value="Low">🌱 Low</option>
                                </select>
                                <div className="pu-hours-wrap" title="Số giờ ước tính">
                                  <input
                                    type="number"
                                    step="0.5"
                                    min="0.5"
                                    max="200"
                                    value={task.estimatedHours}
                                    onChange={(e) => handleUpdateTaskField(originalIndex, 'estimatedHours', e.target.value)}
                                    className={`pu-input pu-hours-input ${validation.errors.estimatedHours ? 'input-error' : ''}`}
                                  />
                                  <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)' }}>h</span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveTask(originalIndex)}
                                  className="pu-remove-task-btn"
                                  title="Xóa Task này"
                                >
                                  ✕
                                </button>
                              </div>

                              {/* Dòng 2: Mô tả chi tiết */}
                              <textarea
                                rows={2}
                                value={task.description}
                                onChange={(e) => handleUpdateTaskField(originalIndex, 'description', e.target.value)}
                                placeholder="Mô tả chi tiết công việc..."
                                className="pu-textarea"
                              />

                              {/* Dòng 2.5: Checklist (Subtasks / Definition of Done) */}
                              <div className="pu-checklist-box">
                                <div className="pu-checklist-header">
                                  <span>☑️ Checklist / Tiêu chí nghiệm thu ({task.subtasks?.length || 0} bước):</span>
                                  <button
                                    type="button"
                                    onClick={() => handleAddSubtask(originalIndex)}
                                    className="pu-micro-btn"
                                  >
                                    + Thêm bước
                                  </button>
                                </div>
                                <div className="pu-checklist-items">
                                  {(task.subtasks || []).map((st, sIdx) => (
                                    <div key={sIdx} className="pu-checklist-row">
                                      <span className="pu-check-bullet">☐</span>
                                      <input
                                        type="text"
                                        value={st}
                                        onChange={(e) => handleSubtaskChange(originalIndex, sIdx, e.target.value)}
                                        className="pu-input pu-subtask-input"
                                        placeholder="Nhập tiêu chí nghiệm thu hoặc bước thực hiện..."
                                      />
                                      <button
                                        type="button"
                                        onClick={() => handleRemoveSubtask(originalIndex, sIdx)}
                                        className="pu-micro-del-btn"
                                        title="Xóa bước này"
                                      >
                                        ✕
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </div>

                              {/* Dòng 3: Sprint + Start Date + Due Date */}
                              <div className="pu-task-meta-grid">
                                <div style={{ flex: '1 1 105px' }}>
                                  <label className="pu-micro-label">Thuộc Sprint (Cột):</label>
                                  <input
                                    list="available-sprints-list"
                                    value={task.sprint || ''}
                                    onChange={(e) => handleUpdateTaskField(originalIndex, 'sprint', e.target.value)}
                                    placeholder="VD: Sprint 1"
                                    className={`pu-input ${validation.errors.sprint ? 'input-error' : ''}`}
                                    style={{ fontWeight: 700, color: 'var(--accent-primary-hover)' }}
                                  />
                                </div>
                                <div style={{ flex: '1 1 120px' }}>
                                  <label className="pu-micro-label">Bắt đầu (Start):</label>
                                  <input
                                    type="date"
                                    value={task.startDate || ''}
                                    onChange={(e) => handleUpdateTaskField(originalIndex, 'startDate', e.target.value)}
                                    className={`pu-input ${validation.errors.dates ? 'input-error' : ''}`}
                                  />
                                </div>
                                <div style={{ flex: '1 1 120px' }}>
                                  <label className="pu-micro-label">Hạn chót (Due):</label>
                                  <input
                                    type="date"
                                    value={task.dueDate || ''}
                                    onChange={(e) => handleUpdateTaskField(originalIndex, 'dueDate', e.target.value)}
                                    className={`pu-input ${validation.errors.dates ? 'input-error' : ''}`}
                                  />
                                </div>
                              </div>

                              {/* Dòng 4: Giao việc & Vai trò */}
                              <div className="pu-task-footer">
                                <div className="pu-assignee-group">
                                  <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                                    👤 Giao cho:
                                  </span>
                                  <select
                                    value={task.assigneeId || ''}
                                    onChange={(e) => handleChangeTaskAssignee(originalIndex, e.target.value)}
                                    className="pu-assignee-select"
                                  >
                                    <option value="">-- Chưa gán ({task.role || 'Thành viên'}) --</option>
                                    {boardMembers.map(m => (
                                      <option key={m.id} value={m.id}>
                                        {m.fullName || m.username} ({memberRoles[m.id] || 'Thành viên'})
                                      </option>
                                    ))}
                                  </select>

                                  <input
                                    type="text"
                                    value={task.role || ''}
                                    onChange={(e) => handleUpdateTaskField(originalIndex, 'role', e.target.value)}
                                    placeholder="Vai trò..."
                                    className="pu-input pu-role-input"
                                    title="Vai trò đảm nhận Task này (Tự động gắn Label màu)"
                                  />
                                </div>

                                {task.referenceSource && task.referenceSource !== 'Tiêu chuẩn chung' && (
                                  <span className="pu-source-badge">📖 {task.referenceSource}</span>
                                )}
                              </div>

                              {!validation.isValid && (
                                <div className="pu-field-error">
                                  ⚠️ {Object.values(validation.errors).join(' • ')}
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Khung cấu hình đẩy các Sprint lên Trello (Tích hợp OAuth 1-Click) */}
              <div className="pu-push-box">
                <div className="pu-section-title">
                  🚀 Tự động tạo Cột Sprint, Checklist (DoD), Nhãn màu & Giao thẻ lên Trello
                </div>

                {/* Khối Kết nối OAuth 1-Click */}
                <div className="pu-oauth-bar">
                  {isOAuthConnected && trelloToken ? (
                    <div className="pu-oauth-connected">
                      <span>✅ <strong>Đã kết nối tài khoản Trello</strong> (Sẵn sàng đẩy thẻ, Checklist & Nhãn màu)</span>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          type="button"
                          onClick={() => setShowCredentials(!showCredentials)}
                          className="pu-link-btn"
                        >
                          ⚙️ Nâng cao
                        </button>
                        <button
                          type="button"
                          onClick={handleDisconnectOAuth}
                          className="pu-link-btn danger-text"
                        >
                          Ngắt kết nối
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="pu-oauth-disconnected">
                      <div>
                        <strong>🔗 Kết nối Trello 1-Click (OAuth):</strong>
                        <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-secondary)' }}>
                          Cấp quyền nhanh chỉ với 1 nút bấm, không cần tự copy-paste API Key / Token.
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <button
                          type="button"
                          onClick={handleOneClickOAuth}
                          className="pu-oauth-btn"
                        >
                          🔗 Kết nối tài khoản Trello
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowCredentials(!showCredentials)}
                          className="pu-link-btn"
                        >
                          Nhập thủ công
                        </button>
                      </div>
                    </div>
                  )}

                  {showCredentials && (
                    <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <input
                        type="text"
                        value={trelloApiKey}
                        onChange={(e) => handleSaveCredentials(e.target.value, trelloToken)}
                        placeholder="Trello API Key (Tùy chọn nếu đã cấu hình VITE_TRELLO_API_KEY)"
                        className="pu-input"
                      />
                      <input
                        type="password"
                        value={trelloToken}
                        onChange={(e) => handleSaveCredentials(trelloApiKey, e.target.value)}
                        placeholder="Dán Trello Token vào đây (Hoặc bấm nút Kết nối 1-Click ở trên)"
                        className="pu-input"
                      />
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => setTargetListMode('sprint_lists')}
                    className={`pu-subtab-btn ${targetListMode === 'sprint_lists' ? 'active' : ''}`}
                  >
                    🗂️ Mỗi Sprint 1 cột riêng ({groupedSprintBuckets.length} cột)
                  </button>
                  <button
                    type="button"
                    onClick={() => setTargetListMode('existing')}
                    className={`pu-subtab-btn ${targetListMode === 'existing' ? 'active' : ''}`}
                  >
                    📂 Gộp vào 1 cột có sẵn
                  </button>
                  <button
                    type="button"
                    onClick={() => setTargetListMode('new')}
                    className={`pu-subtab-btn ${targetListMode === 'new' ? 'active' : ''}`}
                  >
                    ➕ Gộp vào 1 cột mới
                  </button>
                </div>

                {targetListMode === 'sprint_lists' && (
                  <div className="pu-form-group">
                    <label className="pu-label">
                      Tiền tố cho các cột Sprint trên Trello (Tùy chọn - để trống sẽ đặt tên cột là {groupedSprintBuckets.map(b => `"${b.sprintName}"`).join(', ')}):
                    </label>
                    <input
                      type="text"
                      value={sprintListPrefix}
                      onChange={(e) => setSprintListPrefix(e.target.value)}
                      placeholder="VD: Dự án Thanh toán (Sẽ tạo cột: Dự án Thanh toán - Sprint 1...)"
                      className="pu-input"
                    />
                  </div>
                )}

                {targetListMode === 'existing' && (
                  <div className="pu-form-group">
                    <label className="pu-label">Chọn cột trên bảng để đổ tất cả thẻ công việc vào:</label>
                    <select
                      value={selectedListId}
                      onChange={(e) => setSelectedListId(e.target.value)}
                      className="pu-select"
                    >
                      {boardLists.map(list => (
                        <option key={list.id} value={list.id}>
                          {list.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {targetListMode === 'new' && (
                  <div className="pu-form-group">
                    <label className="pu-label">Tên cột (List) mới sẽ tạo trên bảng:</label>
                    <input
                      type="text"
                      value={newListName}
                      onChange={(e) => setNewListName(e.target.value)}
                      placeholder="VD: WBS - Công việc đã phân rã"
                      className="pu-input"
                    />
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => pushTasksBatch(tasks, false)}
                  disabled={pushingToTrello || hasAnyInvalidTask || tasks.length === 0}
                  className="pu-primary-btn pu-push-btn"
                >
                  {pushingToTrello
                    ? '⏳ Đang tạo cột Sprint, điền thẻ, gắn Nhãn màu & tạo Checklist...'
                    : hasAnyInvalidTask
                      ? '⚠️ Vui lòng sửa các thông tin chưa hợp lệ ở trên'
                      : targetListMode === 'sprint_lists'
                        ? `✅ Đẩy ${groupedSprintBuckets.length} cột Sprint • ${tasks.length} thẻ (Kèm Checklist & Label màu)`
                        : `✅ Tạo ${tasks.length} thẻ (${totalEstimatedHours.toFixed(1)}h) lên Trello ngay`}
                </button>

                {pushSuccessMsg && (
                  <div className="pu-success-banner">
                    🎉 {pushSuccessMsg}
                  </div>
                )}

                {failedCards.length > 0 && (
                  <div className="pu-retry-box">
                    <div style={{ fontSize: '11.5px', color: 'var(--danger-hover)', marginBottom: '8px' }}>
                      <strong>Có {failedCards.length} thẻ chưa tạo được:</strong>
                      <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                        {failedCards.map((fc, i) => (
                          <li key={i}>{fc.title} ({fc.reason})</li>
                        ))}
                      </ul>
                    </div>
                    <button
                      type="button"
                      disabled={pushingToTrello}
                      onClick={() => pushTasksBatch(failedCards.map(f => f.task), true)}
                      className="pu-retry-btn"
                    >
                      🔄 Thử lại {failedCards.length} thẻ lỗi
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <EvaluationPanel
        active={activeTab === 'evaluation'}
        latest={latestEvaluation}
        requestBreakdown={requestBreakdown}
        onResize={resizeTrelloIframe}
        isGenerating={loading}
      />

      {/* TAB 2: PHÂN VAI TRÒ NHÓM */}
      {activeTab === 'team' && (
        <div>
          <h4 style={{ fontSize: '14px', marginBottom: '6px' }}>
            Phân vai trò thành viên trong Board ({boardMembers.length})
          </h4>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
            Thiết lập chức vụ chuyên môn cho từng thành viên trên bảng Trello. AI sẽ dựa vào vai trò này để giao đúng việc trong từng Sprint và gắn Nhãn màu tương ứng.
          </p>

          {boardMembers.length === 0 ? (
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
              Không tìm thấy thành viên nào hoặc Power-Up đang chạy ngoài môi trường Board Trello.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {boardMembers.map(member => (
                <div key={member.id} className="pu-member-row">
                  <div style={{ flex: 1 }}>
                    <strong style={{ fontSize: '13px', display: 'block' }}>
                      👤 {member.fullName || member.username}
                    </strong>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>@{member.username}</span>
                  </div>

                  <div style={{ flex: 1.3 }}>
                    <input
                      list={`role-suggestions-${member.id}`}
                      value={memberRoles[member.id] || ''}
                      onChange={(e) => handleRoleChange(member.id, e.target.value)}
                      placeholder="Nhập hoặc chọn vai trò..."
                      className="pu-input"
                    />
                    <datalist id={`role-suggestions-${member.id}`}>
                      {SUGGESTED_ROLES.map(role => (
                        <option key={role} value={role} />
                      ))}
                    </datalist>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: QUẢN LÝ KHO TRI THỨC RAG */}
      {activeTab === 'knowledge' && (
        <div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
            <button
              type="button"
              onClick={() => setUploadMode('file')}
              className={`pu-subtab-btn ${uploadMode === 'file' ? 'active' : ''}`}
            >
              📄 Tải File (.pdf, .txt, .md)
            </button>
            <button
              type="button"
              onClick={() => setUploadMode('text')}
              className={`pu-subtab-btn ${uploadMode === 'text' ? 'active' : ''}`}
            >
              ✍️ Nhập văn bản trực tiếp
            </button>
          </div>

          <form onSubmit={handleAddDocument} className="pu-upload-box">
            {uploadMode === 'file' ? (
              <div className="pu-form-group">
                <label className="pu-label">Chọn tài liệu đặc tả / quy chuẩn (.pdf, .txt, .md, tối đa 10MB):</label>
                <input
                  type="file"
                  accept=".pdf,.txt,.md,.json,.csv"
                  onChange={(e) => setSelectedFile(e.target.files[0])}
                  className="pu-file-input"
                />
              </div>
            ) : (
              <>
                <div className="pu-form-group">
                  <label className="pu-label">Tên tài liệu / Quy chuẩn:</label>
                  <input
                    type="text"
                    value={manualDocName}
                    onChange={(e) => setManualDocName(e.target.value)}
                    placeholder="VD: Quy chuẩn API Backend & Database"
                    className="pu-input"
                  />
                </div>
                <div className="pu-form-group">
                  <label className="pu-label">Nội dung chuyên môn:</label>
                  <textarea
                    value={manualText}
                    onChange={(e) => setManualText(e.target.value)}
                    placeholder="Dán nội dung kiến trúc, quy trình test, coding convention vào đây..."
                    rows={4}
                    className="pu-textarea"
                  />
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={uploadingDoc}
              className="pu-primary-btn pu-push-btn"
            >
              {uploadingDoc ? '⏳ Đang băm nhỏ & tạo Vector Embedding...' : '➕ Nạp vào Bộ nhớ Tri thức của Bảng'}
            </button>
          </form>

          <h4 style={{ fontSize: '13px', margin: '14px 0 8px 0' }}>
            Tài liệu của Bảng này ({documents.length}):
          </h4>
          {documents.length === 0 ? (
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
              Chưa có tài liệu chuyên môn nào trên bảng này. Hãy tải lên SRS, SDS hoặc quy chuẩn kỹ thuật.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
              {documents.map((doc) => (
                <div key={doc.docId} className="pu-doc-item">
                  <div>
                    <strong style={{ fontSize: '12.5px', display: 'block' }}>📘 {doc.docName}</strong>
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      {doc.chunkCount} vector chunks • {new Date(doc.createdAt).toLocaleDateString('vi-VN')}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteDocument(doc.docId)}
                    className="pu-small-btn danger"
                    title="Xóa tài liệu"
                  >
                    Xóa
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default App;