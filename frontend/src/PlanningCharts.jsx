import React, { useEffect, useMemo, useState } from 'react';
import { sprintCapacityHours } from '../../wbs_eval_suite/evaluateWbs.mjs';

const DAY = 86_400_000;
const PAGE_SIZE = 8;
const dateLabel = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
const hoursLabel = value => value.toLocaleString('vi-VN', { maximumFractionDigits: 1 });

function dateValue(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return NaN;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : NaN;
}

function GanttChart({ tasks, sprintSchedule }) {
  const [query, setQuery] = useState('');
  const [sprintName, setSprintName] = useState('');
  const term = query.trim().toLowerCase();
  const matching = tasks.filter(task => (!sprintName || task.sprint === sprintName)
    && [task.title, task.assigneeName, task.role].some(text => (text || '').toLowerCase().includes(term)));
  const scheduled = sprintName ? sprintSchedule.filter(sprint => sprint.name === sprintName) : sprintSchedule;
  const bounds = [...scheduled.map(sprint => [dateValue(sprint.startDate), dateValue(sprint.endDate)]),
    ...matching.map(task => [dateValue(task.startDate), dateValue(task.dueDate)])]
    .reduce(([first, last], [start, end]) => {
      if (!Number.isFinite(start) || end < start || !Number.isFinite(end)) return [first, last];
      return [Math.min(first, start), Math.max(last, end)];
    }, [Infinity, -Infinity]);
  const [first, last] = bounds;
  const days = (last - first) / DAY + 1;
  const ticks = days > 0 ? Array.from({ length: Math.min(6, days) }, (_, index) =>
    first + Math.round(index * (days - 1) / Math.max(1, Math.min(6, days) - 1)) * DAY) : [];

  return (
    <section aria-label="Lịch Gantt">
      <div className="pu-chart-controls">
        <label>Tìm công việc<input className="pu-input" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <label>Lọc lịch theo Sprint
          <select className="pu-input" value={sprintName} onChange={event => setSprintName(event.target.value)}>
            <option value="">Tất cả Sprint</option>
            {[...new Set(tasks.map(task => task.sprint).filter(Boolean))].map(name => <option key={name}>{name}</option>)}
          </select>
        </label>
      </div>
      {matching.length === 0 ? <p>Không có công việc khớp bộ lọc.</p> : (
        <div className="pu-chart-scroll" tabIndex={0} aria-label="Biểu đồ ngày bắt đầu và kết thúc">
          <div className="pu-gantt-row">
            <strong>Công việc</strong>
            <div className="pu-gantt-axis">{ticks.map(timestamp => <span key={timestamp}>{dateLabel.format(timestamp)}</span>)}</div>
          </div>
          {matching.map((task, index) => {
            const start = dateValue(task.startDate);
            const end = dateValue(task.dueDate);
            const valid = Number.isFinite(start) && Number.isFinite(end) && end >= start;
            const dates = valid ? `${task.startDate} → ${task.dueDate}` : 'Chưa có lịch hợp lệ';
            return (
              <div className="pu-gantt-row" key={task._uid || index}>
                <div><strong>{task.title}</strong><div className="pu-chart-muted">{task.sprint || 'Chưa có Sprint'} · {task.assigneeName || 'Chưa phân công'}</div></div>
                <div className="pu-gantt-track" aria-label={dates} title={dates}>
                  {valid && <span aria-hidden="true" className="pu-gantt-bar" style={{
                    left: `${(start - first) / DAY / days * 100}%`,
                    width: `${((end - start) / DAY + 1) / days * 100}%`,
                  }} />}
                  <span className="pu-gantt-dates">{dates}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function WorkloadHeatmap({ tasks, sprintSchedule, boardMembers, onResize }) {
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(null);
  useEffect(onResize, [onResize, page, selected]);
  const { rows, sprints, assigned } = useMemo(() => {
    const members = new Map(boardMembers.map(member => [member.id, member.fullName || member.username || 'Thành viên']));
    const sprints = new Map(sprintSchedule.map(sprint => [sprint.name,
      sprintCapacityHours((dateValue(sprint.endDate) - dateValue(sprint.startDate)) / DAY + 1)]));
    const assigned = new Map();
    for (const task of tasks) {
      const sprint = task.sprint || 'Chưa có Sprint';
      if (!sprints.has(sprint)) sprints.set(sprint, null);
      const member = members.has(task.assigneeId) ? task.assigneeId : null;
      if (!assigned.has(member)) assigned.set(member, new Map());
      const assignments = assigned.get(member);
      if (!assignments.has(sprint)) assignments.set(sprint, []);
      assignments.get(sprint).push(task);
    }
    return {
      rows: [...members, ...(assigned.has(null) ? [[null, 'Chưa phân công']] : [])],
      sprints: [...sprints],
      assigned,
    };
  }, [tasks, sprintSchedule, boardMembers]);

  const activePage = Math.min(page, Math.max(0, Math.ceil(sprints.length / PAGE_SIZE) - 1));
  const pageSprints = sprints.slice(activePage * PAGE_SIZE, (activePage + 1) * PAGE_SIZE);
  const selectedTasks = selected && assigned.get(selected.member)?.get(selected.sprint);
  const memberName = selected && rows.find(([id]) => id === selected.member)?.[1];

  return (
    <section aria-label="Khối lượng theo Sprint">
      <p>Ô màu đỏ là khối lượng vượt định mức của Sprint. Bấm vào số giờ để xem công việc.</p>
      {sprints.length > PAGE_SIZE && (
        <div className="pu-chart-controls">
          <button type="button" className="pu-tab-btn" disabled={activePage === 0} onClick={() => setPage(activePage - 1)}>Sprint trước</button>
          <span>{activePage * PAGE_SIZE + 1}–{activePage * PAGE_SIZE + pageSprints.length}/{sprints.length} Sprint</span>
          <button type="button" className="pu-tab-btn" disabled={(activePage + 1) * PAGE_SIZE >= sprints.length} onClick={() => setPage(activePage + 1)}>Sprint sau</button>
        </div>
      )}
      <div className="pu-chart-scroll pu-load-grid" tabIndex={0} aria-label="Bảng giờ công theo người và Sprint">
        <table>
          <thead><tr><th scope="col">Người phụ trách</th>{pageSprints.map(([sprint]) => <th scope="col" key={sprint}>{sprint}</th>)}</tr></thead>
          <tbody>
            {rows.map(([member, name]) => (
              <tr key={member ?? 'unassigned'}>
                <th scope="row">{name}</th>
                {pageSprints.map(([sprint, capacity]) => {
                  const assignments = assigned.get(member)?.get(sprint) || [];
                  const hours = assignments.reduce((sum, task) => sum + (Number(task.estimatedHours) || 0), 0);
                  const limit = member ? capacity : null;
                  const level = limit && hours > limit ? 'over' : limit && hours >= limit * 0.8 ? 'high' : '';
                  const isSelected = selected?.member === member && selected?.sprint === sprint;
                  return (
                    <td className={level} key={sprint}>
                      {assignments.length ? <button type="button" className="pu-tab-btn" aria-pressed={isSelected}
                        aria-label={`${name}, ${sprint}: ${hoursLabel(hours)} giờ${limit ? ` trên ${limit} giờ` : ''}`}
                        onClick={() => setSelected(isSelected ? null : { member, sprint })}>
                        {hoursLabel(hours)}{limit ? `/${limit}` : ''}h
                      </button> : <span>{limit ? `0/${limit}h` : '—'}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selectedTasks && memberName && (
        <div className="pu-chart-selection">
          <strong>{memberName} · {selected.sprint}</strong>
          <ul>{selectedTasks.map((task, index) => <li key={task._uid || index}>{task.title} · {hoursLabel(Number(task.estimatedHours) || 0)}h</li>)}</ul>
        </div>
      )}
    </section>
  );
}

export default function PlanningCharts({ mode, tasks, sprintSchedule, boardMembers, onResize }) {
  useEffect(onResize, [onResize, mode]);
  return mode === 'gantt'
    ? <GanttChart tasks={tasks} sprintSchedule={sprintSchedule} />
    : <WorkloadHeatmap tasks={tasks} sprintSchedule={sprintSchedule} boardMembers={boardMembers} onResize={onResize} />;
}
