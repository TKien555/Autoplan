import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import EvaluationPanel from '../../../frontend/src/EvaluationPanel.jsx';
import { evaluateWbs, findSimilarProjects, measureReview } from '../../../wbs_eval_suite/evaluateWbs.mjs';

const sourceName = 'Chính sách khôi phục mật khẩu';
const input = {
  taskName: 'Khôi phục mật khẩu theo chính sách nội bộ',
  description: 'Lập kế hoạch khôi phục mật khẩu, bao gồm xử lý yêu cầu, đổi mật khẩu và kiểm thử theo chính sách.',
  sprintPrefix: 'Sprint',
  sprintCount: 2,
  sprintDurationDays: 7,
  sprintStartDate: '2027-01-04',
  useRag: true,
  teamMembers: [{ id: 'qa', role: 'QA' }],
};
const response = {
  success: true,
  requirements: [{ id: 'REQ-01', text: 'Liên kết khôi phục chỉ dùng một lần' }, { id: 'REQ-02', text: 'Gửi thông báo' }],
  sprintSchedule: [
    { name: 'Sprint 1', startDate: '2027-01-04', endDate: '2027-01-10' },
    { name: 'Sprint 2', startDate: '2027-01-11', endDate: '2027-01-17' },
  ],
  tasks: [{
    _uid: 'first', taskType: 'testing', reqIds: ['REQ-01', 'REQ-FAKE'], sourceIds: ['C1'], pert: { o: 6, m: 12, p: 18 }, needsReview: false,
    title: 'Kiểm thử liên kết dùng một lần',
    description: 'Xác nhận liên kết hết hạn sau 20 phút.',
    role: 'QA',
    assigneeId: 'qa',
    priority: 'High',
    estimatedHours: 12,
    sprint: 'Sprint 1',
    startDate: '2027-01-05',
    dueDate: '2027-01-06',
    subtasks: ['Tạo yêu cầu đặt lại'],
    acceptanceCriteria: ['Given a link When opened twice Then the second use fails'],
    evidence: [{ ref: 'C1', quote: 'Liên kết đặt lại mật khẩu hết hạn sau 20 phút', docName: sourceName }],
  }],
  ragMetadata: { usedRag: true, matchedChunks: [{ docName: sourceName }] },
  evaluationMetadata: { model: 'test-model', directJson: true, proposedQuotes: 2, verifiedQuotes: 1, inputTokens: 300, outputTokens: 100, latencyMs: 250 },
};

describe('WBS evaluation', () => {
  it('scores only observable coverage and verified evidence', () => {
    const result = evaluateWbs(response, input);
    expect(result.similarProjects[0]).toMatchObject({ id: 'account-rag', matched: 2, total: 4 });
    expect(result.sourceNames).toEqual([sourceName]);
    expect(result.groups.grounding.find(item => item.id === 'quotes').score).toBe(50);
    expect(result.groups.grounding[0].score).toBe(100);
    expect(result.groups.completeness.find(item => item.id === 'requirements').score).toBe(50);
    expect(result.groups.grounding.find(item => item.id === 'pert').score).toBe(100);
    expect(result.groupScores.acceptance).toBeNull();
    expect(result.score).toBe(Math.round((result.groupScores.completeness * 30
      + result.groupScores.feasibility * 35 + result.groupScores.grounding * 20) / 85));
    expect(result.telemetry.inputTokens).toBe(300);
  });

  it('detects invalid calendar dates and does not reward empty responses', () => {
    const invalid = { ...response, tasks: [{ ...response.tasks[0], dueDate: '2027-02-30' }] };
    expect(evaluateWbs(invalid, input).groups.feasibility.find(item => item.id === 'schedule').score).toBe(0);
    expect(evaluateWbs({ tasks: [] }, input).score).toBeNull();
    const cycle = { ...response, tasks: [{ ...response.tasks[0], dependencies: [response.tasks[0].title] }] };
    expect(evaluateWbs(cycle, input).groups.feasibility.find(item => item.id === 'schedule').score).toBe(0);
    expect(evaluateWbs({ tasks: [] }, input).telemetry.inputTokens).toBeNull();
  });

  it('selects reference projects by input and rejects unrelated projects', () => {
    expect(findSimilarProjects(input)[0].project.id).toBe('account-rag');
    expect(findSimilarProjects({ taskName: 'Thiết kế bản đồ thiên văn', description: 'Dự báo quỹ đạo vệ tinh.' })).toEqual([]);
    expect(findSimilarProjects({ taskName: '' })).toEqual([]);
  });

  it('measures user review only against original generated tasks', () => {
    const first = response.tasks[0];
    const original = [first, { ...first, _uid: 'second' }, { ...first, _uid: 'third' }];
    const revised = [first, { ...first, _uid: 'second', title: 'Đã sửa' }, { ...first, _uid: 'manual' }];
    const review = measureReview(original, revised);
    expect(review).toEqual({ kept: 1, changed: 1, removed: 1, total: 3 });
    const result = evaluateWbs({ ...response, tasks: original }, input, { review: { ...review, flagged: 0 } });
    expect(result.groups.acceptance.find(metric => metric.id === 'removed').display).toBe('33% (1/3)');
    expect(result.groupScores.acceptance).toBe(67);
  });

  it('keeps A/B comparison separate and applies optional Judge scores', async () => {
    const requestBreakdown = vi.fn().mockResolvedValue(response);
    const requestJudge = vi.fn().mockResolvedValue([3, 5]);
    const props = { active: true, latest: evaluateWbs(response, input), requestBreakdown, requestJudge, onResize: () => {} };
    const run = { input, response };
    const { rerender } = render(<EvaluationPanel {...props} run={run} />);
    const comparison = () => screen.queryByRole('table', { name: /So sánh cặp A\/B/ });
    expect(screen.getByText('Dự án tương tự')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /So sánh RAG và không RAG/ })).not.toBeInTheDocument();
    rerender(<EvaluationPanel {...props} run={run} mode="comparison" />);
    fireEvent.click(screen.getByRole('button', { name: /So sánh RAG và không RAG/ }));
    await waitFor(() => expect(comparison()).toBeVisible());
    expect(requestBreakdown.mock.calls).toEqual([[{ ...input, useRag: false }], [input]]);
    expect(requestJudge).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('row', { name: /Thực tiễn theo Judge/ })).toBeVisible();
    rerender(<EvaluationPanel {...props} run={{ input: { ...input, taskName: 'Dự án khác' } }} mode="comparison" />);
    expect(comparison()).not.toBeInTheDocument();
  });
});
