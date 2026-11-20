import React, { useState, useMemo } from 'react';

// Hàm tính số ngày giữa 2 chuỗi YYYY-MM-DD
function parseDateIso(str) {
  if (!str || typeof str !== 'string') return null;
  const parts = str.slice(0, 10).split('-');
  if (parts.length !== 3) return null;
  return new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
}

function formatDateDisplay(d) {
  if (!d) return '';
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
}

function getDayOfWeekName(d) {
  const day = d.getUTCDay();
  const names = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  return names[day];
}

const SPRINT_PALETTES = [
  { bg: 'linear-gradient(135deg, #388bfd 0%, #1f6feb 100%)', border: '#58a6ff', text: '#ffffff' },
  { bg: 'linear-gradient(135deg, #2ea043 0%, #238636 100%)', border: '#3fb950', text: '#ffffff' },
  { bg: 'linear-gradient(135deg, #a371f7 0%, #8957e5 100%)', border: '#bc8cff', text: '#ffffff' },
  { bg: 'linear-gradient(135deg, #d29922 0%, #bb8009 100%)', border: '#e3b341', text: '#ffffff' },
  { bg: 'linear-gradient(135deg, #db61a2 0%, #bf4b8a 100%)', border: '#f778ba', text: '#ffffff' },
  { bg: 'linear-gradient(135deg, #39c5cf 0%, #1b7c83 100%)', border: '#56d4dd', text: '#ffffff' }
];

