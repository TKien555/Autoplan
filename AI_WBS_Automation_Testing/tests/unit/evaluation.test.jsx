import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import EvaluationPanel from '../../../frontend/src/EvaluationPanel.jsx';
import { evaluateWbs, findSimilarProjects } from '../../../wbs_eval_suite/evaluateWbs.mjs';

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
  sprintSchedule: [
    { name: 'Sprint 1', startDate: '2027-01-04', endDate: '2027-01-10' },
    { name: 'Sprint 2', startDate: '2027-01-11', endDate: '2027-01-17' },
  ],
  tasks: [{
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
    expect(result.groups.reliability.find(item => item.id === 'quotes').percent).toBe(50);
    expect(result.groups.verifiability[0].percent).toBe(100);
    expect(result.telemetry.inputTokens).toBe(300);
  });

  it('detects invalid calendar dates and does not reward empty responses', () => {
    const invalid = { ...response, tasks: [{ ...response.tasks[0], dueDate: '2027-02-30' }] };
    expect(evaluateWbs(invalid, input).groups.realism.find(item => item.id === 'dates').passed).toBe(0);
    expect(evaluateWbs({ tasks: [] }, input).score).toBe(0);
    expect(evaluateWbs({ tasks: [] }, input).telemetry.inputTokens).toBeNull();
  });

  it('selects reference projects by input and rejects unrelated projects', () => {
    expect(findSimilarProjects(input)[0].project.id).toBe('account-rag');
    expect(findSimilarProjects({ taskName: 'Thiết kế bản đồ thiên văn', description: 'Dự báo quỹ đạo vệ tinh.' })).toEqual([]);
    expect(findSimilarProjects({ taskName: '' })).toEqual([]);
  });

  it('compares the same project configuration with and without RAG', async () => {
    const requestBreakdown = vi.fn().mockResolvedValue(response);
    const props = { active: true, latest: evaluateWbs(response, input), requestBreakdown, onResize: () => {} };
    const { rerender } = render(<EvaluationPanel {...props} run={{ input }} />);
    const comparison = () => screen.queryByRole('table', { name: /So sánh cặp A\/B/ });
    expect(screen.queryByLabelText('Ca đánh giá')).not.toBeInTheDocument();
    expect(screen.getByText('Dự án tương tự')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /So sánh RAG và không RAG/ }));
    await waitFor(() => expect(comparison()).toBeVisible());
    expect(requestBreakdown.mock.calls).toEqual([[{ ...input, useRag: false }], [input]]);
    rerender(<EvaluationPanel {...props} run={{ input: { ...input, taskName: 'Dự án khác' } }} />);
    expect(comparison()).not.toBeInTheDocument();
  });
});
