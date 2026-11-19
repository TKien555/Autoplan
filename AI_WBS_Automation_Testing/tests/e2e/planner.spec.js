import { test, expect } from '@playwright/test';

const mockTasksResponse = {
  success: true,
  tasks: [{
    title: 'Thiết kế API đăng nhập',
    description: 'Xây dựng API xác thực người dùng',
    role: 'Backend Developer',
    priority: 'High',
    subtasks: ['Thiết kế endpoint', 'Viết unit test'],
    assignee: '',
    estimatedHours: 8,
    sprint: 'Sprint 1',
    startDate: '2026-11-09',
    dueDate: '2026-11-12'
  }],
  ragMetadata: { usedRag: false, matchedChunks: [] }
};

test.beforeEach(async ({ page }) => {
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
  await expect(page.getByRole('button', { name: /Tự động phân rã|Chia lại Task/ })).toBeDisabled();
});

test('E2E-05: sinh WBS và hiển thị Task khi API trả kết quả hợp lệ', async ({ page }) => {
  await page.route('**/api/breakdown', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mockTasksResponse) });
  });
  await page.getByPlaceholder('Nhập tên công việc hoặc dự án lớn...').fill('Xây dựng hệ thống quản lý đơn hàng');
  await page.getByPlaceholder('Nhập chi tiết yêu cầu nghiệp vụ, phạm vi chức năng...').fill('Quản lý đơn hàng, thanh toán và theo dõi trạng thái.');
  await page.getByRole('button', { name: /Tự động phân rã|Chia lại Task/ }).click();
  await expect(page.getByText('Thiết kế API đăng nhập')).toBeVisible();
  await expect(page.getByText(/Sprint 1/).first()).toBeVisible();
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
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await themeButton.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
