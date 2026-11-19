# AI WBS & RAG Planner — Automation Testing Suite

Bộ kiểm thử tự động dành cho ứng dụng React + Express/Node.js + SQLite + Gemini API + Trello API. Suite này được thiết kế để đặt trong thư mục gốc dự án, cùng cấp với `App.jsx`, `App.css` và thư mục backend.

## 1. Cấu trúc thư mục

```text
Autoplan/
├─ App.jsx
├─ App.css
├─ backend/
│  ├─ server.js                 # hoặc file server hiện tại của bạn
│  └─ .env
└─ AI_WBS_Automation_Testing/
   ├─ tests/
   │  ├─ api/backend.api.test.js
   │  ├─ unit/app.test.jsx
   │  ├─ e2e/planner.spec.js
   │  ├─ fixtures/mock-api.js
   │  └─ setup.js
   ├─ performance/k6-health.js
   ├─ playwright.config.js
   ├─ vitest.config.js
   ├─ package.json
   └─ README.md
```

> Nếu `App.jsx` không nằm ngay thư mục gốc, sửa đường dẫn import trong `tests/unit/app.test.jsx` và `vitest.config.js`.

## 2. Yêu cầu

- Windows 10/11
- Node.js 20 LTS trở lên (Node 18.18+ có thể chạy phần lớn suite)
- npm
- Frontend chạy được bằng Vite
- Backend Express chạy được
- Chromium cho Playwright
- (Tuỳ chọn) k6 để kiểm thử tải

## 3. Cài đặt trên Windows PowerShell

Mở PowerShell tại thư mục gốc dự án `C:\PTUDDN\Autoplan`:

```powershell
cd C:\PTUDDN\Autoplan\AI_WBS_Automation_Testing
npm install
npx playwright install chromium

> `package.json` đã khai báo `@vitest/ui` cùng dòng phiên bản với `vitest` để HTML Reporter hoạt động. Nếu máy đã cài dependencies từ ZIP cũ, chạy lại `npm install` trong thư mục này.
```

## 4. Chạy backend ở chế độ test local

Mở **Terminal 1**:

```powershell
cd C:\PTUDDN\Autoplan\backend

$env:PORT="3001"
$env:DEV_ALLOW_UNVERIFIED_JWT="true"

# Đặt chuỗi rỗng để dotenv không nạp khóa JWT thật từ .env vào tiến trình test.
$env:TRELLO_JWT_KEY_1=""
$env:TRELLO_JWT_KEY_2=""

node server.js
```

Nếu file backend của bạn tên `server(1).js`, chạy:

```powershell
node "server(1).js"
```

**Quan trọng:** Chế độ `DEV_ALLOW_UNVERIFIED_JWT=true` chỉ dành cho máy local/test. Không bật trên production, staging công khai hoặc server có dữ liệu thật. Không dùng Trello token thật trong bộ test. Nếu backend yêu cầu biến môi trường khác, giữ nguyên cấu hình `.env` hiện có của dự án.

Kiểm tra backend bằng trình duyệt hoặc PowerShell:

```powershell
Invoke-RestMethod http://127.0.0.1:3001/api/health
```

## 5. Chạy frontend

Mở **Terminal 2** tại thư mục frontend (thư mục có `package.json` của Vite):

```powershell
cd C:\PTUDDN\Autoplan
npm run dev -- --host 127.0.0.1
```

Nếu frontend dùng port khác 5173, truyền `APP_URL` ở bước chạy Playwright.

## 6. Chạy từng nhóm kiểm thử

Mở **Terminal 3**:

```powershell
cd C:\PTUDDN\Autoplan\AI_WBS_Automation_Testing
```

### 6.1 Unit / React component tests

```powershell
npm run test:unit
```

Kiểm tra render giao diện, điều hướng tab, thao tác RAG, validate nội dung và bật/tắt RAG. Báo cáo HTML được tạo tại:

```text
AI_WBS_Automation_Testing\unit-report.html
```

### 6.2 API integration tests

```powershell
npm run test:api
```

Mặc định API URL là `http://127.0.0.1:3001`. Nếu dùng port khác:

```powershell
$env:API_BASE_URL="http://127.0.0.1:3002"
npm run test:api
```

Các test API kiểm tra health, JWT thiếu/sai/đúng, validation breakdown, upload, định dạng file, xóa tài liệu, và điều kiện đầu vào khi đẩy Task sang Trello.

Nếu backend chưa chạy, nhóm API sẽ SKIP có cảnh báo. Không xem SKIP là PASS.

### 6.3 End-to-End tests bằng Playwright

```powershell
npm run test:e2e
```

Nếu frontend không chạy ở port 5173:

```powershell
$env:APP_URL="http://127.0.0.1:4173"
npm run test:e2e
```

Playwright sẽ mở Chromium và kiểm tra giao diện như người dùng. Các luồng AI được mock ở mức HTTP để test ổn định, không tiêu tốn Gemini quota. Trello thật không bị gọi trong các kịch bản E2E mặc định.

Báo cáo HTML:

```powershell
npm run report:e2e
```

Hoặc mở trực tiếp:

```text
AI_WBS_Automation_Testing\playwright-report\index.html
```

