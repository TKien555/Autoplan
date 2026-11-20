import { test, expect } from '@playwright/test';

const mockTasksResponse = {
  success: true,
  tasks: [{
    title: 'Thiết kế API đăng nhập',
    description: 'Xây dựng API xác thực người dùng',
    role: 'Backend Developer',
    priority: 'High',
    subtasks: ['Thiết kế endpoint', 'Viết unit test'],
    deliverables: 'Tài liệu API đăng nhập',
    acceptanceCriteria: ['Thông báo lỗi khi mật khẩu không đúng'],
    edgeCases: ['Mật khẩu hết hạn'],
    assignee: '',
    estimatedHours: 8,
    sprint: 'Sprint 1',
    startDate: '2026-11-09',
    dueDate: '2026-11-12'
  }],
  ragMetadata: { usedRag: false, matchedChunks: [] }
};

test.beforeEach(async ({ page }) => {
  await page.route('https://p.trellocdn.com/**', route => route.abort());
  await page.route('**/api/documents', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, documents: [] }) });
    } else {
      await route.continue();
    }
  });
  await page.goto('/');
  await expect(page.locator('#powerup-content')).toBeVisible();
});

test('E2E-01: mở ứng dụng và hiển thị form lập kế hoạch', async ({ page }) => {
  await expect(page.getByPlaceholder('Nhập tên công việc hoặc dự án lớn...')).toBeVisible();
  await expect(page.getByPlaceholder('Nhập chi tiết yêu cầu nghiệp vụ, phạm vi chức năng...')).toBeVisible();
  await expect(page.getByText(/Cấu hình Lộ trình Đa Sprint/)).toBeVisible();
});

test('E2E-02: điều hướng giữa Planner, Team và RAG', async ({ page }) => {
  await page.getByRole('button', { name: /Vai trò nhóm/ }).click();
  await expect(page.getByText(/Phân vai trò thành viên trong Board/i)).toBeVisible();
  await page.getByRole('button', { name: /RAG \(/ }).click();
  await expect(page.getByRole('button', { name: /Nhập văn bản trực tiếp/ })).toBeVisible();
  await page.getByRole('button', { name: /Lập kế hoạch Đa Sprint/ }).click();
  await expect(page.getByPlaceholder('Nhập tên công việc hoặc dự án lớn...')).toBeVisible();
});

test('E2E-03: tính số Sprint từ thời lượng dự án và hỗ trợ hơn 6 Sprint', async ({ page }) => {
  await expect(page.getByRole('status').filter({ hasText: '6 Sprint' })).toBeVisible();
  await page.getByLabel('Tổng thời gian (tuần)').fill('15');
  await expect(page.getByRole('status').filter({ hasText: '8 Sprint' })).toBeVisible();
});

test('E2E-04: không cho tạo kế hoạch khi tên dự án ngắn hơn 3 ký tự', async ({ page }) => {
  const name = page.getByPlaceholder('Nhập tên công việc hoặc dự án lớn...');
  await name.fill('AB');
  await page.getByRole('button', { name: /Tự động phân rã|Chia lại Task/ }).click();
  await expect(page.locator('.pu-error-banner')).toContainText('ít nhất 3 ký tự');
});

test('E2E-05: sinh WBS và hiển thị Task khi API trả kết quả hợp lệ', async ({ page }) => {
  await page.route('**/api/breakdown', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockTasksResponse) });
  });
  await page.getByPlaceholder('Nhập tên công việc hoặc dự án lớn...').fill('Xây dựng hệ thống quản lý đơn hàng');
  await page.getByPlaceholder('Nhập chi tiết yêu cầu nghiệp vụ, phạm vi chức năng...').fill('Quản lý đơn hàng, thanh toán và theo dõi trạng thái.');
  await page.getByRole('button', { name: /Tự động phân rã|Chia lại Task/ }).click();
  await expect(page.getByRole('textbox', { name: 'Tên công việc', exact: true })).toHaveValue('Thiết kế API đăng nhập');
  await page.getByText('Đầu ra và nghiệm thu', { exact: true }).click();
  await expect(page.getByText('Tài liệu API đăng nhập', { exact: false })).toBeVisible();
  await expect(page.getByText('Mật khẩu hết hạn')).toBeVisible();
  await page.getByRole('button', { name: 'Lịch Gantt' }).click();
  const chart = page.getByRole('region', { name: 'Lịch Gantt' });
  await expect(chart.getByText('Thiết kế API đăng nhập')).toBeVisible();
  await chart.getByLabel('Tìm công việc').fill('không trùng');
  await expect(chart.getByText('Không có công việc khớp bộ lọc.')).toBeVisible();
  await page.getByRole('button', { name: 'Khối lượng theo Sprint' }).click();
  const workload = page.getByRole('region', { name: 'Khối lượng theo Sprint' });
  await workload.getByRole('button', { name: 'Chưa phân công, Sprint 1: 8 giờ' }).click();
  await expect(workload.getByText('Thiết kế API đăng nhập · 8h')).toBeVisible();
});

test('E2E-06: hiển thị cảnh báo khi nạp tài liệu RAG không có nội dung', async ({ page }) => {
  await page.getByRole('button', { name: /RAG \(/ }).click();
  await page.getByRole('button', { name: /Nhập văn bản trực tiếp/ }).click();
  await page.getByRole('button', { name: /Nạp vào Bộ nhớ Tri thức/ }).click();
  await expect(page.locator('.pu-error-banner')).toContainText(/Vui lòng nhập nội dung tài liệu chuyên môn/i);
});

test('E2E-07: chuyển đổi giao diện sáng/tối', async ({ page }) => {
  const themeButton = page.locator('.pu-theme-toggle-btn');
  await themeButton.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await themeButton.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('Connector Trello đăng ký Power-Up và mở đúng Planner', async ({ page }) => {
  const sdk = 'https://p.trellocdn.com/**';
  await page.unroute(sdk);
  await page.route(sdk, route => route.fulfill({
    contentType: 'application/javascript',
    body: 'window.TrelloPowerUp = { initialize(options) { window.powerUpOptions = options; } };'
  }));
  await page.goto('/connector.html');
  const registered = await page.evaluate(() => {
    const options = window.powerUpOptions;
    if (!options) return null;
    const [button] = options['card-buttons']();
    return button.callback({ popup: config => config.url });
  });
  expect(registered).toBe('./?view=app');
  await expect(page.locator('#powerup-content')).toHaveCount(0);
});
