import React, { useEffect, useState } from 'react';
import { evaluateWbs } from './evaluateWbs.js';
import { evaluationCases, readEvaluationCases } from './evaluationCases.js';

const GROUPS = {
  realism: 'Thực tế',
  reliability: 'Tin cậy',
  coverage: 'Độ phủ',
  verifiability: 'Kiểm chứng',
};
const BENCHMARK_TEAM = [
  { id: 'eval-dev', fullName: 'Dev mẫu', role: 'Full-stack Developer' },
  { id: 'eval-qa', fullName: 'QA mẫu', role: 'QA / Tester' },
];

const numberText = value => value == null ? 'Chưa có số liệu' : value.toLocaleString('vi-VN');
const delta = (withRag, baseline) => {
  if (withRag == null || baseline == null) return '—';
  const difference = withRag - baseline;
  return `${difference > 0 ? '+' : ''}${numberText(difference)}`;
};

function consistency(runs) {
  if (runs.length < 3 || !runs[0].report.telemetry.model
    || runs.some(run => run.report.telemetry.model !== runs[0].report.telemetry.model)) return null;
  const names = runs.map(run => new Set(run.report.tasks.map(task => task.title?.trim().toLowerCase()).filter(Boolean)));
  const pairs = [[0, 1], [0, 2], [1, 2]].map(([a, b]) => {
    const union = new Set([...names[a], ...names[b]]);
    return union.size ? [...names[a]].filter(title => names[b].has(title)).length / union.size : 0;
  });
  const hours = runs.map(run => run.report.totalHours);
  return {
    overlap: Math.round(100 * pairs.reduce((sum, value) => sum + value, 0) / pairs.length),
    hoursSpread: Math.max(...hours) - Math.min(...hours),
  };
}

function Report({ report }) {
  const { telemetry } = report;
  return (
    <div className="pu-eval-report">
      <h4>Điểm tổng hợp {report.score}/100 · {report.tasks.length} công việc · {numberText(report.totalHours)} giờ</h4>
      {Object.entries(GROUPS).map(([key, label]) => (
        <details key={key} className="pu-eval-detail">
          <summary>{label} · {report.groupScores[key] ?? 'Chưa chấm'}{report.groupScores[key] != null && '/100'}</summary>
          <ul>
            {report.groups[key].map(item => (
              <li key={item.id}>
                <strong>{item.label} · {item.total ? `${item.passed}/${item.total} (${item.percent}%)` : 'Chưa có dữ liệu'}</strong>
                <div>{item.detail}</div>
              </li>
            ))}
          </ul>
          {key === 'coverage' && report.coverage.length > 0 && (
            <ul>{report.coverage.map(item => (
              <li key={item.label}>{item.label} · {item.matched ? 'Tìm thấy từ khóa' : 'Chưa tìm thấy từ khóa'}</li>
            ))}</ul>
          )}
          {key === 'verifiability' && (
            <div className="pu-eval-detail-body">
              <p>Tài liệu đã truy xuất — {report.sourceNames.join(', ') || 'Không có'}</p>
              {report.expectedSourceFound != null && (
                <p>Tài liệu tham chiếu của ca — {report.expectedSourceFound ? 'Đã tìm thấy' : 'Chưa tìm thấy'}</p>
              )}
              {report.tasks.flatMap((task, index) => (Array.isArray(task.evidence) ? task.evidence : []).map((source, sourceIndex) => (
                <blockquote key={`${index}-${sourceIndex}`}>
                  <strong>{task.title} · {source.docName}</strong>
                  <div>{source.quote}</div>
                </blockquote>
              )))}
            </div>
          )}
        </details>
      ))}
      <details className="pu-eval-detail" open>
        <summary>Hiệu quả</summary>
        <dl className="pu-eval-stats">
          <dt>Model</dt><dd>{telemetry.model || 'Chưa có số liệu'}</dd>
          <dt>Độ trễ máy chủ</dt><dd>{numberText(telemetry.latencyMs)}{telemetry.latencyMs != null && ' ms'}</dd>
          <dt>Token đầu vào</dt><dd>{numberText(telemetry.inputTokens)}</dd>
          <dt>Token đầu ra</dt><dd>{numberText(telemetry.outputTokens)}</dd>
          <dt>Token sinh trên mỗi công việc</dt>
          <dd>{numberText(report.tasks.length && telemetry.outputTokens != null
            ? Math.round(telemetry.outputTokens / report.tasks.length) : null)}</dd>
        </dl>
      </details>
      <details className="pu-eval-detail">
        <summary>WBS đã chấm</summary>
        <ol>{report.tasks.map((task, index) => (
          <li key={index}><strong>{task.title}</strong> · {task.sprint} · {task.estimatedHours} giờ
            <div>{task.description}</div>
          </li>
        ))}</ol>
      </details>
    </div>
  );
}

