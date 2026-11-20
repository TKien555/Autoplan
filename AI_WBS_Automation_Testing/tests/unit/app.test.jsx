import React from 'react';

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';

import {
  render,
  screen,
  waitFor,
  cleanup,
} from '@testing-library/react';

import userEvent from '@testing-library/user-event';

import App from '../../../frontend/src/App.jsx';
import PlanningCharts from '../../../frontend/src/PlanningCharts.jsx';
import { mockFetch } from '../fixtures/mock-api.js';

// =====================================================
// AI WBS & RAG Planner - React Component Tests
// =====================================================

describe('AI WBS & RAG Planner - React component tests', () => {

  // ---------------------------------------------------
  // Setup trước mỗi test
  // ---------------------------------------------------
  beforeEach(() => {
    const { fetchMock } = mockFetch();

    // Mock API fetch
    vi.stubGlobal('fetch', vi.fn(fetchMock));

    // Mock requestAnimationFrame
    vi.stubGlobal(
      'requestAnimationFrame',
      (callback) => setTimeout(callback, 0)
    );
  });

  // ---------------------------------------------------
  // Cleanup sau mỗi test
  // ---------------------------------------------------
  afterEach(() => {
    // Xóa các component đã render
    cleanup();

    // Khôi phục các global đã mock
    vi.unstubAllGlobals();

    // Khôi phục các function mock
    vi.restoreAllMocks();
  });

  // ===================================================
  // UT-UI-01: Hiển thị màn hình lập kế hoạch mặc định
  // ===================================================
  it('UT-UI-01: hiển thị màn hình lập kế hoạch mặc định', () => {
    render(<App />);

    // Kiểm tra tiêu đề màn hình
    expect(
      screen.getByText(/Lập kế hoạch Đa Sprint/)
    ).toBeInTheDocument();

    // Kiểm tra ô nhập tên dự án
    expect(
      screen.getByPlaceholderText(
        'Nhập tên công việc hoặc dự án lớn...'
      )
    ).toBeInTheDocument();

    // Kiểm tra ô nhập yêu cầu nghiệp vụ
    expect(
      screen.getByPlaceholderText(
        'Nhập chi tiết yêu cầu nghiệp vụ, phạm vi chức năng...'
      )
    ).toBeInTheDocument();
  });

  it('tính hơn sáu Sprint và cắt Sprint cuối theo hạn dự án', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByText(/^6 Sprint · Kết thúc/)).toBeInTheDocument();
    const duration = screen.getByLabelText('Tổng thời gian (tuần)');
    await user.clear(duration);
    await user.type(duration, '15');
    expect(screen.getByText(/^8 Sprint · Kết thúc/)).toBeInTheDocument();
    const last = screen.getByText('Sprint 8:').parentElement.textContent;
    const dates = last.match(/\d{4}-\d{2}-\d{2}/g);
    expect((Date.parse(dates[1]) - Date.parse(dates[0])) / 86400000 + 1).toBe(7);
  });

  it('tính đúng định mức Sprint cuối và phân biệt người trùng tên', async () => {
    const user = userEvent.setup();
    render(<PlanningCharts mode="workload" onResize={() => {}}
      tasks={[
        { _uid: 'a', title: 'Kiểm thử thanh toán', assigneeId: 'first', sprint: 'Sprint 8', estimatedHours: 42 },
        { _uid: 'b', title: 'Duyệt giao diện', assigneeId: 'second', sprint: 'Sprint 8', estimatedHours: 8 },
      ]}
      sprintSchedule={[{ name: 'Sprint 8', startDate: '2027-04-12', endDate: '2027-04-18' }]}
      boardMembers={[{ id: 'first', fullName: 'Minh' }, { id: 'second', fullName: 'Minh' }]} />);
    const overloaded = screen.getByRole('button', { name: 'Minh, Sprint 8: 42 giờ trên 40 giờ' });
    expect(overloaded.closest('td')).toHaveClass('over');
    expect(screen.getByRole('button', { name: 'Minh, Sprint 8: 8 giờ trên 40 giờ' }).closest('td')).not.toHaveClass('over');
    await user.click(overloaded);
    expect(screen.getByText('Kiểm thử thanh toán · 42h')).toBeVisible();
    expect(screen.queryByText('Duyệt giao diện · 8h')).not.toBeInTheDocument();
  });

  it('refines once, shows the task source and counts acceptance only after review', async () => {
    const user = userEvent.setup();
    const breakdowns = [];
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      if (!url.endsWith('/breakdown')) return { ok: true, json: async () => ({ success: true, documents: [] }) };
      const input = JSON.parse(options.body);
      breakdowns.push(input);
      const types = input.refinementFeedback ? ['testing', 'integration', 'bugfix'] : ['testing'];
      return { ok: true, json: async () => ({
        success: true,
        requirements: [{ id: 'REQ-01', text: 'Giữ tồn kho khi đặt hàng.' }],
        tasks: types.map(taskType => ({
          title: `Kiểm tra tồn kho · ${taskType}`, taskType, description: 'Giữ hàng', reqIds: ['REQ-01'],
          role: 'QA', priority: 'High', estimatedHours: 8, sprint: 'Sprint 1', startDate: input.sprintStartDate,
          dueDate: input.sprintStartDate, pert: { o: 4, m: 8, p: 12 }, needsReview: false,
          acceptanceCriteria: ['Khi đã hết hàng thì không giữ thêm'],
        })),
      }) };
    }));
    render(<App />);
    await user.click(screen.getByRole('button', { name: /Tự động phân rã/ }));
    await waitFor(() => expect(screen.getAllByText('🟢 Có nguồn')).toHaveLength(3));
    expect(breakdowns).toHaveLength(2);
    expect(breakdowns[1].refinementFeedback.join(' ')).toContain('Tích hợp, kiểm thử và sửa lỗi');
    await user.click(screen.getAllByText('Căn cứ và ước lượng')[0]);
    expect(screen.getAllByText(/Giữ tồn kho khi đặt hàng/)[0]).toBeVisible();
    await user.click(screen.getByRole('button', { name: /Xem đánh giá WBS vừa sinh/ }));
    expect(screen.getByText('Công việc giữ nguyên · N/A')).toBeInTheDocument();
    expect(screen.getByText('Chỉ từ yêu cầu bạn nhập: 3 công việc')).toBeInTheDocument();
    expect(screen.getByText('Chỉ từ tài liệu RAG: 0 công việc')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Xác nhận đã duyệt WBS/ }));
    expect(screen.getByText('Công việc giữ nguyên · 100% (3/3)')).toBeInTheDocument();
  });

  // ===================================================
  // UT-UI-02: Điều hướng sang tab quản lý nhóm
  // ===================================================
  it('UT-UI-02: điều hướng sang tab quản lý nhóm', async () => {
    const user = userEvent.setup();

    render(<App />);

    // Nhấn nút Vai trò nhóm
    const teamButton = screen.getByRole('button', {
      name: /Vai trò nhóm/,
    });

    await user.click(teamButton);

    // Kiểm tra nội dung quản lý nhóm
    expect(
      screen.getByText(/Phân vai trò thành viên trong Board/i)
    ).toBeInTheDocument();
  });

  // ===================================================
  // UT-UI-03: Điều hướng sang tab RAG
  // ===================================================
  it('UT-UI-03: điều hướng sang tab RAG và hiển thị hai chế độ nạp dữ liệu', async () => {
    const user = userEvent.setup();

    render(<App />);

    // Chuyển sang tab RAG
    await user.click(
      screen.getByRole('button', { name: /RAG \(/ })
    );

    // Kiểm tra chức năng tải file
    expect(
      screen.getByRole('button', { name: /Tải File/ })
    ).toBeInTheDocument();

    // Kiểm tra chức năng nhập văn bản trực tiếp
    expect(
      screen.getByRole('button', {
        name: /Nhập văn bản trực tiếp/,
      })
    ).toBeInTheDocument();
  });

  // ===================================================
  // UT-UI-04: Không cho gửi tài liệu khi nội dung rỗng
  // ===================================================
  it('UT-UI-04: không cho gửi tài liệu khi nội dung văn bản rỗng', async () => {
    const user = userEvent.setup();

    render(<App />);

    // Chuyển sang tab RAG
    await user.click(
      screen.getByRole('button', { name: /RAG \(/ })
    );

    // Chọn chế độ nhập văn bản trực tiếp
    await user.click(
      screen.getByRole('button', {
        name: /Nhập văn bản trực tiếp/,
      })
    );

    // Gửi tài liệu khi chưa nhập nội dung
    await user.click(
      screen.getByRole('button', {
        name: /Nạp vào Bộ nhớ Tri thức/,
      })
    );

    // Kiểm tra thông báo yêu cầu nhập nội dung
    expect(
      await screen.findByText(
        /Vui lòng nhập nội dung tài liệu chuyên môn/
      )
    ).toBeInTheDocument();
  });

  // ===================================================
  // UT-UI-05: Gửi tài liệu lên API thành công
  // ===================================================
  it('UT-UI-05: gửi nội dung tài liệu lên API và xử lý phản hồi thành công', async () => {
    const user = userEvent.setup();

    // Tạo mock API và lưu lịch sử request
    const { fetchMock, calls } = mockFetch();

    // Sử dụng mock API riêng cho test này
    vi.stubGlobal('fetch', vi.fn(fetchMock));

    render(<App />);

    // Chuyển sang tab RAG
    await user.click(
      screen.getByRole('button', { name: /RAG \(/ })
    );

    // Chọn chế độ nhập văn bản trực tiếp
    await user.click(
      screen.getByRole('button', {
        name: /Nhập văn bản trực tiếp/,
      })
    );

    // Nhập tên tài liệu
    const titleInput = screen.getByPlaceholderText(
      'VD: Quy chuẩn API Backend & Database'
    );

    await user.clear(titleInput);
    await user.type(titleInput, 'Quy chuẩn kiểm thử');

    // Nhập nội dung tài liệu
    const contentInput = screen.getByPlaceholderText(
      'Dán nội dung kiến trúc, quy trình test, coding convention vào đây...'
    );

    await user.type(
      contentInput,
      'Mỗi API phải kiểm tra đầu vào và quyền truy cập.'
    );

    // Gửi tài liệu lên API
    await user.click(
      screen.getByRole('button', {
        name: /Nạp vào Bộ nhớ Tri thức/,
      })
    );

    // Kiểm tra API nhận được request POST /api/documents
    await waitFor(() => {
      const documentRequest = calls.some((call) => {
        return (
          call.url?.includes('/api/documents') &&
          call.options?.method?.toUpperCase() === 'POST'
        );
      });

      expect(documentRequest).toBe(true);
    });
  });

  // ===================================================
  // UT-UI-06: Bật/tắt chế độ sử dụng RAG
  // ===================================================
  it('UT-UI-06: bật/tắt chế độ sử dụng RAG', async () => {
    const user = userEvent.setup();

    render(<App />);

    // Lấy checkbox sử dụng tri thức chuyên môn
    const checkbox = screen.getByRole('checkbox', {
      name: /Sử dụng tri thức chuyên môn/,
    });

    // Kiểm tra trạng thái mặc định
    expect(checkbox).toBeChecked();

    // Tắt chế độ RAG
    await user.click(checkbox);

    // Kiểm tra trạng thái sau khi tắt
    expect(checkbox).not.toBeChecked();

    // Bật lại chế độ RAG
    await user.click(checkbox);

    // Kiểm tra trạng thái sau khi bật
    expect(checkbox).toBeChecked();
  });

});
