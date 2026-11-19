export const referenceProjects = [
  {
    id: 'orders',
    title: 'Quản lý đơn hàng và hoàn tiền',
    description: 'Xây dựng luồng đặt hàng, giữ tồn kho khi đặt hàng, thanh toán và hoàn tiền. Kiểm thử thanh toán lặp để tránh thu tiền hai lần.',
    requirements: [
      { label: 'Đặt hàng', terms: ['đặt hàng', 'tạo đơn hàng'] },
      { label: 'Giữ tồn kho', terms: ['giữ tồn kho', 'giữ hàng', 'đặt trước tồn kho', 'reserve inventory'] },
      { label: 'Hoàn tiền', terms: ['hoàn tiền', 'refund'] },
      { label: 'Chống thu tiền trùng', terms: ['thanh toán lặp', 'chống trùng', 'idempotency', 'thu tiền hai lần'] },
    ],
  },
  {
    id: 'library',
    title: 'Mượn và trả sách thư viện',
    description: 'Cho phép độc giả tra cứu sách, mượn và trả bản sao. Hệ thống ghi nhận ngày đến hạn, thông báo quá hạn và kiểm thử khi mượn bản sao đã hết.',
    requirements: [
      { label: 'Tra cứu sách', terms: ['tra cứu', 'tìm kiếm sách', 'search books'] },
      { label: 'Mượn và trả sách', terms: ['mượn sách', 'trả sách', 'mượn và trả', 'mượn trả'], allOf: [['mượn', 'borrow'], ['trả', 'return']] },
      { label: 'Theo dõi quá hạn', terms: ['quá hạn', 'overdue'] },
      { label: 'Xử lý hết bản sao', terms: ['hết bản sao', 'không còn bản sao', 'hết sách', 'không khả dụng', 'unavailable copy'] },
    ],
  },
  {
    id: 'export',
    title: 'Xuất báo cáo doanh thu ở định dạng CSV',
    description: 'Trong một Sprint, bổ sung bộ lọc khoảng ngày, xuất báo cáo doanh thu CSV bằng UTF-8 và giới hạn chức năng cho người có quyền xem báo cáo.',
    requirements: [
      { label: 'Lọc khoảng ngày', terms: ['khoảng ngày', 'ngày bắt đầu', 'date range'] },
      { label: 'Xuất CSV', terms: ['xuất csv', 'export csv', 'tệp csv', 'file csv'] },
      { label: 'Mã hóa UTF-8', terms: ['utf-8', 'utf8'] },
      { label: 'Phân quyền báo cáo', terms: ['phân quyền', 'quyền xem báo cáo', 'authorization', 'rbac'] },
    ],
  },
  {
    id: 'account-rag',
    title: 'Khôi phục mật khẩu theo chính sách nội bộ',
    description: 'Lập kế hoạch cho tính năng khôi phục mật khẩu theo tài liệu “Chính sách khôi phục mật khẩu”. Bao gồm xử lý yêu cầu, đổi mật khẩu và kiểm thử theo chính sách.',
    requirements: [
      { label: 'Hết hạn sau 20 phút', terms: ['20 phút', '20 minutes'] },
      { label: 'Liên kết dùng một lần', terms: ['dùng một lần', 'sử dụng một lần', 'single-use', 'one-time'] },
      { label: 'Thu hồi phiên đăng nhập', terms: ['thu hồi toàn bộ phiên', 'vô hiệu hóa phiên', 'hủy phiên', 'revoke all sessions'] },
      { label: 'Email sau khi đổi mật khẩu', terms: ['email thông báo', 'gửi email thông báo', 'notification email', 'email notification'] },
    ],
  },
  {
    id: 'storyseek-stackgres-backup',
    title: 'StackGres · Ngăn các bản sao lưu chạy chồng',
    description: 'Điều chỉnh CronJob sao lưu PostgreSQL của StackGres để các lượt sao lưu không chạy đồng thời. Bảo đảm lượt đang chạy hoàn thành bình thường khi đến lịch kế tiếp. Kiểm thử trường hợp tác vụ chạy lâu hơn khoảng cách giữa hai lịch.',
    dataset: { name: 'StorySeek · #2', url: 'https://huggingface.co/datasets/SoftACE/StorySeek' },
    requirements: [
      { label: 'Áp dụng concurrencyPolicy: Forbid cho CronJob', allOf: [['concurrencyPolicy', 'concurrency policy'], ['forbid']] },
      { label: 'Kiểm thử hai lượt theo lịch bị chồng', terms: ['chạy chồng', 'chạy đồng thời', 'chạy song song', 'overlapping jobs', 'concurrent backups'] },
    ],
  },
  {
    id: 'storyseek-stackgres-parameters',
    title: 'StackGres · Hiển thị tham số PostgreSQL',
    description: 'Cập nhật biểu mẫu SGPostgresConfig trong web console. Người dùng cần xem các tham số tùy chỉnh, giá trị mặc định và nhận biết đâu là giá trị được thiết lập theo phiên bản StackGres. Kiểm thử cả cấu hình tùy chỉnh và cấu hình rỗng.',
    dataset: { name: 'StorySeek · #4', url: 'https://huggingface.co/datasets/SoftACE/StorySeek' },
    requirements: [
      { label: 'Biểu mẫu SGPostgresConfig', terms: ['SGPostgresConfig', 'SG Postgres Config'] },
      { label: 'Hiển thị giá trị mặc định', terms: ['giá trị mặc định', 'default values'] },
      { label: 'Đối chiếu phiên bản StackGres', terms: ['phiên bản StackGres', 'StackGres version'] },
    ],
  },
];
