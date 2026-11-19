import time
import json
from typing import Callable, Dict, List, Tuple, Optional
import yaml
import numpy as np
import pandas as pd
from pydantic import ValidationError
from schemas import GoldenProject, WbsOutput
from metrics_code import CodeEvaluator
from judge_llm import LlmJudge


class WbsEvaluationPipeline:
    def __init__(
        self,
        config_path: str,
        generator_fn: Callable[[GoldenProject, bool, Optional[str]], Tuple[str, dict]],
        judge: LlmJudge
    ):
        """
        generator_fn(project, use_rag, refinement_feedback) -> (raw_json_str, usage_stats)
        usage_stats gồm: {"latency_sec": float, "prompt_tokens": int, "completion_tokens": int}
        """
        with open(config_path, "r", encoding="utf-8") as f:
            self.cfg = yaml.safe_load(f)
        self.generator_fn = generator_fn
        self.judge = judge
        self.code_eval = CodeEvaluator()

    def _parse_wbs(self, raw_json: str) -> Tuple[Optional[WbsOutput], bool]:
        try:
            data = json.loads(raw_json)
            return WbsOutput.model_validate(data), True
        except (json.JSONDecodeError, ValidationError):
            return None, False

    def score_single_mode(
        self,
        project: GoldenProject,
        runs: List[WbsOutput],
        valid_json_rate: float,
        usage_logs: List[dict],
        judge_practicality_norm: float
    ) -> Dict:
        """Tính điểm 4 nhóm A-D, điểm tổng S và kiểm tra cổng chất lượng."""
        rep = runs[0]  # Bản đại diện để chấm cấu trúc chi tiết
        t_cfg = self.cfg["thresholds"]

        # --- NHÓM A: THỰC TẾ (Code >= 80%, Judge <= 20%) ---
        cap = self.code_eval.eval_capacity_feasibility(project, rep)
        sched = self.code_eval.eval_schedule_feasibility(project, rep)
        est = self.code_eval.eval_estimation_error(project, rep, t_cfg["mmre_max"])
        size = self.code_eval.eval_task_size_distribution(rep, t_cfg["task_size_4_16h_min"])
        buf = self.code_eval.eval_buffer_ratio(rep, t_cfg["buffer_ratio_min"], t_cfg["buffer_ratio_max"])
        role = self.code_eval.eval_role_match(project, rep, t_cfg["role_match_min"])

        code_a = float(np.mean([
            cap["score"], sched["score"], est["score"],
            size["score"], buf["score"], role["score"]
        ]))
        s_a = 0.80 * code_a + 0.20 * judge_practicality_norm

        # --- NHÓM B: TIN CẬY (100% Code) ---
        cons = self.code_eval.eval_multi_run_consistency(runs, t_cfg["jaccard_consistency_min"], t_cfg["hours_cv_max"])
        cite = self.code_eval.eval_citations_and_ungrounded_numbers(project, rep)
        json_score = min(1.0, valid_json_rate / t_cfg["valid_json_first_pass_min"])
        s_b = float(np.mean([cons["score"], cite["citation_score"], cite["ungrounded_score"], json_score]))

        # --- NHÓM C: PHỦ VÀ RÕ (100% Code) ---
        req_cov = self.code_eval.eval_requirement_coverage(project, rep, t_cfg["req_coverage_min"])
        probe_cov = self.code_eval.eval_adversarial_probes(project, rep, t_cfg["probe_coverage_min"])
        ac_test = self.code_eval.eval_testable_ac(rep, t_cfg["testable_ac_min"])
        feat_rp = self.code_eval.eval_feature_recall_precision(
            project, rep, t_cfg["feature_recall_min"], t_cfg["feature_precision_min"]
        )
        s_c = float(np.mean([req_cov["score"], probe_cov["score"], ac_test["score"], feat_rp["score"]]))

        # --- NHÓM D: KIỂM CHỨNG VÀ HIỆU QUẢ ---
        trace = self.code_eval.eval_task_traceability(project, rep, t_cfg["task_with_source_min"])
        latencies = [u["latency_sec"] for u in usage_logs]
        p95_lat = float(np.percentile(latencies, 95)) if latencies else 0.0
        lat_score = 1.0 if p95_lat <= t_cfg["latency_p95_budget_sec"] else max(0.0, t_cfg["latency_p95_budget_sec"] / p95_lat)
        total_tokens = sum(u["prompt_tokens"] + u["completion_tokens"] for u in usage_logs)
        tokens_per_task = total_tokens / max(1, sum(len(r.tasks) for r in runs))
        s_d = float(np.mean([trace["score"], lat_score]))

        # --- ĐIỂM TỔNG HỢP S ---
        w = self.cfg["weights"]
        total_score = (
            w["A_practicality"] * s_a +
            w["B_reliability"] * s_b +
            w["C_coverage"] * s_c +
            w["D_verifiability"] * s_d
        )

        # --- CỔNG CHẤT LƯỢNG (QUALITY GATE) ---
        hard_fail = (cite["ungrounded_numbers_count"] > 0) or (cite["verified_citation_rate"] < 0.98)
        gate_thresh = self.cfg["group_pass_threshold"]
        weak_groups = []
        if s_a < gate_thresh:
            weak_groups.append("A_practicality")
        if s_b < gate_thresh:
            weak_groups.append("B_reliability")
        if s_c < gate_thresh:
            weak_groups.append("C_coverage")
        if s_d < gate_thresh:
            weak_groups.append("D_verifiability")

        return {
            "total_score": round(total_score, 4),
            "group_scores": {
                "A": round(s_a, 4), "B": round(s_b, 4),
                "C": round(s_c, 4), "D": round(s_d, 4)
            },
            "hard_fail": hard_fail,
            "weak_groups": weak_groups,
            "diagnostics": {
                "missing_reqs": req_cov["missing_reqs"],
                "ungrounded_numbers": cite["ungrounded_numbers_count"],
                "verified_citation_rate": cite["verified_citation_rate"],
                "overloaded_roles": cap["overloaded_count"],
                "dependency_violations": sched["dependency_violations"],
                "p95_latency_sec": round(p95_lat, 2),
                "tokens_per_task": round(tokens_per_task, 1)
            }
        }

    def _build_refinement_prompt(self, eval_res: dict) -> str:
        """Tạo hướng dẫn refine đúng chỉ số yếu của nhóm dưới ngưỡng."""
        diag = eval_res["diagnostics"]
        hints = []
        if diag["missing_reqs"]:
            hints.append(f"- Bổ sung task cho các yêu cầu bị thiếu: {', '.join(diag['missing_reqs'])}.")
        if diag["ungrounded_numbers"] > 0:
            hints.append("- Loại bỏ toàn bộ con số tự bịa không có trong SRS/RAG.")
        if diag["overloaded_roles"] > 0:
            hints.append("- Cân bằng lại giờ làm để không vai trò nào vượt định mức sprint.")
        if diag["dependency_violations"] > 0:
            hints.append("- Sửa các liên kết phụ thuộc sai hoặc tạo thành vòng lặp.")
        if not hints:
            hints.append("- Chia nhỏ các task >16h về khoảng 4-16h và viết Acceptance Criteria dạng Given/When/Then.")
        return "Hãy tinh chỉnh WBS dựa trên các lỗi cụ thể sau:\n" + "\n".join(hints)

    def evaluate_project(self, project: GoldenProject) -> dict:
        """Chạy đầy đủ quy trình 8 bước cho 1 dự án: RAG vs Non-RAG (N=3), Judge A/B, Quality Gate & Refine."""
        n_runs = self.cfg["n_runs_per_mode"]
        mode_outputs = {}

        for mode_name, use_rag in [("RAG", True), ("NO_RAG", False)]:
            valid_runs, logs, valid_count = [], [], 0
            for _ in range(n_runs):
                t0 = time.time()
                raw_str, usage = self.generator_fn(project, use_rag, None)
                usage["latency_sec"] = usage.get("latency_sec", time.time() - t0)
                logs.append(usage)
                parsed, is_valid = self._parse_wbs(raw_str)
                if is_valid:
                    valid_count += 1
                    valid_runs.append(parsed)
            if not valid_runs:
                valid_runs.append(WbsOutput(project_id=project.id))
            mode_outputs[mode_name] = {
                "runs": valid_runs,
                "valid_rate": valid_count / n_runs,
                "logs": logs
            }

        # Judge chấm ẩn danh theo cặp A/B (RAG vs NO_RAG)
        judge_res = self.judge.score_practicality_pairwise(
            project, mode_outputs["RAG"]["runs"][0], mode_outputs["NO_RAG"]["runs"][0]
        )

        rag_eval = self.score_single_mode(
            project, mode_outputs["RAG"]["runs"], mode_outputs["RAG"]["valid_rate"],
            mode_outputs["RAG"]["logs"], judge_res["norm_score_a"]
        )
        norag_eval = self.score_single_mode(
            project, mode_outputs["NO_RAG"]["runs"], mode_outputs["NO_RAG"]["valid_rate"],
            mode_outputs["NO_RAG"]["logs"], judge_res["norm_score_b"]
        )

        # Áp cổng chất lượng & Refine tối đa 1 vòng cho chế độ RAG
        needs_review = False
        refined_eval = None
        if rag_eval["hard_fail"]:
            needs_review = True
        elif rag_eval["weak_groups"]:
            feedback = self._build_refinement_prompt(rag_eval)
            raw_ref, ref_usage = self.generator_fn(project, True, feedback)
            parsed_ref, is_valid_ref = self._parse_wbs(raw_ref)
            if is_valid_ref:
                refined_eval = self.score_single_mode(
                    project, [parsed_ref], 1.0, [ref_usage], judge_res["norm_score_a"]
                )
                if refined_eval["hard_fail"] or refined_eval["weak_groups"]:
                    needs_review = True
            else:
                needs_review = True

        final_rag = refined_eval if refined_eval else rag_eval
        delta_rag = {
            "delta_total": round(final_rag["total_score"] - norag_eval["total_score"], 4),
            "delta_B_reliability": round(final_rag["group_scores"]["B"] - norag_eval["group_scores"]["B"], 4),
            "delta_D_verifiability": round(final_rag["group_scores"]["D"] - norag_eval["group_scores"]["D"], 4),
        }

        return {
            "project_id": project.id,
            "tier": project.tier,
            "rag_final": final_rag,
            "no_rag": norag_eval,
            "delta_rag": delta_rag,
            "judge": judge_res,
            "needsReview": needs_review,
            "hard_fail": final_rag["hard_fail"]
        }