Ảnh chụp, video và trace khi lỗi nằm trong `test-results`.

### 6.4 Chạy toàn bộ

Đảm bảo backend và frontend đều đang chạy, sau đó:

```powershell
npm run test:all
```

## 7. Danh sách test case hiện có

| Nhóm | ID | Nội dung |
|---|---|---|
| React UI | UT-UI-01 | Hiển thị màn hình Planner |
| React UI | UT-UI-02 | Điều hướng tab Team |
| React UI | UT-UI-03 | Điều hướng tab RAG |
| React UI | UT-UI-04 | Không upload nội dung rỗng |
| React UI | UT-UI-05 | Gửi tài liệu text tới API |
| React UI | UT-UI-06 | Bật/tắt RAG |
| API | API-01 | Health check |
| API | API-02 | Thiếu JWT |
| API | API-03 | JWT sai |
| API | API-04 | JWT hợp lệ |
| API | API-05 | Task name không hợp lệ |
| API | API-06 | Upload thiếu nội dung |
| API | API-07 | File không hỗ trợ |
| API | API-08 | Xóa tài liệu không tồn tại |
| API | API-09 | Danh sách Task rỗng khi push |
| API | API-10 | Thiếu Trello credentials |
| E2E | E2E-01 | Mở Planner |
| E2E | E2E-02 | Điều hướng Planner/Team/RAG |
| E2E | E2E-03 | Validate số Sprint |
| E2E | E2E-04 | Validate tên dự án |
| E2E | E2E-05 | Render kết quả WBS từ API mock |
| E2E | E2E-06 | Upload RAG rỗng |
| E2E | E2E-07 | Chuyển theme sáng/tối |

## 8. Kiểm thử hiệu năng tuỳ chọn bằng k6

Cài k6 theo hướng dẫn chính thức của Grafana, sau đó chạy:

```powershell
k6 run .\performance\k6-health.js
```

Có thể đổi URL backend:

```powershell
$env:API_BASE_URL="http://127.0.0.1:3001"
k6 run .\performance\k6-health.js
```

Kịch bản mẫu tăng tối đa 10 virtual users và đặt ngưỡng p95 dưới 1 giây cho endpoint health. Đây chỉ là smoke/load test nhẹ, không đại diện cho benchmark tải thực tế của Gemini hoặc Trello.

## 9. Lưu ý khi diễn giải kết quả

- **PASS:** test chạy và đạt assertion.
- **FAIL:** test chạy nhưng kết quả không đúng kỳ vọng; xem stack trace và Playwright trace.
- **SKIP:** test chưa được chạy, ví dụ backend chưa sẵn sàng. Không cộng vào số PASS.
- E2E mock Gemini để kiểm tra luồng UI và xử lý response; cần một vòng kiểm thử tích hợp riêng với Gemini API thật để kiểm tra quota, độ trễ và chất lượng nội dung.
- Trello push thật cần board thử nghiệm và token riêng. Không đưa token vào Git hoặc file test.
- Trước khi nộp báo cáo, chạy lại test trên đúng commit/phiên bản ứng dụng và lưu lại HTML report.

## 10. Xử lý lỗi thường gặp

**API tests trả 401:** backend chưa được khởi động với `DEV_ALLOW_UNVERIFIED_JWT=true`, hoặc JWT keys vẫn được nạp. Dừng backend, đặt hai biến `TRELLO_JWT_KEY_1` và `TRELLO_JWT_KEY_2` thành chuỗi rỗng trong terminal backend, rồi khởi động lại.

**Playwright báo `ERR_CONNECTION_REFUSED`:** frontend chưa chạy hoặc `APP_URL` sai.

**Vitest không tìm thấy `App.css`:** đảm bảo `App.css` nằm cùng thư mục với `App.jsx` và suite được giải nén vào đúng vị trí.

**Không tìm thấy Chromium:** chạy `npx playwright install chromium`.

**Test UI sai tên heading:** giao diện đã được thay đổi; cập nhật locator trong file test tương ứng thay vì bỏ assertion.

### 6.5 Kiểm thử Gemini API thật (tuỳ chọn, có thể tiêu tốn quota)

Chỉ chạy khi backend đã có `GEMINI_API_KEY` hợp lệ và bạn muốn kiểm tra dịch vụ AI thật:

```powershell
$env:RUN_AI_TESTS="true"
npm run test:api
Remove-Item Env:RUN_AI_TESTS
```

Test API-11 xác nhận response có danh sách Task, lịch Sprint, priority hợp lệ và ngày bắt đầu/kết thúc nằm trong lịch Sprint. Test này có thể chậm hoặc thất bại khi Gemini hết quota, quá tải hoặc mất kết nối; không nên chạy ở mọi lần regression test.

**Lỗi `Cannot find package '@vitest/ui/reporter'`:** chạy tại thư mục `AI_WBS_Automation_Testing`:

```powershell
$vitestVersion = node -p "require('./node_modules/vitest/package.json').version"
npm install --save-dev "@vitest/ui@$vitestVersion"
npm ls vitest @vitest/ui
```

Hai package `vitest` và `@vitest/ui` cần cùng phiên bản. Nếu `node_modules/vitest` chưa tồn tại, chạy `npm install` trước.
