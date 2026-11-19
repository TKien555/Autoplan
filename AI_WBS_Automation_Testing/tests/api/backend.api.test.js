import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE_URL = (process.env.API_BASE_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');
// Backend dev middleware accepts this legacy base64 JSON token only when
// DEV_ALLOW_UNVERIFIED_JWT=true and no Trello JWT public keys are configured.
const AUTH_TOKEN = process.env.TEST_AUTH_TOKEN || Buffer.from(JSON.stringify({
  boardId: 'automation-test-board',
  memberId: 'automation-test-member'
})).toString('base64');
const authHeaders = { Authorization: `Bearer ${AUTH_TOKEN}` };
let backendAvailable = false;

before(async () => {
  try {
    const response = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(3000) });
    backendAvailable = response.ok;
  } catch {
    backendAvailable = false;
  }
  if (!backendAvailable) console.warn(`\n[API TEST] Không kết nối được ${BASE_URL}. Hãy khởi động backend trước.\n`);
});

after(() => {});

const apiTest = (name, fn) => test(name, { skip: !backendAvailable }, fn);

apiTest('API-01: GET /api/health trả trạng thái OK', async () => {
  const res = await fetch(`${BASE_URL}/api/health`);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.status, 'OK');
  assert.ok(Array.isArray(body.generationModels));
});

apiTest('API-02: từ chối GET /api/documents khi thiếu JWT', async () => {
  const res = await fetch(`${BASE_URL}/api/documents`);
  assert.equal(res.status, 401);
});

apiTest('API-03: từ chối JWT sai', async () => {
  const res = await fetch(`${BASE_URL}/api/documents`, {
    headers: { Authorization: 'Bearer invalid-token' }
  });
  assert.equal(res.status, 401);
});

apiTest('API-04: JWT test hợp lệ lấy được danh sách tài liệu', async () => {
  const res = await fetch(`${BASE_URL}/api/documents`, { headers: authHeaders });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.documents));
});

apiTest('API-05: từ chối breakdown khi taskName dưới 3 ký tự', async () => {
  const res = await fetch(`${BASE_URL}/api/breakdown`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskName: 'AB', useRag: false })
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.match(body.error, /ít nhất 3 ký tự/i);
});

apiTest('API-06: từ chối upload khi không có file hoặc textContent', async () => {
  const res = await fetch(`${BASE_URL}/api/documents`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ docName: 'Empty document' })
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.match(body.error, /đính kèm file hoặc nhập nội dung/i);
});

apiTest('API-07: từ chối file có định dạng không hỗ trợ', async () => {
  const form = new FormData();
  form.append('file', new Blob(['not executable'], { type: 'application/octet-stream' }), 'payload.exe');
  const res = await fetch(`${BASE_URL}/api/documents`, {
    method: 'POST', headers: authHeaders, body: form
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.match(body.error, /Chỉ hỗ trợ định dạng/i);
});

apiTest('API-08: xóa tài liệu không tồn tại trả về 404', async () => {
  const res = await fetch(`${BASE_URL}/api/documents/automation-doc-does-not-exist`, {
    method: 'DELETE', headers: authHeaders
  });
  assert.equal(res.status, 404);
});

apiTest('API-09: từ chối đẩy danh sách Task rỗng lên Trello', async () => {
  const res = await fetch(`${BASE_URL}/api/trello/push-tasks`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ trelloApiKey: 'fake-key', trelloToken: 'fake-token', tasks: [] })
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.match(body.error, /Danh sách công việc/i);
});

apiTest('API-10: từ chối đẩy Task khi thiếu Trello credentials', async () => {
  const res = await fetch(`${BASE_URL}/api/trello/push-tasks`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tasks: [{ title: 'Test task', estimatedHours: 2, sprint: 'Sprint 1' }] })
  });
  const body = await res.json();
  assert.equal(res.status, 400, JSON.stringify(body));
  assert.match(body.error, /Chưa kết nối tài khoản Trello/i);
});

test('API-11: tích hợp Gemini sinh Task và lịch Sprint (bật RUN_AI_TESTS=true)', {
  skip: !backendAvailable || process.env.RUN_AI_TESTS !== 'true'
}, async () => {
  const res = await fetch(`${BASE_URL}/api/breakdown`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      taskName: 'Xây dựng hệ thống quản lý đơn hàng',
      description: 'Quản lý đơn hàng, thanh toán và trạng thái giao hàng.',
      teamSize: 3,
      roles: 'BA, Backend Developer, QA Tester',
      methodology: 'Agile',
      useRag: false,
      sprintPrefix: 'Automation Sprint',
      sprintCount: 2,
      sprintStartDate: '2026-11-09',
      sprintDurationDays: 7
    })
  });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.tasks) && body.tasks.length > 0);
  assert.equal(body.sprintSchedule.length, 2);
  for (const task of body.tasks) {
    assert.ok(task.title && task.title.length >= 3);
    assert.ok(['High', 'Medium', 'Low'].includes(task.priority));
    assert.ok(Array.isArray(task.subtasks));
    assert.ok(task.estimatedHours >= 0.5 && task.estimatedHours <= 200);
    assert.ok(task.dueDate >= task.startDate);
    assert.ok(body.sprintSchedule.some(s => s.name === task.sprint));
  }
});
