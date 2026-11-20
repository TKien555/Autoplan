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

Trỏ ngrok hoặc reverse proxy HTTPS tới ứng dụng chạy ở cổng 3001. Trong cổng quản trị Trello Power-Up, đặt iframe connector là `https://<origin>/connector.html`, bật **Card Buttons** và **Card Back Section**, rồi cài Power-Up vào board. Mở một thẻ và bấm **Lập kế hoạch AI**. Mở `/` trên trình duyệt để xem Planner. URL `/?view=app` vẫn mở được Planner trong iframe, còn `/api/health` dùng để kiểm tra backend.

Khi phát triển, chạy `npm run dev --prefix frontend` cùng backend. Vite chuyển tiếp `/api` đến cổng 3001. Nếu backend nằm ngoài checkout, đặt `FRONTEND_DIST` thành đường dẫn tuyệt đối tới `frontend/dist` để phục vụ bản build.


## Lập kế hoạch theo thời lượng

Nhập tiêu đề, mô tả các nhóm người dùng và luồng nghiệp vụ, phương pháp, loại dự án, công nghệ và môi trường triển khai. Chọn tổng số tuần và số tuần mỗi Sprint. Ví dụ với website bán hàng dùng Scrum, ReactJS, Node.js, ExpressJS, PostgreSQL và Cloud Server, 12 tuần với nhịp 2 tuần tạo 6 Sprint. Dự án 15 tuần với nhịp 2 tuần tạo 8 Sprint, trong đó Sprint cuối dài 1 tuần. Bật tùy chọn đề xuất nhân sự để xem số người và lý do theo vai trò.

Sau khi sinh WBS, mở **Lịch Gantt** để xem và lọc công việc theo ngày hoặc **Khối lượng theo Sprint** để đối chiếu số giờ của từng người với định mức của Sprint. Bấm một ô giờ để xem các công việc liên quan. Các công việc chưa phân công được hiển thị riêng. Mục **Đầu ra và nghiệm thu** của mỗi công việc cho biết sản phẩm bàn giao, tiêu chí nghiệm thu và tình huống cần xử lý nếu AI cung cấp.

## Phân rã theo loại bài toán

Chọn **Loại dự án** như xây dựng website/ứng dụng, nâng cấp, bảo trì, vận hành, dịch chuyển dữ liệu, tích hợp, phân tích dữ liệu hoặc thử nghiệm. Chọn **Khác** để nhập loại bạn cần hoặc để **Tự nhận diện từ mô tả**. Backend kết hợp lựa chọn với tiêu đề và mô tả để chọn các hướng phù hợp. Các hướng từ `work2` bao gồm đặt chỗ thời gian thực, thanh toán và thuê bao, mở rộng hệ thống đang chạy, di chuyển dữ liệu, hiệu năng và chi phí, bảo mật và tuân thủ, AI/RAG và khắc phục sự cố. Ví dụ, với đặt chỗ, WBS xét vòng đời giữ chỗ và tình huống hai người đặt cùng lúc. Với migration, WBS xét đối soát dữ liệu và khả năng quay lại hệ thống cũ. Một dự án có thể kết hợp nhiều hướng. Ví dụ, dự án bảo trì và nâng cấp website bán hàng được chia thành tái hiện và sửa lỗi giỏ hàng, kiểm thử hồi quy cách tính tổng đơn, cùng các bước kiểm tra tương thích và phát hành phần nâng cấp nếu có trong yêu cầu.

Mỗi đầu việc tập trung vào một kết quả nghiệp vụ có thể nghiệm thu. Công việc quản trị vẫn được lập kế hoạch nếu có trong phạm vi. Khi tiêu đề công việc còn chung chung và thiếu đầu ra hoặc cách kiểm chứng, phản hồi này được gửi vào cùng lượt chỉnh sửa chất lượng. Luồng không phát sinh lượt AI riêng để phân loại bài toán và không thêm tiêu chí vào điểm đánh giá.

## Đánh giá WBS

Sau khi sinh WBS trong Trello, mở **Xem đánh giá WBS vừa sinh**. Báo cáo có bốn nhóm với trọng số Khả thi 35%, Đầy đủ 30%, Có căn cứ 20%, Chấp nhận 15%. Chỉ số thiếu dữ liệu là N/A và điểm được chia lại theo các nhóm có dữ liệu. Tỷ lệ sửa và xóa là thông tin theo dõi. Nhóm Chấp nhận được tính khi bấm **Xác nhận đã duyệt WBS** và so với bản sinh ban đầu. Task bổ sung thủ công nằm ngoài mẫu số.

Mỗi task có badge **Có nguồn**, **Suy luận** hoặc **Cần xem lại**. Mục **Căn cứ và ước lượng** cho xem yêu cầu REQ được liên kết, tên tài liệu RAG, số đoạn và nguyên văn đã xác minh, cùng các giá trị PERT khi có. REQ được tách theo dòng hoặc câu của mô tả và liên kết bởi mô hình. Cổng chất lượng thử chỉnh sửa một lần theo các chỉ số chưa đạt, giữ bản trước nếu kết quả sau không cải thiện.

**Dự án tương tự** tự chọn tối đa ba dự án đủ gần trong bộ dữ liệu tham chiếu. Hệ số cosine được tính trên tập từ đã chuẩn hóa từ tiêu đề và mô tả. Báo cáo cũng cho biết bao nhiêu yêu cầu của từng dự án tham chiếu có từ khóa xuất hiện trong WBS. Các chỉ số này đo mức tương đồng từ vựng. Khi không có dự án đủ gần, báo cáo sẽ hiển thị trạng thái tương ứng.

Tab **So sánh RAG** gửi hai yêu cầu Gemini với cùng nội dung dự án, nhóm và lịch Sprint của WBS vừa sinh. Cặp so sánh chỉ thay đổi cờ RAG. Bảng hiển thị chênh lệch điểm, số yêu cầu tham chiếu khớp, token và độ trễ. Lượt có RAG dùng tài liệu hiện có của board.

Logic chấm và dữ liệu tham chiếu được tích hợp trong `wbs_eval_suite/` bằng JavaScript. Bộ tham chiếu gồm bốn dự án tự soạn và hai dự án chuyển thể từ [StorySeek](https://huggingface.co/datasets/SoftACE/StorySeek). Dữ liệu thô lịch sử có thể tìm tại commit `dbed0b7`.

Đặt `WBS_JUDGE_MODEL` trong cấu hình backend nếu muốn thêm chấm thực tiễn ẩn danh cho cặp RAG/không RAG. Model Judge phải khác cả hai model sinh. Judge chiếm 10% nhóm Khả thi của báo cáo A/B khi có kết quả.