export default function GanttChart({ tasks = [], sprintSchedule = [] }) {
  const [viewMode, setViewMode] = useState('day'); // 'day' | 'week'
  const [filterSprint, setFilterSprint] = useState('ALL');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [hoveredTask, setHoveredTask] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  // 1. Lọc danh sách task
  const filteredTasks = useMemo(() => {
    return tasks.filter(t => {
      if (filterSprint !== 'ALL' && t.sprint !== filterSprint) return false;
      if (searchKeyword.trim()) {
        const kw = searchKeyword.toLowerCase();
        const matchTitle = (t.title || '').toLowerCase().includes(kw);
        const matchAssignee = (t.assigneeName || '').toLowerCase().includes(kw);
        const matchRole = (t.role || '').toLowerCase().includes(kw);
        if (!matchTitle && !matchAssignee && !matchRole) return false;
      }
      return true;
    });
  }, [tasks, filterSprint, searchKeyword]);

  // 2. Tính toán dải ngày bao phủ toàn bộ dự án
  const { startDate, endDate, totalDays, dayList } = useMemo(() => {
    let minD = null;
    let maxD = null;

    // Xét theo sprintSchedule
    sprintSchedule.forEach(s => {
      const sD = parseDateIso(s.startDate);
      const eD = parseDateIso(s.endDate);
      if (sD && (!minD || sD < minD)) minD = sD;
      if (eD && (!maxD || eD > maxD)) maxD = eD;
    });

    // Xét theo tasks
    tasks.forEach(t => {
      const sD = parseDateIso(t.startDate);
      const eD = parseDateIso(t.dueDate);
      if (sD && (!minD || sD < minD)) minD = sD;
      if (eD && (!maxD || eD > maxD)) maxD = eD;
    });

    // Mặc định nếu không có ngày
    if (!minD) minD = new Date();
    if (!maxD) {
      maxD = new Date(minD);
      maxD.setUTCDate(maxD.getUTCDate() + 14);
    }

    // Thêm 1 ngày đệm để render đẹp
    const extendedMax = new Date(maxD);
    extendedMax.setUTCDate(extendedMax.getUTCDate() + 1);

    const diffMs = extendedMax.getTime() - minD.getTime();
    const daysCount = Math.max(7, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

    const days = [];
    for (let i = 0; i < daysCount; i++) {
      const cur = new Date(minD);
      cur.setUTCDate(cur.getUTCDate() + i);
      days.push(cur);
    }

    return {
      startDate: minD,
      endDate: extendedMax,
      totalDays: daysCount,
      dayList: days
    };
  }, [tasks, sprintSchedule]);

  // Nhóm tasks theo Sprint
  const groupedTasksBySprint = useMemo(() => {
    const groups = new Map();
    filteredTasks.forEach((task, idx) => {
      const sName = task.sprint || 'Sprint 1';
      if (!groups.has(sName)) {
        groups.set(sName, []);
      }
      groups.get(sName).push({ task, originalIndex: idx });
    });
    return Array.from(groups.entries()).map(([sprintName, items]) => ({
      sprintName,
      items
    }));
  }, [filteredTasks]);

  const uniqueSprintNames = useMemo(() => {
    const set = new Set();
    tasks.forEach(t => t.sprint && set.add(t.sprint));
    return Array.from(set);
  }, [tasks]);

  // Tính vị trí left và width theo % trên timeline
  const computeBarPosition = (taskStartStr, taskDueStr) => {
    const sD = parseDateIso(taskStartStr) || startDate;
    const eD = parseDateIso(taskDueStr) || sD;

    const startOffsetDays = Math.max(0, (sD.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const durationDays = Math.max(1, ((eD.getTime() - sD.getTime()) / (1000 * 60 * 60 * 24)) + 1);

    const leftPercent = Math.min(100, Math.max(0, (startOffsetDays / totalDays) * 100));
    const widthPercent = Math.min(100 - leftPercent, Math.max(1.5, (durationDays / totalDays) * 100));

    return {
      left: `${leftPercent}%`,
      width: `${widthPercent}%`,
      durationDays
    };
  };

  const dayWidthPx = viewMode === 'day' ? 36 : 18;
  const timelineMinWidthPx = totalDays * dayWidthPx;

  // Hôm nay marker
  const todayIso = new Date().toISOString().slice(0, 10);
  const todayDate = parseDateIso(todayIso);
  const todayOffsetDays = todayDate ? (todayDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24) : -1;
  const isTodayInRange = todayOffsetDays >= 0 && todayOffsetDays < totalDays;
  const todayPercent = isTodayInRange ? (todayOffsetDays / totalDays) * 100 : 0;

  return (
    <div className="pu-gantt-container">
      {/* 1. THANH CÔNG CỤ ĐIỀU KHIỂN GANTT */}
      <div className="pu-gantt-toolbar">
        <div className="pu-gantt-toolbar-left">
          <span className="pu-gantt-badge">📊 Gantt Timeline</span>
          <span className="pu-gantt-subinfo">
            Tổng {totalDays} ngày ({formatDateDisplay(startDate)} → {formatDateDisplay(endDate)}) • {filteredTasks.length} tasks
          </span>
        </div>

        <div className="pu-gantt-toolbar-right">
          {/* Lọc theo Sprint */}
          <select
            value={filterSprint}
            onChange={(e) => setFilterSprint(e.target.value)}
            className="pu-gantt-select"
            title="Lọc theo Sprint"
          >
            <option value="ALL">Tất cả Sprint ({uniqueSprintNames.length})</option>
            {uniqueSprintNames.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          {/* Ô tìm kiếm task */}
          <input
            type="text"
            placeholder="🔍 Tìm task, người phụ trách..."
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            className="pu-gantt-search"
          />

          {/* Chế độ thu phóng */}
          <div className="pu-gantt-zoom-group">
            <button
              type="button"
              onClick={() => setViewMode('day')}
              className={`pu-gantt-zoom-btn ${viewMode === 'day' ? 'active' : ''}`}
            >
              Ngày
            </button>
            <button
              type="button"
              onClick={() => setViewMode('week')}
              className={`pu-gantt-zoom-btn ${viewMode === 'week' ? 'active' : ''}`}
            >
              Tuần
            </button>
          </div>
        </div>
      </div>

      {/* 2. KHUNG CUỘN BIỂU ĐỒ GANTT */}
      <div className="pu-gantt-viewport">
        <div className="pu-gantt-layout" style={{ minWidth: `${timelineMinWidthPx + 280}px` }}>
          {/* CỘT TRÁI: DANH SÁCH TÊN TASK (STICKY) */}
          <div className="pu-gantt-sidebar">
            <div className="pu-gantt-sidebar-header">
              <span>Công việc / Hạng mục</span>
              <span>Thời lượng</span>
            </div>

            {groupedTasksBySprint.map(({ sprintName, items }) => (
              <div key={sprintName} className="pu-gantt-sprint-section">
                <div className="pu-gantt-sidebar-sprint-title">
                  <span>📂 {sprintName}</span>
                  <span className="pu-sprint-count-tag">{items.length} tasks</span>
                </div>

                {items.map(({ task }, taskIdx) => (
                  <div
                    key={task._uid || taskIdx}
                    className="pu-gantt-sidebar-row"
                    title={task.title}
                  >
                    <div className="pu-gantt-task-name-col">
                      <span className="pu-gantt-task-idx">#{taskIdx + 1}</span>
                      <span className="pu-gantt-task-title-text">{task.title}</span>
                    </div>
                    <div className="pu-gantt-task-hours-col">
                      <span className="pu-gantt-hours-badge">{task.estimatedHours || 2}h</span>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* CỘT PHẢI: TRỤC THỜI GIAN & BARS */}
          <div className="pu-gantt-timeline-area">
            {/* Hàng ngày & Thứ */}
            <div className="pu-gantt-timeline-header">
              {dayList.map((day, idx) => {
                const dayOfWeek = getDayOfWeekName(day);
                const isWeekend = dayOfWeek === 'T7' || dayOfWeek === 'CN';
                const isToday = isTodayInRange && idx === Math.floor(todayOffsetDays);

                return (
                  <div
                    key={idx}
                    className={`pu-gantt-day-col-header ${isWeekend ? 'weekend' : ''} ${isToday ? 'today' : ''}`}
                    style={{ width: `${100 / totalDays}%` }}
                  >
                    <span className="pu-gantt-day-num">{day.getUTCDate()}</span>
                    <span className="pu-gantt-day-name">{dayOfWeek}</span>
                  </div>
                );
              })}
            </div>

            {/* Vùng các thanh Task Bars theo từng Sprint */}
            <div className="pu-gantt-bars-container">
              {/* Lưới kẻ dọc nền ngày */}
              <div className="pu-gantt-grid-lines">
                {dayList.map((day, idx) => {
                  const dayOfWeek = getDayOfWeekName(day);
                  const isWeekend = dayOfWeek === 'T7' || dayOfWeek === 'CN';
                  return (
                    <div
                      key={idx}
                      className={`pu-gantt-grid-line ${isWeekend ? 'weekend' : ''}`}
                      style={{ left: `${(idx / totalDays) * 100}%` }}
                    />
                  );
                })}
                {/* Đường Hôm nay */}
                {isTodayInRange && (
                  <div
                    className="pu-gantt-today-marker"
                    style={{ left: `${todayPercent}%` }}
                    title={`Hôm nay (${todayIso})`}
                  >
                    <span className="pu-gantt-today-tag">Hôm nay</span>
                  </div>
                )}
              </div>

              {/* Từng nhóm Sprint */}
              {groupedTasksBySprint.map(({ sprintName, items }, sprintIdx) => {
                const palette = SPRINT_PALETTES[sprintIdx % SPRINT_PALETTES.length];

                return (
                  <div key={sprintName} className="pu-gantt-sprint-bars-group">
                    {/* Dòng tiêu đề Sprint trên timeline */}
                    <div className="pu-gantt-sprint-timeline-spacer" />

                    {/* Dòng các task bar */}
                    {items.map(({ task }, taskIdx) => {
                      const pos = computeBarPosition(task.startDate, task.dueDate);
                      const isLongTask = Number(task.estimatedHours) >= 35;

                      return (
                        <div key={task._uid || taskIdx} className="pu-gantt-bar-row">
                          <div
                            className={`pu-gantt-bar-wrapper ${isLongTask ? 'long-task' : ''}`}
                            style={{
                              left: pos.left,
                              width: pos.width,
                              background: palette.bg,
                              borderColor: palette.border,
                              color: palette.text
                            }}
                            onMouseEnter={(e) => {
                              const rect = e.currentTarget.getBoundingClientRect();
                              setTooltipPos({ x: rect.left, y: rect.bottom + 6 });
                              setHoveredTask(task);
                            }}
                            onMouseLeave={() => setHoveredTask(null)}
                          >
                            <span className="pu-gantt-bar-title">
                              {task.title} ({task.estimatedHours || 2}h)
                            </span>
                            <span className="pu-gantt-bar-assignee">
                              👤 {task.assigneeName || 'Chưa gán'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 3. TOOLTIP THÔNG TIN CHI TIẾT KHI RÊ CHUỘT VÀO THANH TASK */}
      {hoveredTask && (
        <div
          className="pu-gantt-tooltip"
          style={{
            top: `${tooltipPos.y}px`,
            left: `${Math.min(window.innerWidth - 320, Math.max(10, tooltipPos.x))}px`
          }}
        >
          <div className="pu-gantt-tooltip-header">
            <strong>{hoveredTask.title}</strong>
            <span className="pu-gantt-tooltip-badge">{hoveredTask.sprint || 'Sprint'}</span>
          </div>

          <div className="pu-gantt-tooltip-meta">
            <div>👤 <strong>Phụ trách:</strong> {hoveredTask.assigneeName || 'Chưa gán'} ({hoveredTask.role || 'Thành viên'})</div>
            <div>⏱️ <strong>Thời lượng:</strong> {hoveredTask.estimatedHours || 2} giờ</div>
            <div>📅 <strong>Khoảng thời gian:</strong> {hoveredTask.startDate || 'Chưa đặt'} → {hoveredTask.dueDate || 'Chưa đặt'}</div>
            {hoveredTask.deliverables && (
              <div style={{ marginTop: '4px' }}>
                📦 <strong>Đầu ra:</strong> {hoveredTask.deliverables}
              </div>
            )}
            {hoveredTask.referenceSource && hoveredTask.referenceSource !== 'Tiêu chuẩn chung' && (
              <div>📚 <strong>Tham chiếu:</strong> {hoveredTask.referenceSource}</div>
            )}
          </div>

          {Array.isArray(hoveredTask.acceptanceCriteria) && hoveredTask.acceptanceCriteria.length > 0 && (
            <div className="pu-gantt-tooltip-dod">
              <strong>✅ Tiêu chí nghiệm thu (DoD):</strong>
              <ul>
                {hoveredTask.acceptanceCriteria.slice(0, 3).map((ac, i) => (
                  <li key={i}>{ac}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* 4. CHÚ THÍCH (LEGEND) */}
      <div className="pu-gantt-legend">
        <div className="pu-gantt-legend-item">
          <span className="pu-gantt-legend-swatch today-line" />
          <span>Hôm nay</span>
        </div>
        <div className="pu-gantt-legend-item">
          <span className="pu-gantt-legend-swatch weekend-box" />
          <span>Cuối tuần</span>
        </div>
        {uniqueSprintNames.map((s, idx) => {
          const pal = SPRINT_PALETTES[idx % SPRINT_PALETTES.length];
          return (
            <div key={s} className="pu-gantt-legend-item">
              <span className="pu-gantt-legend-swatch" style={{ background: pal.bg, border: `1px solid ${pal.border}` }} />
              <span>{s}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
