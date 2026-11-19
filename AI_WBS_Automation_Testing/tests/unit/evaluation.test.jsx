import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import EvaluationPanel from '../../../frontend/src/EvaluationPanel.jsx';
import { evaluateWbs } from '../../../frontend/src/evaluateWbs.js';
import { evaluationCases, readEvaluationCases } from '../../../frontend/src/evaluationCases.js';

const scenario = evaluationCases[3];
const input = {
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
    evidence: [{ ref: 'C1', quote: 'Liên kết đặt lại mật khẩu hết hạn sau 20 phút', docName: scenario.source.name }],
  }],
  ragMetadata: { usedRag: true, matchedChunks: [{ docName: scenario.source.name }] },
  evaluationMetadata: { model: 'test-model', directJson: true, proposedQuotes: 2, verifiedQuotes: 1, inputTokens: 300, outputTokens: 100, latencyMs: 250 },
};

describe('WBS evaluation', () => {
  it('scores only observable coverage and verified evidence', () => {
    const result = evaluateWbs(response, input, scenario);
    expect(result.coverage.map(item => item.matched)).toEqual([true, true, false, false]);
    expect(result.expectedSourceFound).toBe(true);
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

  it('validates imported cases before allowing a run', () => {
    expect(readEvaluationCases([scenario])[0].title).toBe(scenario.title);
    expect(() => readEvaluationCases([{ ...scenario, sprintCount: 7 }])).toThrow('Ca số 1');
    expect(() => readEvaluationCases([{ ...scenario, requirements: [{ label: 'Invalid', terms: ['---'] }] }]))
      .toThrow('Ca số 1');
  });

  it('runs a matched A/B pair and shows both reports', async () => {
    const requestBreakdown = vi.fn().mockResolvedValue(response);
    render(<EvaluationPanel active requestBreakdown={requestBreakdown} onResize={() => {}} />);
    fireEvent.change(screen.getByLabelText('Ca đánh giá'), { target: { value: scenario.id } });
    fireEvent.click(screen.getByRole('button', { name: /So sánh A\/B/ }));
    await waitFor(() => expect(screen.getByRole('table')).toBeVisible());
    const [[before], [after]] = requestBreakdown.mock.calls;
    expect(before).toEqual({ ...after, useRag: false });
    expect(after.useRag).toBe(true);
    expect(screen.getByText('Lịch sử trong phiên (2)')).toBeInTheDocument();
  });
});
