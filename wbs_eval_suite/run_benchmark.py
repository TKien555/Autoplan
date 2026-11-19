import os
import json
from pathlib import Path
from typing import Tuple, Optional
from openai import OpenAI
from schemas import GoldenProject, WbsOutput
from download_and_prepare import DatasetDownloader, GoldenSetBuilder, GOLDEN_DIR
from judge_llm import LlmJudge
from evaluator_pipeline import WbsEvaluationPipeline

# 1. Khởi tạo client (dùng 2 model khác nhau cho Sinh WBS và Judge)
client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY", "YOUR_API_KEY"))
GENERATOR_MODEL = "gpt-4o"
JUDGE_MODEL = "gpt-4o-mini"


def wbs_generator_wrapper(
    project: GoldenProject, use_rag: bool, refinement_feedback: Optional[str]
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
            {"role": "system", "content": "Trả về JSON tuân thủ nghiêm ngặt schema WbsOutput."},
            {"role": "user", "content": prompt}
        ]
    )
    usage = {
        "prompt_tokens": resp.usage.prompt_tokens,
        "completion_tokens": resp.usage.completion_tokens
    }
    return resp.choices[0].message.content, usage


if __name__ == "__main__":
    # Bước 1: Tải dữ liệu & dựng Golden Set (bỏ comment khi chạy tải lần đầu)
    downloader = DatasetDownloader()
    # pure_dir = downloader.download_pure_zenodo()
    # neo_dir = downloader.download_neodataset_github()
    # ss_dir = downloader.download_storyseek_hf("SoftACE/StorySeek")
    seoss_dir = downloader.download_seoss33_dataverse()

    builder = GoldenSetBuilder()
    golden_projects = builder.build_adversarial_set()  # Demo chạy ngay với 3 dự án đối kháng
    golden_projects += builder.build_tier1_pure(Path("./raw_datasets/PURE"))
    golden_projects += builder.build_tier2_storyseek(ss_dir)
    golden_projects += builder.build_tier2_and_3_neodataset(Path("./raw_datasets/NEODATASET"))
    golden_projects += builder.build_tier4_seoss33(Path("./raw_datasets/SEOSS33"))

    # Bước 2: Chạy đánh giá
    judge = LlmJudge(client=client, judge_model=JUDGE_MODEL)
    pipeline = WbsEvaluationPipeline(
        config_path="config.yaml",
        generator_fn=wbs_generator_wrapper,
        judge=judge
    )

    results = []
    for proj in golden_projects:
        print(f"Đang đánh giá dự án: {proj.id} (Tầng {proj.tier})...")
        res = pipeline.evaluate_project(proj)
        results.append(res)

    # Bước 3: Xuất báo cáo tổng hợp
    report_path = Path("evaluation_report.json")
    report_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Hoàn tất! Đã lưu báo cáo tại {report_path}")