# Autoplan

Autoplan là Trello Power-Up dùng Gemini để phân rã công việc thành WBS theo Sprint, bổ sung ngữ cảnh RAG, đánh giá kết quả và đẩy công việc đã duyệt lên Trello.

## Chạy Power-Up

Dùng Node.js 24 và npm. Cài dependency theo lockfile, build frontend, rồi chạy Express để phục vụ cả Power-Up và API trên cùng origin.

```sh
npm ci --prefix frontend
npm ci --prefix backend
npm run build --prefix frontend
npm start --prefix backend
```

Trước khi build, đặt `VITE_TRELLO_API_KEY` trong `frontend/.env` nếu dùng OAuth Trello. Trong `backend/.env`, đặt `GEMINI_API_KEY`, `POWERUP_ID`, `TRELLO_JWT_KEY_1` (public key RSA PEM) và giữ `DEV_ALLOW_UNVERIFIED_JWT=false`. Nếu chạy qua reverse proxy, dùng `TRUST_PROXY` khớp số lớp proxy. Có thể dùng `SQLITE_PATH` để chọn tệp SQLite trên ổ lưu trữ bền vững. Nếu không cấu hình, backend dùng `backend/knowledge_base.db`; bản cài mới sẽ tạo cơ sở dữ liệu riêng.

Trỏ ngrok hoặc reverse proxy HTTPS tới ứng dụng chạy ở cổng 3001. Trong cổng quản trị Trello Power-Up, đặt iframe connector là `https://<origin>/connector.html`, bật **Card Buttons** và **Card Back Section**, rồi cài Power-Up vào board. Mở một thẻ và bấm **Lập kế hoạch AI**. Có thể kiểm tra giao diện tại `/?view=app` và trạng thái backend tại `/api/health`.

Khi phát triển, chạy `npm run dev --prefix frontend` cùng backend. Vite chuyển tiếp `/api` đến cổng 3001. Nếu backend nằm ngoài checkout, đặt `FRONTEND_DIST` thành đường dẫn tuyệt đối tới `frontend/dist` để phục vụ bản build.


## Lập kế hoạch theo thời lượng

Nhập tiêu đề, mô tả các nhóm người dùng và luồng nghiệp vụ, phương pháp, loại sản phẩm, công nghệ và môi trường triển khai. Chọn tổng số tuần và số tuần mỗi Sprint. Ví dụ với website bán hàng dùng Scrum, ReactJS, Node.js, ExpressJS, PostgreSQL và Cloud Server, 12 tuần với nhịp 2 tuần tạo 6 Sprint. Dự án 15 tuần với nhịp 2 tuần tạo 8 Sprint, trong đó Sprint cuối dài 1 tuần. Bật tùy chọn đề xuất nhân sự để xem số người và lý do theo vai trò.

## Đánh giá WBS

Sau khi sinh WBS trong Trello, chọn **Xem đánh giá WBS vừa sinh** hoặc tab **Đánh giá**. Báo cáo áp dụng cho phản hồi API trước khi chỉnh sửa WBS. Điểm tổng hợp gồm thực tế (35%), tin cậy (20%), độ phủ (30%) và kiểm chứng (15%). Thời gian xử lý và token hiển thị riêng nếu backend cung cấp.

**Dự án tương tự** tự chọn tối đa ba dự án đủ gần trong bộ dữ liệu tham chiếu. Hệ số cosine được tính trên tập từ đã chuẩn hóa từ tiêu đề và mô tả. Báo cáo cũng cho biết bao nhiêu yêu cầu của từng dự án tham chiếu có từ khóa xuất hiện trong WBS. Các chỉ số này đo mức tương đồng từ vựng. Khi không có dự án đủ gần, báo cáo sẽ hiển thị trạng thái tương ứng.

**So sánh RAG và không RAG** gửi hai yêu cầu Gemini với cùng nội dung dự án, nhóm và lịch Sprint của WBS vừa sinh. Cặp so sánh chỉ thay đổi cờ RAG. Bảng hiển thị chênh lệch điểm, số yêu cầu tham chiếu khớp, token và độ trễ. Lượt có RAG dùng tài liệu hiện có của board.

Logic chấm và dữ liệu tham chiếu được tích hợp trong `wbs_eval_suite/` bằng JavaScript. Bộ tham chiếu gồm bốn dự án tự soạn và hai dự án chuyển thể từ [StorySeek](https://huggingface.co/datasets/SoftACE/StorySeek). Dữ liệu thô lịch sử có thể tìm tại commit `dbed0b7`.
