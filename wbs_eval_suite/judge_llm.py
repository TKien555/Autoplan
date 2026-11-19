import json
import random
from typing import Tuple, Dict
from openai import OpenAI
from schemas import GoldenProject, WbsOutput


PRACTICALITY_RUBRIC = """
Chấm điểm Tính thực tiễn (1-5) của WBS dựa trên góc nhìn Technical Lead / Developer:
- 1 điểm: Task chung chung, mơ hồ, thiếu tiêu chí nghiệm thu (AC), dev không thể bắt tay làm nếu không hỏi lại toàn bộ.
- 2 điểm: Có chia module nhưng task quá lớn (>24h), thiếu phụ thuộc kỹ thuật, AC sơ sài.
- 3 điểm: Cấu trúc chấp nhận được, làm được các luồng chính nhưng còn thiếu chi tiết edge-case hoặc phân vai chưa sát.
- 4 điểm: Task rõ ràng, kích thước vừa phải, có AC kiểm thử được, dev có thể thực thi ngay với rất ít câu hỏi phụ.
- 5 điểm: Xuất sắc, sẵn sàng đưa vào Sprint; đầy đủ phụ thuộc, AC đo lường được, phân vai chuẩn xác và bao quát cả kiểm thử/tích hợp.
"""


class LlmJudge:
    """Sử dụng model khác với model sinh WBS để chấm ẩn danh và đảo cặp A/B."""

    def __init__(self, client: OpenAI, judge_model: str = "gpt-4o-mini"):
        self.client = client
        self.judge_model = judge_model

    def _call_judge(self, prompt: str) -> dict:
        resp = self.client.chat.completions.create(
            model=self.judge_model,
            temperature=0.0,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": "Bạn là giám khảo đánh giá kỹ thuật phần mềm độc lập. Luôn trả về JSON hợp lệ."},
                {"role": "user", "content": prompt}
            ]
        )
        return json.loads(resp.choices[0].message.content)

    def score_practicality_pairwise(
        self, project: GoldenProject, wbs_a: WbsOutput, wbs_b: WbsOutput
    ) -> Dict[str, any]:
        """
        Chấm theo cặp ẩn danh (RAG vs Non-RAG hoặc 2 phiên bản) với 2 lượt đảo vị trí A/B.
        Nếu điểm của cùng một bản lệch > 1 điểm giữa 2 lượt đảo -> gắn cờ flagged_for_human.
        """
        def run_pass(first_wbs: WbsOutput, second_wbs: WbsOutput) -> dict:
            prompt = f"""
{PRACTICALITY_RUBRIC}

=== ĐẶC TẢ DỰ ÁN (SRS) ===
{project.srs_text[:4000]}

=== PHƯƠNG ÁN X ===
{first_wbs.model_dump_json(indent=2)[:6000]}

=== PHƯƠNG ÁN Y ===
{second_wbs.model_dump_json(indent=2)[:6000]}

Hãy chấm điểm từng phương án theo thang 1-5 và chọn phương án tốt hơn.
Trả về JSON đúng định dạng:
{{"score_x": <float 1-5>, "score_y": <float 1-5>, "winner": "X" | "Y" | "TIE", "reason": "<ngắn gọn>"}}
"""
            return self._call_judge(prompt)

        # Lượt 1: (A, B) | Lượt 2: Đảo chỗ (B, A)
        pass1 = run_pass(wbs_a, wbs_b)
        pass2 = run_pass(wbs_b, wbs_a)

        a_scores = [float(pass1["score_x"]), float(pass2["score_y"])]
        b_scores = [float(pass1["score_y"]), float(pass2["score_x"])]

        diff_a = abs(a_scores[0] - a_scores[1])
        diff_b = abs(b_scores[0] - b_scores[1])
        flagged = (diff_a > 1.0) or (diff_b > 1.0)

        avg_a = sum(a_scores) / 2.0
        avg_b = sum(b_scores) / 2.0

        return {
            "score_a_1_to_5": round(avg_a, 2),
            "score_b_1_to_5": round(avg_b, 2),
            "norm_score_a": round(min(1.0, avg_a / 4.0), 4),   # Đạt ngưỡng 4.0 = 1.0
            "norm_score_b": round(min(1.0, avg_b / 4.0), 4),
            "delta_a_minus_b": round(avg_a - avg_b, 2),
            "flagged_position_bias": flagged
        }