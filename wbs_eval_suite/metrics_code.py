import re
from typing import List, Dict, Tuple, Set
import numpy as np
import networkx as nx
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from schemas import GoldenProject, WbsOutput


class CodeEvaluator:
    """Thực thi toàn bộ chỉ số đo bằng Code trong 4 nhóm A, B, C, D."""

    # ================= NHÓM A: THỰC TẾ =================
    @staticmethod
    def eval_capacity_feasibility(project: GoldenProject, wbs: WbsOutput) -> Dict[str, float]:
        """Đếm số thành viên/vai trò vượt quá 100% định mức giờ/sprint."""
        role_capacity: Dict[str, float] = {}
        for m in project.team_profile:
            role_capacity[m.role.lower()] = role_capacity.get(m.role.lower(), 0.0) + (
                m.capacity_hours_per_sprint * project.sprint_count
            )

        role_assigned: Dict[str, float] = {}
        for t in wbs.tasks:
            r = t.assigned_role.lower()
            role_assigned[r] = role_assigned.get(r, 0.0) + t.estimated_hours

        overloaded = 0
        total_roles = max(1, len(role_capacity))
        for role, cap in role_capacity.items():
            if role_assigned.get(role, 0.0) > cap:
                overloaded += 1

        score = max(0.0, 1.0 - (overloaded / total_roles))
        return {"overloaded_count": overloaded, "score": score}

    @staticmethod
    def eval_schedule_feasibility(project: GoldenProject, wbs: WbsOutput) -> Dict[str, float]:
        """Kiểm tra vòng lặp phụ thuộc (DAG) và tính đường găng (Critical Path)."""
        G = nx.DiGraph()
        task_map = {t.task_id: t for t in wbs.tasks}
        violations = 0

        for t in wbs.tasks:
            G.add_node(t.task_id, duration=t.estimated_hours)
            for dep in t.dependencies:
                if dep not in task_map or dep == t.task_id:
                    violations += 1
                else:
                    G.add_edge(dep, t.task_id)

        if not nx.is_directed_acyclic_graph(G):
            cycles = list(nx.simple_cycles(G))
            violations += len(cycles)
            return {"dependency_violations": violations, "critical_path_hours": float("inf"), "score": 0.0}

        # Tính đường găng trên DAG
        longest_path = nx.dag_longest_path(G, weight="duration")
        cp_hours = sum(task_map[nid].estimated_hours for nid in longest_path) if longest_path else 0.0
        within_duration = cp_hours <= project.project_duration_hours

        if violations > 0:
            score = 0.0
        elif within_duration:
            score = 1.0
        else:
            overflow_ratio = (cp_hours - project.project_duration_hours) / max(1.0, project.project_duration_hours)
            score = max(0.0, 1.0 - overflow_ratio)

        return {
            "dependency_violations": violations,
            "critical_path_hours": round(cp_hours, 2),
            "score": round(score, 4)
        }

    @staticmethod
    def eval_estimation_error(project: GoldenProject, wbs: WbsOutput, mmre_threshold: float = 0.40) -> Dict[str, float]:
        """So sánh tổng giờ với khoảng PERT và tính MMRE."""
        total_est = sum(t.estimated_hours for t in wbs.tasks)
        pert_min = project.reference_sizes.get("pert_min")
        pert_ml = project.reference_sizes.get("pert_most_likely")
        pert_max = project.reference_sizes.get("pert_max")

        if not pert_ml:
            return {"total_estimated_hours": total_est, "mmre": 0.0, "in_pert": True, "score": 1.0}

        in_pert = (pert_min <= total_est <= pert_max)
        mmre = abs(total_est - pert_ml) / max(1.0, pert_ml)
        score = 1.0 if (in_pert and mmre <= mmre_threshold) else max(0.0, 1.0 - max(0.0, mmre - mmre_threshold))
        return {
            "total_estimated_hours": round(total_est, 2),
            "mmre": round(mmre, 4),
            "in_pert": in_pert,
            "score": round(score, 4)
        }

    @staticmethod
    def eval_task_size_distribution(wbs: WbsOutput, target_ratio: float = 0.80) -> Dict[str, float]:
        """Tỷ lệ % task có kích thước chuẩn 4-16 giờ."""
        if not wbs.tasks:
            return {"ratio_4_16h": 0.0, "score": 0.0}
        valid = sum(1 for t in wbs.tasks if 4.0 <= t.estimated_hours <= 16.0)
        ratio = valid / len(wbs.tasks)
        score = min(1.0, ratio / target_ratio)
        return {"ratio_4_16h": round(ratio, 4), "score": round(score, 4)}

    @staticmethod
    def eval_buffer_ratio(wbs: WbsOutput, min_r: float = 0.15, max_r: float = 0.25) -> Dict[str, float]:
        """Tỷ lệ giờ dự phòng cho tích hợp, kiểm thử, sửa lỗi (15-25%)."""
        total = sum(t.estimated_hours for t in wbs.tasks)
        if total <= 0:
            return {"buffer_ratio": 0.0, "score": 0.0}
        buffer_hrs = sum(
            t.estimated_hours for t in wbs.tasks
            if t.task_type in ("integration", "testing", "bugfix")
        )
        ratio = buffer_hrs / total
        if min_r <= ratio <= max_r:
            score = 1.0
        elif ratio < min_r:
            score = max(0.0, ratio / min_r)
        else:
            score = max(0.0, 1.0 - (ratio - max_r) / max_r)
        return {"buffer_ratio": round(ratio, 4), "score": round(score, 4)}

    @staticmethod
    def eval_role_match(project: GoldenProject, wbs: WbsOutput, target: float = 0.90) -> Dict[str, float]:
        """Tỷ lệ task được gán đúng vai trò chuyên môn có trong đội hình."""
        if not wbs.tasks:
            return {"role_match_ratio": 0.0, "score": 0.0}
        valid_roles = {m.role.lower() for m in project.team_profile}
        matched = sum(1 for t in wbs.tasks if t.assigned_role.lower() in valid_roles)
        ratio = matched / len(wbs.tasks)
        return {"role_match_ratio": round(ratio, 4), "score": round(min(1.0, ratio / target), 4)}

    # ================= NHÓM B: TIN CẬY =================
    @staticmethod
    def eval_multi_run_consistency(runs: List[WbsOutput], min_jaccard: float = 0.70, max_cv: float = 0.15) -> Dict[str, float]:
        """Đo độ nhất quán qua N=3 lần chạy: Jaccard similarity của task và biến thiên (CV) tổng giờ."""
        if len(runs) < 2:
            return {"jaccard": 1.0, "hours_cv": 0.0, "score": 1.0}

        def normalize_titles(w: WbsOutput) -> Set[str]:
            return {re.sub(r"\W+", " ", t.title.lower()).strip() for t in w.tasks}

        title_sets = [normalize_titles(r) for r in runs]
        jaccards = []
        for i in range(len(title_sets)):
            for j in range(i + 1, len(title_sets)):
                union = title_sets[i] | title_sets[j]
                inter = title_sets[i] & title_sets[j]
                jaccards.append(len(inter) / max(1, len(union)))
        avg_jaccard = float(np.mean(jaccards))

        totals = [sum(t.estimated_hours for t in r.tasks) for r in runs]
        mean_h = float(np.mean(totals))
        cv = float(np.std(totals) / mean_h) if mean_h > 0 else 0.0

        s_jaccard = min(1.0, avg_jaccard / min_jaccard)
        s_cv = 1.0 if cv <= max_cv else max(0.0, 1.0 - (cv - max_cv) / max_cv)
        return {
            "jaccard": round(avg_jaccard, 4),
            "hours_cv": round(cv, 4),
            "score": round(0.5 * s_jaccard + 0.5 * s_cv, 4)
        }

    @staticmethod
    def eval_citations_and_ungrounded_numbers(project: GoldenProject, wbs: WbsOutput) -> Dict[str, float]:
        """
        1. Trích dẫn đã kiểm chứng: % quote có thật trong rag_corpus hoặc srs_text.
        2. Con số không có nguồn: số liệu xuất hiện trong task nhưng không có trong SRS/REQ/RAG/PERT.
        """
        corpus_text = (project.srs_text + " " + " ".join(c.content for c in project.rag_corpus)).lower()
        corpus_norm = re.sub(r"\s+", " ", corpus_text)

        # Kiểm tra quote
        all_quotes = [q for t in wbs.tasks for q in t.verbatim_quotes if q.strip()]
        if all_quotes:
            verified = sum(1 for q in all_quotes if re.sub(r"\s+", " ", q.lower()).strip() in corpus_norm)
            citation_rate = verified / len(all_quotes)
        else:
            citation_rate = 1.0

        # Trích xuất các con số trong mô tả/AC của WBS (bỏ qua số giờ ước lượng và mã ID)
        allowed_numbers = set(re.findall(r"\b\d+(?:\.\d+)?\b", corpus_norm))
        for v in project.reference_sizes.values():
            allowed_numbers.add(str(int(v)) if float(v).is_integer() else str(v))
        # Cho phép các hằng số chuẩn của quy tắc chia task (4, 8, 16)
        allowed_numbers.update({"1", "2", "3", "4", "8", "16", "100"})

        ungrounded_count = 0
        for t in wbs.tasks:
            text_to_check = f"{t.title} {t.description} {' '.join(t.acceptance_criteria)}"
            # Loại bỏ mã REQ-xx, FEAT-xx, T-xx
            cleaned = re.sub(r"\b(?:REQ|FEAT|T|M)-\d+\b", "", text_to_check, flags=re.IGNORECASE)
            nums = re.findall(r"\b\d+(?:\.\d+)?\b", cleaned)
            for n in nums:
                if n not in allowed_numbers:
                    ungrounded_count += 1

        citation_score = 1.0 if citation_rate >= 0.98 else max(0.0, citation_rate / 0.98)
        ungrounded_score = 1.0 if ungrounded_count == 0 else 0.0
        return {
            "verified_citation_rate": round(citation_rate, 4),
            "ungrounded_numbers_count": ungrounded_count,
            "citation_score": round(citation_score, 4),
            "ungrounded_score": ungrounded_score
        }

    # ================= NHÓM C: PHỦ VÀ RÕ =================
    @staticmethod
    def eval_requirement_coverage(project: GoldenProject, wbs: WbsOutput, target: float = 0.95) -> Dict[str, float]:
        """% REQ trong req_list có ít nhất 1 task ánh xạ tới."""
        if not project.req_list:
            return {"req_coverage": 1.0, "missing_reqs": [], "score": 1.0}
        covered_refs = {ref.upper() for t in wbs.tasks for ref in t.source_refs}
        missing = [r.req_id for r in project.req_list if r.req_id.upper() not in covered_refs]
        cov = 1.0 - (len(missing) / len(project.req_list))
        return {
            "req_coverage": round(cov, 4),
            "missing_reqs": missing,
            "score": round(min(1.0, cov / target), 4)
        }

    @staticmethod
    def eval_adversarial_probes(project: GoldenProject, wbs: WbsOutput, target: float = 0.90) -> Dict[str, float]:
        """Đo % probe (câu hỏi dò) được AI hỏi lại/xử lý trên tập đối kháng."""
        if not project.adversarial_probes:
            return {"probe_coverage": 1.0, "score": 1.0}
        combined_questions = " ".join(wbs.clarifying_questions).lower()
        hit = sum(1 for p in project.adversarial_probes if p.lower() in combined_questions)
        cov = hit / len(project.adversarial_probes)
        return {"probe_coverage": round(cov, 4), "score": round(min(1.0, cov / target), 4)}

    @staticmethod
    def eval_testable_ac(wbs: WbsOutput, target: float = 0.85) -> Dict[str, float]:
        """% Acceptance Criteria có cấu trúc Given/When/Then hoặc chứa số đo định lượng."""
        all_acs = [ac for t in wbs.tasks for ac in t.acceptance_criteria]
        if not all_acs:
            return {"testable_ac_ratio": 0.0, "score": 0.0}
        gwt_or_metric = re.compile(r"(given.+when.+then|\b\d+\s*(ms|s|giây|%|mb|gb|user|lần|bản ghi)\b)", re.I)
        valid = sum(1 for ac in all_acs if gwt_or_metric.search(ac))
        ratio = valid / len(all_acs)
        return {"testable_ac_ratio": round(ratio, 4), "score": round(min(1.0, ratio / target), 4)}

    @staticmethod
    def eval_feature_recall_precision(
        project: GoldenProject, wbs: WbsOutput,
        recall_target: float = 0.85, precision_target: float = 0.75
    ) -> Dict[str, float]:
        """So khớp ngữ nghĩa TF-IDF cosine giữa Feature sinh ra và reference_features (T2)."""
        if not project.reference_features:
            return {"recall": 1.0, "precision": 1.0, "score": 1.0}
        pred_features = list({t.feature_name for t in wbs.tasks if t.feature_name.strip()})
        if not pred_features:
            return {"recall": 0.0, "precision": 0.0, "score": 0.0}

        ref_texts = [f"{f.title} {f.description}" for f in project.reference_features]
        vec = TfidfVectorizer().fit(ref_texts + pred_features)
        sim_matrix = cosine_similarity(vec.transform(ref_texts), vec.transform(pred_features))

        # Threshold tương đồng >= 0.35
        matched_refs = int(np.sum(np.max(sim_matrix, axis=1) >= 0.35))
        matched_preds = int(np.sum(np.max(sim_matrix, axis=0) >= 0.35))

        recall = matched_refs / len(ref_texts)
        precision = matched_preds / len(pred_features)
        s_rec = min(1.0, recall / recall_target)
        s_prec = min(1.0, precision / precision_target)
        return {
            "recall": round(recall, 4),
            "precision": round(precision, 4),
            "score": round(0.5 * s_rec + 0.5 * s_prec, 4)
        }

    # ================= NHÓM D: KIỂM CHỨNG & HIỆU QUẢ =================
    @staticmethod
    def eval_task_traceability(project: GoldenProject, wbs: WbsOutput, target: float = 0.90) -> Dict[str, float]:
        """% task có ít nhất 1 liên kết hợp lệ tới REQ-xx hoặc chunk_id trong rag_corpus."""
        if not wbs.tasks:
            return {"traced_ratio": 0.0, "score": 0.0}
        valid_ids = {r.req_id.upper() for r in project.req_list} | {c.chunk_id.upper() for c in project.rag_corpus}
        if not valid_ids:
            # Nếu dự án không cung cấp danh sách ID nguồn, kiểm tra có gắn ref không rỗng
            traced = sum(1 for t in wbs.tasks if len(t.source_refs) > 0)
        else:
            traced = sum(
                1 for t in wbs.tasks
                if any(ref.upper() in valid_ids for ref in t.source_refs)
            )
        ratio = traced / len(wbs.tasks)
        return {"traced_ratio": round(ratio, 4), "score": round(min(1.0, ratio / target), 4)}