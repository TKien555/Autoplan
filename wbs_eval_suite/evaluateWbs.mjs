import { groups as criteria, practicalityWeight } from './criteria.mjs';
import { referenceProjects } from './referenceProjects.mjs';

const DAY_MS = 86_400_000;

const normalize = value => String(value ?? '').toLowerCase()
  .normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const stopWords = new Set('va voi khi cho trong cua theo cac mot de tu co thi tren duoc he thong kiem thu thuc hien xu ly them tinh nang project for with from that the and into must should feature test'.split(' '));
const projectTokens = text => new Set(normalize(text).split(' ').filter(word =>
  word.length > 1 && !stopWords.has(word) && /\p{L}/u.test(word)
));

const indexedProjects = referenceProjects.map(project => ({
  project,
  tokens: projectTokens(`${project.title} ${project.description}`),
}));

export function findSimilarProjects(input) {
  const tokens = projectTokens(`${input.taskName ?? ''} ${input.description ?? ''}`);
  return indexedProjects.flatMap(({ project, tokens: reference }) => {
    const common = [...tokens].filter(word => reference.has(word)).length;
    const similarity = common / Math.sqrt(tokens.size * reference.size);
    if (common < 2 || similarity < 0.25) return [];
    return [{ project, similarity }];
  }).sort((a, b) => b.similarity - a.similarity).slice(0, 3);
}

const isText = value => typeof value === 'string' && Boolean(value.trim());
function dateMs(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp
    : NaN;
}

function expectedSprints(input) {
  const firstDay = dateMs(input.sprintStartDate);
  const prefix = input.sprintPrefix.trim().slice(0, 40) || 'Sprint';
  const totalDays = input.projectDurationWeeks == null
    ? input.sprintCount * input.sprintDurationDays
    : input.projectDurationWeeks * 7;
  return Array.from({ length: input.sprintCount }, (_, index) => ({
    name: input.sprintCount === 1 && /\d+$/.test(prefix)
      ? prefix
      : `${prefix.replace(/\s+\d+$/, '')} ${index + 1}`,
    firstDay: firstDay + index * input.sprintDurationDays * DAY_MS,
    lastDay: firstDay + (Math.min((index + 1) * input.sprintDurationDays, totalDays) - 1) * DAY_MS,
  }));
}

function measure(id, label, passed, total, { target, lower = false, detail, display } = {}) {
  const value = total > 0 ? passed * 100 / total : null;
  return {
    id, label, detail, target, lower,
    display: value == null ? 'N/A' : display ?? `${Math.round(value)}% (${passed}/${total})`,
    score: value == null || target == null ? null : lower ? 100 - value : value,
    meetsTarget: value == null || target == null ? null : lower ? value <= target : value >= target,
  };
}

function checkSchedule(tasks, sprints, actual) {
  if (!tasks.length || !sprints.length || !Number.isFinite(sprints[0].firstDay) || !Array.isArray(actual)) return null;
  const slots = new Map(sprints.map(sprint => [sprint.name, sprint]));
  const issues = new Set();
  if (actual.length !== sprints.length || sprints.some((sprint, index) => {
    const slot = actual[index];
    return slot?.name !== sprint.name || dateMs(slot.startDate) !== sprint.firstDay || dateMs(slot.endDate) !== sprint.lastDay;
  })) issues.add('Lịch Sprint không khớp với thời lượng dự án.');
  const titles = new Map();
  tasks.forEach((task, index) => {
    const key = normalize(task.title);
    if (!key || titles.has(key)) issues.add('Có tiêu đề công việc bị trống hoặc trùng.');
    titles.set(key, index);
  });
  const outgoing = tasks.map(() => []);
  const incoming = tasks.map(() => 0);
  const longest = tasks.map(task => Number(task.estimatedHours));
  for (const [index, task] of tasks.entries()) {
    const slot = slots.get(task.sprint);
    const start = dateMs(task.startDate);
    const end = dateMs(task.dueDate);
    if (!slot || !(start >= slot.firstDay && end >= start && end <= slot.lastDay)) issues.add('Có công việc nằm ngoài ngày của Sprint được giao.');
    if (!Number.isFinite(longest[index]) || longest[index] <= 0) issues.add('Có công việc có số giờ ước tính chưa hợp lệ.');
    for (const title of new Set(task.dependencies || [])) {
      const predecessor = titles.get(normalize(title));
      if (predecessor === undefined) {
        issues.add('Có công việc phụ thuộc vào một công việc không có trong kế hoạch.');
        continue;
      }
      if (!(dateMs(tasks[predecessor].dueDate) < start)) {
        issues.add('Có công việc bắt đầu trước hoặc cùng ngày kết thúc của công việc cần hoàn thành trước.');
      }
      outgoing[predecessor].push(index);
      incoming[index]++;
    }
  }
  const queue = incoming.flatMap((count, index) => count === 0 ? [index] : []);
  let criticalHours = 0;
  for (let position = 0; position < queue.length; position++) {
    const index = queue[position];
    criticalHours = Math.max(criticalHours, longest[index]);
    for (const next of outgoing[index]) {
      longest[next] = Math.max(longest[next], longest[index] + Number(tasks[next].estimatedHours));
      if (--incoming[next] === 0) queue.push(next);
    }
  }
  const workingHours = sprints.reduce((total, sprint) => total + capacity(sprint), 0);
  if (queue.length !== tasks.length) issues.add('Các công việc phụ thuộc lẫn nhau theo vòng lặp.');
  const hasCriticalHours = queue.length === tasks.length && Number.isFinite(criticalHours);
  if (hasCriticalHours && criticalHours > workingHours) issues.add('Chuỗi công việc dài nhất vượt thời gian dự án.');
  return {
    valid: issues.size === 0,
    detail: [...issues, ...(hasCriticalHours ? [
      `Chuỗi công việc dài nhất cần ${Math.round(criticalHours * 10) / 10} giờ, dự án có ${workingHours} giờ làm việc.`,
    ] : [])].join(' '),
  };
}

