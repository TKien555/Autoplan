import React, { useState, useMemo } from 'react';

// Ngưỡng năng lực chuẩn PMP cho Sprint 2 tuần (80h tối đa, 30-45h tập trung)
const CAPACITY_THRESHOLDS = {
  STARVED: 0,
  LIGHT: 20,
  OPTIMAL_MAX: 45,
  MODERATE_MAX: 55
};

function getCapacityLevel(hours) {
  if (hours <= 0) return { level: 'starved', label: 'Nhàn rỗi (0h)', colorClass: 'cell-starved', tag: '⚠️ 0h' };
  if (hours < CAPACITY_THRESHOLDS.LIGHT) return { level: 'light', label: 'Tải nhẹ (<20h)', colorClass: 'cell-light', tag: 'Thấp' };
  if (hours <= CAPACITY_THRESHOLDS.OPTIMAL_MAX) return { level: 'optimal', label: 'Cân bằng PMP (20-45h)', colorClass: 'cell-optimal', tag: '✅ Lý tưởng' };
  if (hours <= CAPACITY_THRESHOLDS.MODERATE_MAX) return { level: 'moderate', label: 'Tiệm cận giới hạn (46-55h)', colorClass: 'cell-moderate', tag: '🟡 Cao' };
  return { level: 'overloaded', label: 'Quá tải (>55h)', colorClass: 'cell-overloaded', tag: '🔥 Quá tải' };
}