function Comparison({ baseline, withRag }) {
  const rows = [
    ['Điểm tổng hợp', baseline.score, withRag.score],
    ...Object.entries(GROUPS).map(([key, label]) => [label, baseline.groupScores[key], withRag.groupScores[key]]),
    ['Độ trễ (ms)', baseline.telemetry.latencyMs, withRag.telemetry.latencyMs],
    ['Token đầu vào', baseline.telemetry.inputTokens, withRag.telemetry.inputTokens],
    ['Token đầu ra', baseline.telemetry.outputTokens, withRag.telemetry.outputTokens],
  ];
  return (
    <div className="pu-eval-table">
      <table>
        <caption>So sánh cặp A/B gần nhất · Δ = có RAG − không RAG</caption>
        <thead><tr><th>Chỉ số</th><th>Không RAG</th><th>Có RAG</th><th>Δ</th></tr></thead>
        <tbody>{rows.map(([label, before, after]) => (
          <tr key={label}><th scope="row">{label}</th><td>{numberText(before)}</td>
            <td>{numberText(after)}</td><td>{delta(after, before)}</td></tr>
        ))}</tbody>
      </table>
      {(!baseline.telemetry.model || baseline.telemetry.model !== withRag.telemetry.model) && (
        <p>Model hai lượt khác nhau hoặc chưa xác định. Delta có thể chịu ảnh hưởng của model.</p>
      )}
    </div>
  );
}

