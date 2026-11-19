import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE_URL = (process.env.TEST_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
const BOARD_ID = process.env.TEST_BOARD_ID || 'test_board_001';
const MEMBER_ID = process.env.TEST_MEMBER_ID || 'test_member_001';

function makeDevJwt() {
  // Backend test mode decodes JWT payload without signature verification.
  // Enable ONLY on a local test server with no TRELLO_JWT_KEY_1/2 configured.
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    idBoard: BOARD_ID,
    idMember: MEMBER_ID,
    state: { boardId: BOARD_ID }
  })}.test-signature`;
}
const token = makeDevJwt();
const auth = { Authorization: `Bearer ${token}` };

async function request(path, options = {}) {
  return fetch(`${BASE_URL}${path}`, options);
}
async function json(response) {
  return response.json();
}

before(async () => {
  const r = await request('/api/health');
  assert.equal(r.status, 200,
    `Backend không chạy tại ${BASE_URL}. Hãy khởi động server trước khi chạy test.`);
});

test('TC01 - Health check trả về trạng thái OK', async () => {
  const r = await request('/api/health');
  const body = await json(r);
  assert.equal(r.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.status, 'OK');
  assert.ok(Array.isArray(body.generationModels));
  assert.ok(body.embeddingModel);
  assert.ok(Number(body.embeddingDim) > 0);
});

test('TC02 - Chặn truy cập danh sách tài liệu khi thiếu JWT', async () => {
  const r = await request('/api/documents');
  const body = await json(r);
  assert.equal(r.status, 401);
  assert.equal(body.success, false);
});

test('TC03 - Chặn JWT không hợp lệ', async () => {
  const r = await request('/api/documents', {
    headers: { Authorization: 'Bearer invalid-token' }
  });
  assert.equal(r.status, 401);
});

test('TC04 - Lấy danh sách tài liệu với JWT hợp lệ', async () => {
  const r = await request('/api/documents', { headers: auth });
  const body = await json(r);
  assert.equal(r.status, 200);
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.documents));
});

test('TC05 - Từ chối breakdown khi tên Task ngắn hơn 3 ký tự', async () => {
  const r = await request('/api/breakdown', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      taskName: 'AB', useRag: false, sprintCount: 2,
      sprintStartDate: '2026-11-09', sprintDurationDays: 14
    })
  });
  const body = await json(r);
  assert.equal(r.status, 400);
  assert.equal(body.success, false);
  assert.match(body.error, /ít nhất 3 ký tự/i);
});

test('TC06 - Từ chối upload khi không có file hoặc textContent', async () => {
  const r = await request('/api/documents', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ docName: 'Empty document' })
  });
  const body = await json(r);
  assert.equal(r.status, 400);
  assert.equal(body.success, false);
});

test('TC07 - Từ chối định dạng file không hỗ trợ', async () => {
  const form = new FormData();
  form.append('file', new Blob(['malicious test file']), 'payload.exe');
  const r = await request('/api/documents', {
    method: 'POST',
    headers: auth,
    body: form
  });
  const body = await json(r);
  assert.equal(r.status, 400);
  assert.equal(body.success, false);
  assert.match(body.error, /\.pdf|\.txt|\.md|\.json|\.csv/i);
});

test('TC08 - Xóa tài liệu không tồn tại trả về 404', async () => {
  const r = await request('/api/documents/non_existing_document_id', {
    method: 'DELETE',
    headers: auth
  });
  const body = await json(r);
  assert.equal(r.status, 404);
  assert.equal(body.success, false);
});

test('TC09 - Breakdown với payload hợp lệ và useRag=false (cần Gemini API)', {
  skip: process.env.RUN_AI_TESTS !== 'true'
}, async () => {
  const start = '2026-11-09';
  const r = await request('/api/breakdown', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      taskName: 'Xây dựng website bán hàng',
      description: 'Có đăng nhập, quản lý sản phẩm, giỏ hàng và thanh toán.',
      teamSize: 3,
      methodology: 'Agile',
      useRag: false,
      sprintPrefix: 'Sprint',
      sprintCount: 2,
      sprintStartDate: start,
      sprintDurationDays: 14,
      teamMembers: [
        { id: 'member_backend_001', fullName: 'Backend Dev', role: 'Backend Developer' },
        { id: 'member_frontend_01', fullName: 'Frontend Dev', role: 'Frontend Developer' },
        { id: 'member_qa_000001', fullName: 'QA Tester', role: 'QA / Tester' }
      ]
    })
  });
  const body = await json(r);
  assert.equal(r.status, 200, JSON.stringify(body));
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.tasks) && body.tasks.length > 0);
  assert.equal(body.sprintSchedule.length, 2);

  const allowedSprints = new Set(body.sprintSchedule.map(s => s.name));
  for (const task of body.tasks) {
    assert.ok(task.title?.trim(), 'Task phải có title');
    assert.ok(task.description !== undefined);
    assert.ok(['High', 'Medium', 'Low'].includes(task.priority));
    assert.ok(allowedSprints.has(task.sprint), `Sprint không hợp lệ: ${task.sprint}`);
    assert.ok(Array.isArray(task.subtasks) && task.subtasks.length > 0);
    assert.ok(task.estimatedHours >= 0.5 && task.estimatedHours <= 200);
    assert.match(task.startDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(task.dueDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(task.dueDate >= task.startDate);
    const sprint = body.sprintSchedule.find(s => s.name === task.sprint);
    assert.ok(task.startDate >= sprint.startDate && task.startDate <= sprint.endDate);
    assert.ok(task.dueDate >= sprint.startDate && task.dueDate <= sprint.endDate);
  }
});

test('TC10 - Breakdown có tên hợp lệ nhưng không có Gemini key phải trả lỗi có kiểm soát', {
  skip: process.env.RUN_NO_KEY_TEST !== 'true'
}, async () => {
  const r = await request('/api/breakdown', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      taskName: 'Kiểm thử lỗi cấu hình Gemini',
      useRag: false,
      sprintCount: 1,
      sprintStartDate: '2026-11-09',
      sprintDurationDays: 7
    })
  });
  const body = await json(r);
  assert.ok([500, 503].includes(r.status));
  assert.equal(body.success, false);
  assert.ok(body.error);
});

test('TC11 - Header bảo mật được thiết lập', async () => {
  const r = await request('/api/health');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.ok(r.headers.get('content-security-policy'));
});
