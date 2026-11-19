import argparse
import os
import json
from pathlib import Path
from typing import Tuple, Optional
from openai import OpenAI
from schemas import GoldenProject, WbsOutput
from download_and_prepare import GoldenSetBuilder
from judge_llm import LlmJudge
from evaluator_pipeline import WbsEvaluationPipeline

# 1. Khởi tạo client (dùng 2 model khác nhau cho Sinh WBS và Judge)
GENERATOR_MODEL = "gpt-4o"
JUDGE_MODEL = "gpt-4o-mini"


def wbs_generator_wrapper(
    client: OpenAI, project: GoldenProject, use_rag: bool, refinement_feedback: Optional[str]
) -> Tuple[str, dict]:
    """Hàm gọi hệ thống sinh WBS của bạn (chế độ có RAG hoặc không RAG)."""
    rag_context = ""
    if use_rag and project.rag_corpus:
        chunks_str = "\n".join(f"[{c.chunk_id}] {c.content}" for c in project.rag_corpus[:20])
        rag_context = f"\n=== TÀI LIỆU THAM CHIẾU (RAG CHUNKS) ===\n{chunks_str}\n"

    refine_block = f"\n=== YÊU CẦU CHỈNH SỬA ===\n{refinement_feedback}\n" if refinement_feedback else ""

    prompt = f"""
Bạn là kiến trúc sư giải pháp. Hãy phân rã SRS thành WBS chuẩn JSON theo schema WbsOutput.
Quy tắc bắt buộc:
- Chỉ sử dụng số liệu có trong SRS/RAG; không tự bịa số liệu.
- Nếu SRS mâu thuẫn hoặc thiếu thông tin quan trọng, hãy đặt câu hỏi vào `clarifying_questions`.
- Chia task nhỏ 4-16h, gắn đúng `source_refs` (mã REQ-xx hoặc chunk_id) và `verbatim_quotes`.
- Bao gồm 15-25% tổng giờ cho testing/integration/bugfix.

=== ĐỘI HÌNH & ĐỊNH MỨC ===
{[m.model_dump() for m in project.team_profile]}
Tổng thời lượng dự án: {project.project_duration_hours} giờ ({project.sprint_count} sprint).

=== SRS ĐẦU VÀO ===
{project.srs_text}
{rag_context}
{refine_block}
"""
    resp = client.chat.completions.create(
        model=GENERATOR_MODEL,
        temperature=0.2,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": json.dumps(WbsOutput.model_json_schema(), ensure_ascii=False)},
            {"role": "user", "content": prompt}
        ]
    )
    usage = {
        "prompt_tokens": resp.usage.prompt_tokens,
        "completion_tokens": resp.usage.completion_tokens
    }
    return resp.choices[0].message.content, usage


def main():
    suite_dir = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description="Benchmark WBS riêng, dùng OpenAI cho generator và judge.")
    parser.add_argument("--data-dir", type=Path, default=suite_dir / "raw_datasets")
    parser.add_argument("--output", type=Path, default=suite_dir / "evaluation_report.json")
    parser.add_argument("--limit", type=int, default=3)
    args = parser.parse_args()
    if args.limit < 1:
        parser.error("--limit phải lớn hơn 0")
    if not os.environ.get("OPENAI_API_KEY"):
        parser.error("Cần cấu hình OPENAI_API_KEY để chạy benchmark Python.")

    builder = GoldenSetBuilder()
    golden_projects = builder.build_tier2_storyseek(args.data_dir / "StorySeek", limit=args.limit)
    golden_projects += builder.build_tier1_pure(args.data_dir / "PURE", limit=args.limit)
    golden_projects += builder.build_tier2_and_3_neodataset(args.data_dir / "NEODATASET")
    golden_projects += builder.build_tier4_seoss33(args.data_dir / "SEOSS33", limit=args.limit)
    golden_projects += builder.build_adversarial_set()
    client = OpenAI()
    judge = LlmJudge(client=client, judge_model=JUDGE_MODEL)
    pipeline = WbsEvaluationPipeline(
        config_path=str(suite_dir / "config.yaml"),
        generator_fn=lambda project, use_rag, feedback: wbs_generator_wrapper(client, project, use_rag, feedback),
        judge=judge,
    )

    results = []
    for proj in golden_projects[:args.limit]:
        print(f"Đang đánh giá dự án: {proj.id} (Tầng {proj.tier})...")
        res = pipeline.evaluate_project(proj)
        results.append(res)

    # Bước 3: Xuất báo cáo tổng hợp
    report_path = args.output
    report_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Hoàn tất! Đã lưu báo cáo tại {report_path}")

if __name__ == "__main__":
    main()