export default function EvaluationPanel({ active, latest, requestBreakdown, onResize, isGenerating, view = 'benchmark', onViewChange }) {
  const [caseId, setCaseId] = useState(evaluationCases[0].id);
  const [history, setHistory] = useState([]);
  const [customCases, setCustomCases] = useState([]);
  const [importing, setImporting] = useState(false);
  const [comparisons, setComparisons] = useState({});
  const [running, setRunning] = useState('');
  const [failure, setFailure] = useState('');
  const cases = [...evaluationCases, ...customCases];
  const scenario = cases.find(item => item.id === caseId);
  const scenarioRuns = history.filter(run => run.caseId === caseId);
  const comparison = comparisons[caseId];
  const baseline = scenarioRuns.find(run => !run.useRag);
  const withRag = scenarioRuns.find(run => run.useRag);

  useEffect(() => {
    if (active) onResize();
  }, [active, caseId, history, running, failure, view, latest, onResize]);

  async function importCases(event) {
    const file = event.currentTarget.files[0];
    event.currentTarget.value = '';
    if (!file) return;
    setFailure('');
    setImporting(true);
    try {
      if (file.size > 512 * 1024) throw new Error('Tệp đánh giá phải nhỏ hơn hoặc bằng 512 KB.');
      const imported = readEvaluationCases(JSON.parse(await file.text()));
      const additions = imported.map((item, index) => ({ ...item, id: `custom-${customCases.length + index}` }));
      setCustomCases(previous => [...previous, ...additions]);
      setCaseId(additions[0].id);
    } catch (error) {
      setFailure(error instanceof SyntaxError ? 'Tệp đánh giá không phải JSON hợp lệ.' : error.message);
    } finally {
      setImporting(false);
    }
  }

  async function run(modes) {
    setRunning(modes.length > 1 ? 'Đang chạy so sánh…' : 'Đang sinh và chấm WBS…');
    setFailure('');
    try {
      const reports = [];
      for (const useRag of modes) {
        const input = {
          taskName: scenario.title,
          description: scenario.description,
          sprintPrefix: 'Sprint',
          sprintCount: scenario.sprintCount,
          sprintDurationDays: scenario.sprintDurationDays,
          sprintStartDate: '2027-01-04',
          teamSize: BENCHMARK_TEAM.length,
          teamMembers: BENCHMARK_TEAM,
          methodology: 'Agile',
          useRag,
        };
        const response = await requestBreakdown(input);
        if (!response.success) throw new Error(response.error || 'Không thể sinh WBS cho ca đánh giá.');
        const report = evaluateWbs(response, input, scenario);
        reports.push(report);
        const newRun = { caseId, useRag, report, at: new Date().toISOString() };
        setHistory(previous => [newRun, ...previous].slice(0, 30));
      }
      if (reports.length === 2) {
        setComparisons(previous => ({ ...previous, [caseId]: { baseline: reports[0], withRag: reports[1] } }));
      }
    } catch (error) {
      setFailure(error.message || 'Không thể chạy đánh giá.');
    } finally {
      setRunning('');
    }
  }

  return (
    <section hidden={!active} className="pu-evaluation" aria-label="Đánh giá WBS">
      <div className="pu-eval-actions" aria-label="Chọn nguồn đánh giá">
        <button type="button" className="pu-tab-btn" aria-pressed={view === 'benchmark'} onClick={() => onViewChange?.('benchmark')}>Bộ dữ liệu</button>
        <button type="button" className="pu-tab-btn" aria-pressed={view === 'latest'} onClick={() => onViewChange?.('latest')}>WBS vừa sinh</button>
      </div>
      {view === 'latest' ? (
        latest ? <Report report={latest} /> : <p>Hãy sinh một WBS trong tab Lập kế hoạch để xem đánh giá.</p>
      ) : (
        <>
          <label className="pu-label" htmlFor="evaluation-case">Ca đánh giá</label>
          <select id="evaluation-case" className="pu-input" value={caseId} disabled={Boolean(running) || importing}
            onChange={event => { setCaseId(event.target.value); setFailure(''); }}>
            {cases.map(item => <option value={item.id} key={item.id}>{item.title}</option>)}
          </select>
          <div className="pu-form-group">
            <label className="pu-label" htmlFor="evaluation-import">Nhập ca đánh giá đã gán nhãn (.json)</label>
            <input id="evaluation-import" type="file" accept=".json,application/json" disabled={Boolean(running) || importing} onChange={importCases} />
          </div>
          <p>{scenario.description}</p>
          {scenario.dataset && <p>Nguồn ca mẫu · <a href={scenario.dataset.url} target="_blank" rel="noreferrer">{scenario.dataset.name}</a></p>}
          <p>{scenario.sprintCount} Sprint × {scenario.sprintDurationDays} ngày · Bắt đầu 04/01/2027 · Nhóm Dev và QA mẫu</p>
          <details className="pu-eval-detail">
            <summary>Yêu cầu đối chiếu</summary>
            <ol>{scenario.requirements.map(item => <li key={item.label}>{item.label}</li>)}</ol>
          </details>
          {scenario.source && (
            <details className="pu-eval-detail">
              <summary>Tài liệu tham chiếu RAG</summary>
              <div className="pu-eval-detail-body">
                <p>Nạp văn bản này vào tab RAG với tên “{scenario.source.name}” trước khi chạy có RAG.</p>
                <blockquote>{scenario.source.text}</blockquote>
              </div>
            </details>
          )}
          <div className="pu-eval-actions">
            <button type="button" className="pu-tab-btn" disabled={Boolean(running) || importing || isGenerating} onClick={() => run([false])}>Chạy không RAG</button>
            <button type="button" className="pu-tab-btn" disabled={Boolean(running) || importing || isGenerating} onClick={() => run([true])}>Chạy có RAG</button>
            <button type="button" className="pu-tab-btn" disabled={Boolean(running) || importing || isGenerating} onClick={() => run([false, true])}>So sánh A/B · 2 lượt sinh</button>
          </div>
          {running && <p role="status">{running}</p>}
          {failure && <p role="alert" className="pu-error-banner">{failure}</p>}
          {comparison && <Comparison baseline={comparison.baseline} withRag={comparison.withRag} />}
          {[baseline, withRag].filter(Boolean).map(run => {
            const sameMode = scenarioRuns.filter(item => item.useRag === run.useRag);
            const repeated = consistency(sameMode.slice(0, 3));
            const times = sameMode.map(item => item.report.telemetry.latencyMs)
              .filter(Number.isFinite).sort((a, b) => a - b);
            const percentile = quantile => times[Math.ceil(times.length * quantile) - 1];
            return (
              <details key={String(run.useRag)} className="pu-eval-detail">
                <summary>{run.useRag ? 'Có RAG' : 'Không RAG'} · {run.report.score}/100</summary>
                <div className="pu-eval-detail-body">
                  <Report report={run.report} />
                  <p>Nhất quán — {repeated
                    ? `${repeated.overlap}% trùng tiêu đề, chênh lệch tổng giờ ${numberText(repeated.hoursSpread)} giờ`
                    : 'Cần 3 lần chạy gần nhất cùng chế độ và cùng model.'}</p>
                  {times.length > 0 && (
                    <p>Độ trễ p50 / p95 · {numberText(percentile(0.5))} / {numberText(percentile(0.95))} ms ({times.length} lượt)</p>
                  )}
                </div>
              </details>
            );
          })}
          {scenarioRuns.length > 0 && (
            <details className="pu-eval-detail">
              <summary>Lịch sử trong phiên ({scenarioRuns.length})</summary>
              <ul>{scenarioRuns.map((run, index) => (
                <li key={`${run.at}-${index}`}>{new Date(run.at).toLocaleTimeString('vi-VN')} · {run.useRag ? 'Có RAG' : 'Không RAG'} · {run.report.score}/100</li>
              ))}</ul>
            </details>
          )}
        </>
      )}
      <p className="pu-eval-note">Điểm theo trọng số 35% thực tế, 20% tin cậy, 30% độ phủ, 15% kiểm chứng. Độ phủ từ khóa và đối chiếu nguyên văn cần người đọc kiểm tra lại về ngữ nghĩa.</p>
    </section>
  );
}
