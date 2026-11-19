
import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Đường dẫn thư mục gốc AI_WBS_Automation_Testing
const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Thư mục gốc của dự án kiểm thử
  root: rootDir,

  // Cấu hình module
  resolve: {
    // Đảm bảo React và React DOM được dùng thống nhất
    dedupe: ['react', 'react-dom'],

    // Ưu tiên sử dụng React được cài trong dự án kiểm thử
    alias: [
      {
        find: /^react$/,
        replacement: path.resolve(rootDir, 'node_modules/react'),
      },
      {
        find: /^react-dom$/,
        replacement: path.resolve(rootDir, 'node_modules/react-dom'),
      },
    ],
  },

  // Cấu hình Vitest
  test: {
    // Chỉ chạy các file Unit Test
    include: ['tests/unit/**/*.test.jsx'],

    // Môi trường giả lập trình duyệt
    environment: 'jsdom',

    // File cấu hình chạy trước các test
    setupFiles: [
      path.resolve(rootDir, 'tests/setup.js'),
    ],

    // Hỗ trợ kiểm thử CSS
    css: true,

    // Xóa lịch sử mock trước mỗi test
    clearMocks: true,

    // Khôi phục mock sau mỗi test
    restoreMocks: true,

    // Thời gian tối đa cho mỗi test
    testTimeout: 15000,

    // Xuất báo cáo
    reporters: ['default', 'html'],

    // Đường dẫn lưu báo cáo HTML
    outputFile: {
      html: path.resolve(rootDir, 'unit-report.html'),
    },
  },
});
