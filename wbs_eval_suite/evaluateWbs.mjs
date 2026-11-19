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
const hasTextList = value => Array.isArray(value) && value.length > 0 && value.every(isText);

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

const measure = (id, label, passed, total, detail) => ({
  id, label, passed, total, detail,
  percent: total > 0 ? Math.round(passed * 100 / total) : 0,
});

function taskMatches(task, terms) {
  const fields = [task.title, task.description, ...(Array.isArray(task.subtasks) ? task.subtasks : []),
    ...(Array.isArray(task.acceptanceCriteria) ? task.acceptanceCriteria : [])];
  return fields.some(field => typeof field === 'string' && terms.some(term =>
    ` ${normalize(field)} `.includes(` ${normalize(term)} `)
  ));
}

export function evaluateWbs(response, input, { compareRag = false } = {}) {
  const items = Array.isArray(response.tasks) ? response.tasks : [];
  const tasks = items.filter(task => task && typeof task === 'object' && !Array.isArray(task));
  const sprints = expectedSprints(input);
  const actualSchedule = Array.isArray(response.sprintSchedule) ? response.sprintSchedule : [];
  const sprintByName = new Map(sprints.map(sprint => [sprint.name, sprint]));
  const datesInSprint = task => {
    const sprint = sprintByName.get(task.sprint);
    const start = dateMs(task.startDate);
    const end = dateMs(task.dueDate);
    return sprint && start >= sprint.firstDay && end >= start && end <= sprint.lastDay;
  };
  const scheduleMatches = actualSchedule.length === sprints.length && sprints.every((sprint, index) => {
    const actual = actualSchedule[index];
    return actual?.name === sprint.name && dateMs(actual.startDate) === sprint.firstDay
      && dateMs(actual.endDate) === sprint.lastDay;
  });

  const metadata = response.evaluationMetadata || {};
  const evidenceApplicable = (compareRag || input.useRag === true)
    && (Number.isInteger(metadata.verifiedQuotes) || tasks.some(task => Array.isArray(task.evidence)));
  const totalHours = tasks.reduce((total, task) => total + (Number.isFinite(task.estimatedHours) ? task.estimatedHours : 0), 0);
  const names = new Map(tasks.map(task => [normalize(task.title), task]));
  const members = new Map((input.teamMembers || []).map(member => [member.id, member]));
  const sprintCapacity = new Map(sprints.map(sprint => [sprint.name,
    Math.max(1, Math.round(((sprint.lastDay - sprint.firstDay) / DAY_MS + 1) * 5 / 7)) * 8]));
  const assignments = new Map();
  for (const task of tasks) {
    if (!members.has(task.assigneeId) || !sprintByName.has(task.sprint) || !Number.isFinite(task.estimatedHours)) continue;
    const key = JSON.stringify([task.assigneeId, task.sprint]);
    assignments.set(key, {
      hours: (assignments.get(key)?.hours || 0) + task.estimatedHours,
      capacity: sprintCapacity.get(task.sprint),
    });
  }

  const dependencies = tasks.flatMap(task => (Array.isArray(task.dependencies) ? task.dependencies : []).map(title => {
    const dependency = names.get(normalize(title));
    return dependency && dependency !== task && dateMs(dependency.dueDate) < dateMs(task.startDate);
  }));
  const acTestable = task => Array.isArray(task.acceptanceCriteria) && task.acceptanceCriteria.some(criterion =>
    isText(criterion) && (/\bgiven\b.+\bwhen\b.+\bthen\b|\bkhi\b.+\bthi\b/i.test(normalize(criterion))
      || /\d+(?:[.,]\d+)?\s*(?:%|ms\b|giây\b|phút\b|giờ\b|ngày\b|seconds?\b|minutes?\b)/i.test(criterion))
  );
  const groups = {
    realism: [
      measure('schedule', 'Khung lịch Sprint', Number(scheduleMatches), 1, 'Đối chiếu số Sprint, tên và ngày với cấu hình đầu vào.'),
      measure('dates', 'Công việc nằm trong lịch đã giao', tasks.filter(datesInSprint).length, items.length, 'Ngày hợp lệ và nằm trong Sprint được giao.'),
      measure('size', 'Công việc từ 4 đến 16 giờ', tasks.filter(task => task.estimatedHours >= 4 && task.estimatedHours <= 16).length, items.length, 'Kiểm tra kích thước công việc trên WBS.'),
    ],
    reliability: [
      measure('structure', 'Cấu trúc WBS đầy đủ', tasks.filter(task =>
        isText(task.title) && isText(task.description) && isText(task.role) && hasTextList(task.subtasks)
        && ['High', 'Medium', 'Low'].includes(task.priority)
        && Number.isFinite(task.estimatedHours) && task.estimatedHours >= 0.5 && task.estimatedHours <= 200
      ).length, items.length || 1, 'Có tên, mô tả, vai trò, các bước, độ ưu tiên và ước lượng hợp lệ.'),
    ],
    coverage: [
      measure('acceptance', 'Tiêu chí nghiệm thu kiểm thử được', tasks.filter(acTestable).length, items.length, 'Nhận diện Given/When/Then, Khi/Thì hoặc giá trị có đơn vị.'),
    ],
    verifiability: [
      measure('evidence', 'Công việc có trích dẫn đã đối chiếu', tasks.filter(task => Array.isArray(task.evidence) && task.evidence.length > 0).length,
        evidenceApplicable ? items.length : 0, 'Máy chủ kiểm tra trích dẫn nguyên văn trong đoạn RAG. Người đọc vẫn cần đối chiếu ý nghĩa.'),
    ],
  };
  if (assignments.size) groups.realism.push(measure('capacity', 'Năng lực theo người và Sprint',
    [...assignments.values()].filter(({ hours, capacity }) => hours <= capacity).length, assignments.size,
    'So số giờ được giao với định mức theo thời lượng thực tế của từng Sprint.'));
  if (members.size) groups.realism.push(measure('role', 'Phân công đúng vai trò', tasks.filter(task =>
    members.has(task.assigneeId) && normalize(members.get(task.assigneeId).role) === normalize(task.role)
  ).length, items.length, 'So vai trò đã khai báo với vai trò của người được giao.'));
  if (dependencies.length) groups.realism.push(measure('dependencies', 'Thứ tự phụ thuộc',
    dependencies.filter(Boolean).length, dependencies.length, 'Phụ thuộc phân giải theo tên và phải kết thúc trước ngày bắt đầu việc sau.'));
  if (typeof metadata.directJson === 'boolean') groups.reliability.push(measure('json', 'JSON trực tiếp',
    Number(metadata.directJson), 1, 'Phản hồi Gemini phân tích được dưới dạng JSON trực tiếp.'));
  if (metadata.proposedQuotes > 0) groups.reliability.push(measure('quotes', 'Trích dẫn khớp nguyên văn',
    metadata.verifiedQuotes, metadata.proposedQuotes, 'So nguyên văn với đoạn tài liệu được gắn mã.'));

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
  const groupScores = Object.fromEntries(Object.entries(groups).map(([key, criteria]) => {
    const applicable = criteria.filter(criterion => criterion.total);
    return [key, applicable.length
      ? Math.round(applicable.reduce((sum, criterion) => sum + criterion.passed * 100 / criterion.total, 0) / applicable.length)
      : null];
  }));
  const weights = { realism: 35, reliability: 20, coverage: 30, verifiability: 15 };
  const rated = Object.entries(groupScores).filter(([, score]) => score !== null);
  const score = items.length ? Math.round(rated.reduce((sum, [key, value]) => sum + value * weights[key], 0)
    / rated.reduce((sum, [key]) => sum + weights[key], 0)) : 0;

  return {
    score, groups, groupScores, similarProjects, sourceNames, tasks, totalHours,
    ragRetrieved: response.ragMetadata?.usedRag ?? null,
    telemetry: {
      model: metadata.model ?? null,
      latencyMs: metadata.latencyMs ?? null,
      inputTokens: metadata.inputTokens ?? null,
      outputTokens: metadata.outputTokens ?? null,
    },
  };
}
