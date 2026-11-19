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


## Đánh giá WBS

Mở Planner tại `/?view=app`, chọn tab **Đánh giá**. **WBS vừa sinh** chấm phản hồi API trước khi bạn chỉnh sửa công việc, còn **Bộ dữ liệu** chạy ca mẫu độc lập với kế hoạch đang soạn. Khi chọn **So sánh A/B**, ứng dụng gửi hai yêu cầu sinh WBS với cùng đầu vào, nhóm mẫu và lịch, chỉ thay đổi cờ RAG. Ca khôi phục mật khẩu có văn bản tham chiếu để nạp vào RAG trước khi chạy. Lịch sử và ca đã nhập giữ trong phiên trang. Chạy cùng chế độ ba lần với cùng model để xem độ chồng lấn tiêu đề và biên độ tổng giờ. Sinh WBS dùng backend và thông tin xác thực Gemini/Trello theo cấu hình đang dùng.

Điểm gồm thực tế (35%), tin cậy (20%), độ phủ (30%) và kiểm chứng (15%). Thời gian xử lý và số token của lần gọi Gemini trả kết quả được hiển thị riêng. Với dữ liệu cũ hoặc phép đo thiếu đầu vào, báo cáo hiển thị thiếu số liệu. Khớp từ khóa và trích dẫn nguyên văn là tín hiệu để rà soát. Chúng không chứng minh độ đúng nghiệp vụ hay sự phù hợp của dẫn chứng.

### Mẫu dữ liệu đã gán nhãn

Mỗi ca gồm đầu vào và danh sách yêu cầu đối chiếu. Tùy chọn `source` cung cấp tên và nội dung cho dữ liệu RAG. Chọn tối đa 30 ca trong mỗi tệp JSON.

```json
[
  {
    "title": "Xuất báo cáo tồn kho",
    "description": "Cho phép lọc theo kho trước khi xuất CSV.",
    "sprintCount": 1,
    "sprintDurationDays": 7,
    "requirements": [
      { "label": "REQ-01 · Lọc theo kho", "terms": ["lọc theo kho", "warehouse filter"] },
      { "label": "REQ-02 · Xuất CSV", "terms": ["xuất csv", "export csv"] }
    ],
    "source": {
      "name": "Quy tắc báo cáo",
      "text": "Chỉ người có quyền quản lý kho mới được xuất báo cáo tồn kho."
    }
  }
]
```

Bộ đi kèm có bốn ca tiếng Việt tự soạn và hai ca StackGres chuyển thể từ StorySeek #2 và #4. Có thể tuyển chọn và gán nhãn dữ liệu từ [PURE](https://zenodo.org/records/7118517) cho SRS, [NEODATASET](https://github.com/giseldo/neodataset) cho user story, [StorySeek](https://huggingface.co/datasets/SoftACE/StorySeek) cho mục tiêu và tác nhân, [SEOSS 33](https://doi.org/10.7910/DVN/PDDZ4Q) cho truy vết RAG, hoặc tham khảo [mẫu Trello](https://www.atlassian.com/project-management/templates). Story points của NEODATASET không được dùng làm số giờ thực tế. Các nguồn này cần gán nhãn trước khi dùng làm bộ đối chiếu WBS.


## Benchmark Python tùy chọn

`wbs_eval_suite/` là công cụ nghiên cứu riêng dùng OpenAI cho cả sinh WBS và LLM Judge. Tab Đánh giá của Power-Up chạy trên WBS Gemini mà ứng dụng trả về. Dùng bộ ca tích hợp hoặc nhập ca JSON để đánh giá chính Power-Up.

Bộ benchmark Python đọc dữ liệu có sẵn trong `wbs_eval_suite/raw_datasets/` và dùng các ca giả lập nếu thư mục trống. Ví dụ với virtualenv và `OPENAI_API_KEY` đã được đặt:

```sh
python -m pip install -r wbs_eval_suite/requirements.txt
python wbs_eval_suite/run_benchmark.py --limit 3
```

Dữ liệu tải về và báo cáo tạo ra được lưu cục bộ. Bản dữ liệu thô đã có trên Git ở commit `dbed0b7`. Các bản checkout đã chứa dữ liệu vẫn có thể dùng thư mục hiện tại hoặc chỉ định `--data-dir`. Benchmark Python có các phép quy đổi ước lượng thí nghiệm. Chỉ dùng giờ thực tế có nguồn để kiểm định độ chính xác ước lượng.
