# Autoplan

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

Bộ đi kèm có bốn ca tiếng Việt tự soạn. Có thể tuyển chọn và gán nhãn dữ liệu từ [PURE](https://zenodo.org/records/7118517) cho SRS, [NEODATASET](https://github.com/giseldo/neodataset) cho user story, [StorySeek](https://huggingface.co/datasets/SoftACE/StorySeek) cho mục tiêu và tác nhân, [SEOSS 33](https://doi.org/10.7910/DVN/PDDZ4Q) cho truy vết RAG, hoặc tham khảo [mẫu Trello](https://www.atlassian.com/project-management/templates). Story points của NEODATASET không được dùng làm số giờ thực tế. Các nguồn này cần gán nhãn trước khi dùng làm bộ đối chiếu WBS.