export default function WorkloadHeatmap({ tasks = [], boardMembers = [], memberRoles = {}, availableSprintNames = [] }) {
  const [selectedCell, setSelectedCell] = useState(null); // { memberName, sprintName, tasks, hours }

  // 1. Thu thập danh sách Sprint
  const sprints = useMemo(() => {
    if (availableSprintNames && availableSprintNames.length > 0) {
      return availableSprintNames;
    }
    const set = new Set();
    tasks.forEach(t => t.sprint && set.add(t.sprint));
    return Array.from(set).length > 0 ? Array.from(set) : ['Sprint 1', 'Sprint 2'];
  }, [availableSprintNames, tasks]);

  // 2. Thu thập danh sách thành viên (từ boardMembers + từ tasks)
  const memberList = useMemo(() => {
    const map = new Map();

    // Thêm từ boardMembers trước
    boardMembers.forEach(m => {
      const name = m.fullName || m.username || 'Thành viên';
      map.set(name, {
        id: m.id,
        name,
        role: memberRoles[m.id] || m.role || 'Thành viên'
      });
    });

    // Bổ sung những người có trong task nhưng chưa có trong boardMembers
    tasks.forEach(t => {
      const name = t.assigneeName || (t.assigneeId ? `User_${t.assigneeId.slice(0, 5)}` : null);
      if (name && name !== 'Chưa gán' && !map.has(name)) {
        map.set(name, {
          id: t.assigneeId || name,
          name,
          role: t.role || 'Thành viên'
        });
      }
    });

    // Nếu không có ai, thêm mục "Chưa gán"
    if (map.size === 0) {
      map.set('Chưa gán', { id: 'unassigned', name: 'Chưa gán', role: 'Thành viên' });
    }

    return Array.from(map.values());
  }, [boardMembers, memberRoles, tasks]);

  // 3. Xây dựng Ma trận tải trọng
  const { matrix, summaryStats } = useMemo(() => {
    let totalProjectHours = 0;
    let starvedCount = 0;
    let overloadedCount = 0;
    let optimalCount = 0;

    const rows = memberList.map(member => {
      let memberTotalHours = 0;
      const sprintData = {};

      sprints.forEach(sName => {
        const memberSprintTasks = tasks.filter(t => {
          const matchMember = (t.assigneeName === member.name) || (t.assigneeId && t.assigneeId === member.id);
          const matchSprint = t.sprint?.toLowerCase() === sName.toLowerCase();
          return matchMember && matchSprint;
        });

        const sprintHours = memberSprintTasks.reduce((sum, t) => sum + (Number(t.estimatedHours) || 0), 0);
        memberTotalHours += sprintHours;

        const cap = getCapacityLevel(sprintHours);
        if (cap.level === 'starved') starvedCount++;
        else if (cap.level === 'overloaded') overloadedCount++;
        else if (cap.level === 'optimal') optimalCount++;

        sprintData[sName] = {
          hours: sprintHours,
          tasks: memberSprintTasks,
          taskCount: memberSprintTasks.length,
          capacity: cap
        };
      });

      totalProjectHours += memberTotalHours;

      return {
        member,
        sprints: sprintData,
        totalHours: memberTotalHours,
        avgHoursPerSprint: (memberTotalHours / Math.max(1, sprints.length)).toFixed(1)
      };
    });

    // Thống kê từng Sprint (Footer)
    const sprintTotals = {};
    sprints.forEach(sName => {
      const sprintTasks = tasks.filter(t => t.sprint?.toLowerCase() === sName.toLowerCase());
      const hours = sprintTasks.reduce((sum, t) => sum + (Number(t.estimatedHours) || 0), 0);
      sprintTotals[sName] = {
        totalHours: hours,
        taskCount: sprintTasks.length,
        avgPerMember: (hours / Math.max(1, memberList.length)).toFixed(1)
      };
    });

    const totalCells = memberList.length * sprints.length;
    const balanceRate = totalCells > 0 ? Math.round(((totalCells - starvedCount - overloadedCount) / totalCells) * 100) : 100;

    return {
      matrix: rows,
      summaryStats: {
        totalProjectHours,
        starvedCount,
        overloadedCount,
        optimalCount,
        balanceRate,
        sprintTotals
      }
    };
  }, [memberList, sprints, tasks]);

  return (
    <div className="pu-heatmap-container">
      {/* 1. THANH CHỈ SỐ SỨC KHỎE DỰ ÁN (PMP HEALTH DASHBOARD) */}
      <div className="pu-heatmap-dashboard">
        <div className="pu-heatmap-stat-box">
          <span className="pu-stat-label">Chỉ số Cân bằng Tải (PMP Score)</span>
          <div className="pu-stat-value" style={{ color: summaryStats.balanceRate >= 85 ? 'var(--success-text)' : 'var(--danger-hover)' }}>
            {summaryStats.balanceRate}%
          </div>
          <span className="pu-stat-sub">
            {summaryStats.balanceRate >= 85 ? '✅ Phân bổ nhân sự lý tưởng' : '⚠️ Có vị trí bị lệch tải'}
          </span>
        </div>

        <div className="pu-heatmap-stat-box">
          <span className="pu-stat-label">Tổng khối lượng dự án</span>
          <div className="pu-stat-value" style={{ color: 'var(--accent-primary-hover)' }}>
            {summaryStats.totalProjectHours.toFixed(1)}h
          </div>
          <span className="pu-stat-sub">
            {tasks.length} tasks trên {sprints.length} Sprints
          </span>
        </div>

        <div className="pu-heatmap-stat-box">
          <span className="pu-stat-label">Vị trí Nhàn rỗi (0h)</span>
          <div className="pu-stat-value" style={{ color: summaryStats.starvedCount === 0 ? 'var(--success-text)' : 'var(--text-muted)' }}>
            {summaryStats.starvedCount}
          </div>
          <span className="pu-stat-sub">
            {summaryStats.starvedCount === 0 ? '✅ 0 ai bị bỏ quên' : '⚠️ Cần thêm task'}
          </span>
        </div>

        <div className="pu-heatmap-stat-box">
          <span className="pu-stat-label">Vị trí Quá tải (&gt;55h)</span>
          <div className="pu-stat-value" style={{ color: summaryStats.overloadedCount === 0 ? 'var(--success-text)' : 'var(--danger-hover)' }}>
            {summaryStats.overloadedCount}
          </div>
          <span className="pu-stat-sub">
            {summaryStats.overloadedCount === 0 ? '✅ Không có nguy cơ cháy hạn' : '🔥 Cần san sẻ bớt'}
          </span>
        </div>
      </div>

      {/* 2. MA TRẬN NHIỆT (HEATMAP TABLE) */}
      <div className="pu-heatmap-table-wrap">
        <table className="pu-heatmap-table">
          <thead>
            <tr>
              <th className="pu-th-member">Thành viên & Vai trò ({memberList.length})</th>
              {sprints.map(sName => (
                <th key={sName} className="pu-th-sprint">
                  <span className="pu-th-sprint-title">{sName}</span>
                  <span className="pu-th-sprint-sub">Chuẩn: 30-45h</span>
                </th>
              ))}
              <th className="pu-th-total">Tổng giờ</th>
              <th className="pu-th-eval">Đánh giá PMP</th>
            </tr>
          </thead>

          <tbody>
            {matrix.map(({ member, sprints: memberSprints, totalHours, avgHoursPerSprint }) => {
              const hasStarved = Object.values(memberSprints).some(s => s.capacity.level === 'starved');
              const hasOverload = Object.values(memberSprints).some(s => s.capacity.level === 'overloaded');
              const isWellBalanced = !hasStarved && !hasOverload;

              return (
                <tr key={member.name}>
                  {/* Cột 1: Thông tin thành viên */}
                  <td className="pu-td-member">
                    <div className="pu-member-info">
                      <div className="pu-member-avatar-circle">
                        {member.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="pu-member-name">{member.name}</div>
                        <div className="pu-member-role">{member.role}</div>
                      </div>
                    </div>
                  </td>

                  {/* Các cột Sprint Heatmap */}
                  {sprints.map(sName => {
                    const cell = memberSprints[sName] || { hours: 0, taskCount: 0, capacity: getCapacityLevel(0), tasks: [] };
                    const cap = cell.capacity;

                    return (
                      <td
                        key={sName}
                        className={`pu-td-heatmap-cell ${cap.colorClass}`}
                        onClick={() => {
                          setSelectedCell({
                            memberName: member.name,
                            role: member.role,
                            sprintName: sName,
                            hours: cell.hours,
                            tasks: cell.tasks,
                            capacity: cap
                          });
                        }}
                        title={`Bấm để xem ${cell.taskCount} task của ${member.name} trong ${sName}`}
                      >
                        <div className="pu-heatmap-cell-content">
                          <span className="pu-heatmap-hours">{cell.hours.toFixed(1)}h</span>
                          <span className="pu-heatmap-tag">{cell.taskCount} tasks</span>
                        </div>
                      </td>
                    );
                  })}

                  {/* Cột Tổng giờ */}
                  <td className="pu-td-total">
                    <strong>{totalHours.toFixed(1)}h</strong>
                    <span className="pu-avg-label">~{avgHoursPerSprint}h/sp</span>
                  </td>

                  {/* Cột Trạng thái PMP */}
                  <td className="pu-td-eval">
                    {isWellBalanced ? (
                      <span className="pu-eval-tag success">✅ Cân bằng tốt</span>
                    ) : hasOverload ? (
                      <span className="pu-eval-tag danger">🔥 Quá tải</span>
                    ) : (
                      <span className="pu-eval-tag warning">⚠️ Lệch tải</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>

          {/* Dòng tổng kết từng Sprint */}
          <tfoot>
            <tr className="pu-tr-footer">
              <td className="pu-td-member">
                <strong>Tổng khối lượng Sprint:</strong>
              </td>
              {sprints.map(sName => {
                const sTotal = summaryStats.sprintTotals[sName] || { totalHours: 0, taskCount: 0, avgPerMember: 0 };
                return (
                  <td key={sName} className="pu-td-footer-sprint">
                    <strong style={{ color: 'var(--accent-primary-hover)' }}>{sTotal.totalHours.toFixed(1)}h</strong>
                    <span className="pu-footer-sub">{sTotal.taskCount} tasks • TB: {sTotal.avgPerMember}h</span>
                  </td>
                );
              })}
              <td className="pu-td-total">
                <strong style={{ color: 'var(--success-text)' }}>{summaryStats.totalProjectHours.toFixed(1)}h</strong>
              </td>
              <td className="pu-td-eval">
                <span className="pu-eval-tag success">Chuẩn PMP</span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* 3. CHÚ THÍCH THANG NHIỆT (LEGEND) */}
      <div className="pu-heatmap-legend">
        <span className="pu-legend-title">Thang phân bổ tải:</span>
        <div className="pu-legend-item">
          <span className="pu-legend-box cell-starved" />
          <span>Nhàn rỗi (0h)</span>
        </div>
        <div className="pu-legend-item">
          <span className="pu-legend-box cell-light" />
          <span>Tải nhẹ (&lt;20h)</span>
        </div>
        <div className="pu-legend-item">
          <span className="pu-legend-box cell-optimal" />
          <span>Lý tưởng PMP (20-45h)</span>
        </div>
        <div className="pu-legend-item">
          <span className="pu-legend-box cell-moderate" />
          <span>Tiệm cận (46-55h)</span>
        </div>
        <div className="pu-legend-item">
          <span className="pu-legend-box cell-overloaded" />
          <span>Quá tải (&gt;55h)</span>
        </div>
      </div>

      {/* 4. DRAWER / POPUP CHI TIẾT KHI CLICK VÀO 1 CELL */}
      {selectedCell && (
        <div className="pu-heatmap-modal-backdrop" onClick={() => setSelectedCell(null)}>
          <div className="pu-heatmap-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pu-heatmap-modal-header">
              <div>
                <h4 style={{ margin: 0, fontSize: '14px' }}>
                  Chi tiết công việc: {selectedCell.memberName} ({selectedCell.sprintName})
                </h4>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Vai trò: {selectedCell.role} • Tổng thời lượng: <strong>{selectedCell.hours} giờ</strong> ({selectedCell.tasks.length} tasks)
                </span>
              </div>
              <button type="button" onClick={() => setSelectedCell(null)} className="pu-close-btn">
                ✕
              </button>
            </div>

            <div className="pu-heatmap-modal-body">
              {selectedCell.tasks.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  ⚠️ Thành viên này hiện chưa được phân công công việc nào trong {selectedCell.sprintName}.
                </div>
              ) : (
                <div className="pu-modal-task-list">
                  {selectedCell.tasks.map((t, idx) => (
                    <div key={idx} className="pu-modal-task-item">
                      <div className="pu-modal-task-top">
                        <strong className="pu-modal-task-title">#{idx + 1}. {t.title}</strong>
                        <span className="pu-gantt-hours-badge">{t.estimatedHours || 2}h</span>
                      </div>
                      <p className="pu-modal-task-desc">{t.description || 'Không có mô tả chi tiết'}</p>
                      <div className="pu-modal-task-meta">
                        <span>📅 {t.startDate || 'N/A'} → {t.dueDate || 'N/A'}</span>
                        {t.category && <span className="pu-modal-cat-badge">{t.category}</span>}
                        {t.deliverables && <span>📦 {t.deliverables}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pu-heatmap-modal-footer">
              <button type="button" onClick={() => setSelectedCell(null)} className="pu-small-btn">
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