const capacity = sprint => Math.max(1, Math.round(((sprint.lastDay - sprint.firstDay) / DAY_MS + 1) * 5 / 7)) * 8;
const reviewFields = ['title', 'description', 'role', 'assigneeId', 'priority', 'estimatedHours', 'sprint', 'startDate', 'dueDate', 'subtasks'];

export function measureReview(original, edited) {
  const byId = new Map(edited.map(task => [task._uid, task]));
  let kept = 0;
  let changed = 0;
  let removed = 0;
  for (const task of original) {
    const updated = byId.get(task._uid);
    if (!updated) removed++;
    else if (reviewFields.some(field => JSON.stringify(task[field]) !== JSON.stringify(updated[field]))) changed++;
    else kept++;
  }
  return { kept, changed, removed, total: original.length };
}

function taskMatches(task, terms) {
  const fields = [task.title, task.description, ...(Array.isArray(task.subtasks) ? task.subtasks : []),
    ...(Array.isArray(task.acceptanceCriteria) ? task.acceptanceCriteria : [])];
  return fields.some(field => typeof field === 'string' && terms.some(term =>
    ` ${normalize(field)} `.includes(` ${normalize(term)} `)
  ));
}

export function evaluateWbs(response, input, { review, practicality } = {}) {
  const tasks = (Array.isArray(response.tasks) ? response.tasks : []).filter(task => task && typeof task === 'object' && !Array.isArray(task));
  const count = tasks.length;
  const metadata = response.evaluationMetadata || {};
  const sprints = expectedSprints(input);
  const slots = new Map(sprints.map(sprint => [sprint.name, sprint]));
  const members = new Map((input.teamMembers || []).map(member => [member.id, member]));
  const requirements = new Map((response.requirements || []).map(req => [req.id, req.text]));
  const assigned = new Map();
  for (const task of tasks) {
    if (!members.has(task.assigneeId) || !slots.has(task.sprint) || !(task.estimatedHours > 0)) continue;
    const loads = assigned.get(task.assigneeId) || new Map();
    loads.set(task.sprint, (loads.get(task.sprint) || 0) + task.estimatedHours);
    assigned.set(task.assigneeId, loads);
  }
  let overloaded = 0;
  const loads = [...assigned].map(([id, hours]) => {
    let over = false;
    const sprints = [...hours].map(([name, used]) => {
      const limit = capacity(slots.get(name));
      over ||= used > limit;
      return `${name}: ${Math.round(used * 10) / 10}/${limit}h (${Math.round(used * 100 / limit)}%)`;
    });
    overloaded += Number(over);
    const member = members.get(id);
    return `${member.fullName || member.username || member.role} · ${sprints.join(' · ')}`;
  });
  const refs = tasks.map(task => (task.reqIds || []).filter(id => requirements.has(id)));
  const sourceCounts = { requirementsOnly: 0, ragOnly: 0, both: 0 };
  const taskSources = tasks.flatMap((task, index) => {
    const linkedRequirements = [...new Set(refs[index])].map(id => ({ id, text: requirements.get(id) }));
    const evidence = task.evidence || [];
    const hasRagSource = Boolean(task.sourceIds?.length || evidence.length);
    if (linkedRequirements.length && hasRagSource) sourceCounts.both++;
    else if (linkedRequirements.length) sourceCounts.requirementsOnly++;
    else if (hasRagSource) sourceCounts.ragOnly++;
    else return [];
    return [{ title: task.title, requirements: linkedRequirements, evidence }];
  });
  const ragStatus = response.ragMetadata?.retrievalStatus ?? (
    response.ragMetadata?.usedRag === true ? 'matched' :
      input.useRag === false ? 'off' : response.ragMetadata?.usedRag === false ? 'no_match' : 'unknown'
  );
  const quoteStatus = metadata.proposedQuotes > 0
    ? `${metadata.verifiedQuotes ?? 0}/${metadata.proposedQuotes} đoạn trích khớp nguyên văn với tài liệu.`
    : {
        off: 'Lượt này tắt RAG, nên không có đoạn tài liệu để trích nguyên văn.',
        no_match: 'RAG bật nhưng không tìm thấy đoạn tài liệu phù hợp cho lượt này.',
        error: 'Lượt tra cứu tài liệu gặp lỗi hoặc hết thời gian chờ.',
        matched: 'Đã tìm thấy tài liệu phù hợp, nhưng AI không đề xuất đoạn trích nguyên văn.',
        unknown: 'Kết quả này không có thông tin về lượt tra cứu tài liệu.',
      }[ragStatus];
  const covered = new Set(refs.flat());
  const typeCount = ['integration', 'testing', 'bugfix'].filter(type => tasks.some(task => task.taskType === type)).length;
  const schedule = checkSchedule(tasks, sprints, response.sprintSchedule);
  const totalHours = tasks.reduce((total, task) => total + (Number.isFinite(task.estimatedHours) ? task.estimatedHours : 0), 0);
  const acTestable = task => (task.acceptanceCriteria || []).some(criterion =>
    isText(criterion) && (/\bgiven\b.+\bwhen\b.+\bthen\b|\bkhi\b.+\bthi\b/i.test(normalize(criterion))
      || /\d+(?:[.,]\d+)?\s*(?:%|ms\b|giây\b|phút\b|giờ\b|ngày\b|seconds?\b|minutes?\b)/i.test(criterion)));
  const groups = {
    completeness: [
      measure('requirements', 'Yêu cầu đã có công việc', covered.size, requirements.size, {
        target: 95, detail: requirements.size > 0
          ? `Hệ thống tách được ${requirements.size} mục yêu cầu từ phần mô tả bạn nhập.${covered.size < requirements.size
            ? ` Chưa có công việc cho: ${[...requirements.keys()].filter(id => !covered.has(id)).join(', ')}.` : ''}`
          : 'Chưa có danh sách yêu cầu được tách từ phần mô tả.',
      }),
      measure('acceptance-criteria', 'Công việc có cách kiểm tra kết quả', tasks.filter(acTestable).length, count, { target: 80 }),
      measure('foundation', 'Tích hợp, kiểm thử và sửa lỗi', Number(typeCount === 3), tasks.some(task => Object.hasOwn(task, 'taskType')) ? 1 : 0, { target: 100,
        display: typeCount === 3 ? 'Đạt · 3/3' : `Chưa đạt · ${typeCount}/3`, detail: 'Cần ít nhất một công việc cho mỗi nhóm.' }),
      measure('orphans', 'Công việc chưa liên kết với yêu cầu', refs.filter(ids => !ids.length).length, requirements.size ? count : 0, { target: 10, lower: true }),
    ],
    feasibility: [
      measure('load', 'Khối lượng công việc của từng người', overloaded, assigned.size, { target: 0, lower: true, display: `${overloaded}/${assigned.size} người quá tải` }),
      measure('schedule', 'Lịch làm việc có khả thi', Number(schedule?.valid), schedule ? 1 : 0, {
        target: 100, display: schedule?.valid ? 'Đạt' : 'Chưa đạt',
        detail: schedule?.detail,
      }),
      measure('size', 'Công việc ước tính từ 4 đến 16 giờ', tasks.filter(task => task.estimatedHours >= 4 && task.estimatedHours <= 16).length, count, { target: 70 }),
      measure('roles', 'Phân công đúng chuyên môn', tasks.filter(task => members.has(task.assigneeId)
        && normalize(members.get(task.assigneeId).role) === normalize(task.role)).length, members.size ? count : 0, { target: 90 }),
    ],
    grounding: [
      measure('sources', 'Công việc có căn cứ', taskSources.length,
        requirements.size || ragStatus === 'matched' || taskSources.length ? count : 0, {
          target: 85, detail: 'Tính công việc liên kết với yêu cầu bạn nhập hoặc có trích dẫn tài liệu đã kiểm chứng.',
        }),
      measure('quotes', 'Trích dẫn nguyên văn từ tài liệu RAG', metadata.verifiedQuotes ?? 0, metadata.proposedQuotes ?? 0,
        { target: 100, detail: quoteStatus }),
      measure('pert', 'Công việc có giải thích số giờ ước tính (PERT)', tasks.filter(task => {
        const { o, m, p } = task.pert || {};
        return [o, m, p].every(Number.isFinite) && o > 0 && o <= m && m <= p
          && Math.abs((o + 4 * m + p) / 6 - task.estimatedHours) <= 0.051;
      }).length, tasks.some(task => Object.hasOwn(task, 'pert')) ? count : 0, { target: 90 }),
    ],
    acceptance: [
      measure('kept', 'Công việc giữ nguyên', review?.kept, review?.total, { target: 60 }),
      measure('edited', 'Công việc đã sửa', review?.changed, review?.total),
      measure('removed', 'Công việc đã xóa', review?.removed, review?.total),
      measure('review', 'Công việc được đánh dấu cần xem lại', review?.flagged, review?.flagged == null ? 0 : review.total, { target: 20, lower: true }),
    ],
  };

  const similarProjects = findSimilarProjects(input).map(({ project, similarity }) => {
    const requirements = project.requirements.map(requirement => ({
      label: requirement.label,
      matched: requirement.allOf
        ? requirement.allOf.every(terms => tasks.some(task => taskMatches(task, terms)))
        : tasks.some(task => taskMatches(task, requirement.terms)),
    }));
    return {
      id: project.id, title: project.title, dataset: project.dataset,
      similarity: Math.round(similarity * 100),
      matched: requirements.filter(item => item.matched).length,
      total: requirements.length,
    };
  });

  const matchedChunks = Array.isArray(response.ragMetadata?.matchedChunks) ? response.ragMetadata.matchedChunks : [];
  const sourceNames = [...new Set(matchedChunks.map(chunk => chunk?.docName).filter(isText))];
  const groupScores = Object.fromEntries(Object.entries(groups).map(([key, metrics]) => {
    const scored = metrics.flatMap(metric => metric.score == null ? [] : [metric.score]);
    if (!scored.length) return [key, null];
    let average = scored.reduce((sum, value) => sum + value, 0) / scored.length;
    if (key === 'feasibility' && practicality >= 1 && practicality <= 5) {
      average = average * (1 - practicalityWeight) + practicality / 5 * 100 * practicalityWeight;
    }
    return [key, Math.round(average)];
  }));
  const rated = Object.entries(groupScores).filter(([, score]) => score !== null);
  const score = rated.length ? Math.round(rated.reduce((sum, [key, value]) => sum + value * criteria[key].weight, 0)
    / rated.reduce((sum, [key]) => sum + criteria[key].weight, 0)) : null;
  const weakMetrics = Object.entries(groups).flatMap(([group, metrics]) => group === 'acceptance' ? [] :
    metrics.filter(metric => metric.meetsTarget === false).map(metric => `${criteria[group].label} · ${metric.label}: ${metric.display}${metric.detail ? ` · ${metric.detail}` : ''}`));
  return {
    score, groups, groupScores, similarProjects, sourceNames, taskSources, sourceCounts, tasks, totalHours, weakMetrics, loads,
    practicality: practicality ?? null,
    ragRetrieved: response.ragMetadata?.usedRag ?? null,
    telemetry: {
      model: metadata.model ?? null,
      latencyMs: metadata.latencyMs ?? null,
      inputTokens: metadata.inputTokens ?? null,
      outputTokens: metadata.outputTokens ?? null,
    },
  };
}
