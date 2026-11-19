import React, { useEffect, useState } from 'react';
import { evaluateWbs } from '../../wbs_eval_suite/evaluateWbs.mjs';

const GROUPS = {
  realism: 'Thực tế',
  reliability: 'Tin cậy',
  coverage: 'Độ phủ',
  verifiability: 'Kiểm chứng',
};
const numberText = value => value == null ? 'Chưa có số liệu' : value.toLocaleString('vi-VN');
const delta = (withRag, baseline) => {
  if (withRag == null || baseline == null) return '—';
  const difference = withRag - baseline;
  return `${difference > 0 ? '+' : ''}${numberText(difference)}`;
};

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
          {key === 'verifiability' && (
            <div className="pu-eval-detail-body">
              <p>Tài liệu đã truy xuất — {report.sourceNames.join(', ') || 'Không có'}</p>
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
      <SimilarProjects projects={report.similarProjects} />
    </div>
  );
}

function SimilarProjects({ projects }) {
  return (
    <section aria-label="Dự án tương tự">
      <h4>Dự án tương tự</h4>
      {projects.length === 0 ? (
        <p>Chưa tìm thấy dự án đủ tương đồng trong bộ dữ liệu tham chiếu.</p>
      ) : (
        <>
          <div className="pu-eval-table">
            <table>
              <thead><tr><th>Dự án tham chiếu</th><th>Tương đồng đầu vào</th><th>Yêu cầu có từ khóa trong WBS</th></tr></thead>
              <tbody>{projects.map(project => (
                <tr key={project.id}>
                  <th scope="row">{project.title}
                    {project.dataset && <div><a href={project.dataset.url} target="_blank" rel="noreferrer">{project.dataset.name}</a></div>}
                  </th>
                  <td>{project.similarity}%</td><td>{project.matched}/{project.total} ({Math.round(100 * project.matched / project.total)}%)</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <p className="pu-eval-note">Tương đồng dựa trên từ khóa trong tiêu đề và mô tả dự án. Số yêu cầu khớp từ khóa là tín hiệu đối chiếu WBS với dự án tham chiếu.</p>
        </>
      )}
    </section>
  );
}

function Comparison({ baseline, withRag }) {
  const rows = [
    ['Điểm tổng hợp', baseline.score, withRag.score],
    ...Object.entries(GROUPS).map(([key, label]) => [label, baseline.groupScores[key], withRag.groupScores[key]]),
    ['Độ trễ (ms)', baseline.telemetry.latencyMs, withRag.telemetry.latencyMs],
    ['Token đầu vào', baseline.telemetry.inputTokens, withRag.telemetry.inputTokens],
    ['Token đầu ra', baseline.telemetry.outputTokens, withRag.telemetry.outputTokens],
    ...baseline.similarProjects.map((project, index) => [
      `Yêu cầu khớp · ${project.title} (/${project.total})`,
      project.matched, withRag.similarProjects[index]?.matched,
    ]),
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
      {withRag.ragRetrieved === false && <p>Lượt có RAG chưa truy xuất được tài liệu liên quan.</p>}
      {(!baseline.telemetry.model || baseline.telemetry.model !== withRag.telemetry.model) && (
        <p>Model hai lượt khác nhau hoặc chưa xác định. Delta có thể chịu ảnh hưởng của model.</p>
      )}
    </div>
  );
}

export default function EvaluationPanel({ active, latest, run, requestBreakdown, onResize, isGenerating }) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState(null);
  const current = result?.run === run ? result : null;

  useEffect(() => {
    if (active) onResize();
  }, [active, latest, current, pending, onResize]);

  async function compare() {
    setPending(true);
    setResult(null);
    try {
      const reports = [];
      for (const useRag of [false, true]) {
        const input = { ...run.input, useRag };
        const response = await requestBreakdown(input);
        if (!response.success) throw new Error(response.error || 'Không thể sinh WBS để so sánh.');
        reports.push(evaluateWbs(response, input, { compareRag: true }));
      }
      setResult({ run, baseline: reports[0], withRag: reports[1] });
    } catch (error) {
      setResult({ run, error: error.message || 'Không thể so sánh WBS.' });
    } finally {
      setPending(false);
    }
  }

  return (
    <section hidden={!active} className="pu-evaluation" aria-label="Đánh giá WBS">
      {latest && run ? (
        <>
          <h3>Đánh giá WBS · {run.input.taskName}</h3>
          <Report report={latest} />
          <div className="pu-eval-actions">
            <button type="button" className="pu-tab-btn" disabled={pending || isGenerating} onClick={compare}>
              So sánh RAG và không RAG · 2 lượt sinh
            </button>
          </div>
          {pending && <p role="status">Đang so sánh trên cùng đầu vào dự án…</p>}
          {current?.error && <p role="alert" className="pu-error-banner">{current.error}</p>}
          {current?.baseline && <Comparison baseline={current.baseline} withRag={current.withRag} />}
          <p className="pu-eval-note">Điểm theo trọng số 35% thực tế, 20% tin cậy, 30% độ phủ, 15% kiểm chứng. Các chỉ số thiếu dữ liệu được bỏ qua khi tính điểm.</p>
        </>
      ) : (
        <p>Hãy sinh WBS trong tab Lập kế hoạch để xem báo cáo của dự án.</p>
      )}
    </section>
  );
}
