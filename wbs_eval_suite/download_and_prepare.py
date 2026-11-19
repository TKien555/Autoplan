import os
import json
import sqlite3
import zipfile
import subprocess
from pathlib import Path
from typing import List, Optional
import requests
import pandas as pd
import numpy as np
from datasets import load_dataset
from schemas import (
    GoldenProject, RequirementItem, ReferenceFeature,
    TeamMember, RagChunk
)

DATA_DIR = Path(__file__).resolve().parent / "raw_datasets"


class DatasetDownloader:
    """Tải dữ liệu thô từ 4 nguồn: PURE, NEODATASET, StorySeek, SEOSS 33."""

    @staticmethod
    def download_pure_zenodo(zenodo_record_id: str = "1414117"):
        """Tải bộ PURE (79 SRS) từ Zenodo API."""
        out_dir = DATA_DIR / "PURE"
        out_dir.mkdir(exist_ok=True)
        api_url = f"https://zenodo.org/api/records/{zenodo_record_id}"
        resp = requests.get(api_url, timeout=30)
        resp.raise_for_status()
        files = resp.json().get("files", [])
        for f in files:
            fname = f["key"]
            dl_url = f["links"]["self"]
            dest = out_dir / fname
            if not dest.exists():
                print(f"[PURE] Downloading {fname}...")
                r = requests.get(dl_url, stream=True, timeout=60)
                with open(dest, "wb") as fp:
                    for chunk in r.iter_content(chunk_size=8192):
                        fp.write(chunk)
                if dest.suffix == ".zip":
                    with zipfile.ZipFile(dest, "r") as zf:
                        zf.extractall(out_dir)
        return out_dir

    @staticmethod
    def download_neodataset_github(repo_url: str = "https://github.com/giseldo/neodataset"):
        """Clone kho NEODATASET (20.479 user stories, 33 dự án)."""
        out_dir = DATA_DIR / "NEODATASET"
        if not out_dir.exists():
            print("[NEODATASET] Cloning repository...")
            subprocess.run(["git", "clone", "--depth", "1", repo_url, str(out_dir)], check=True)
        return out_dir

    @staticmethod
    def download_storyseek_hf(hf_repo: str = "SoftACE/StorySeek", hf_token: Optional[str] = None):
        """Tải StorySeek từ Hugging Face Datasets."""
        out_dir = DATA_DIR / "StorySeek"
        out_dir.mkdir(parents=True, exist_ok=True)

        if any(out_dir.glob("*.jsonl")):
            print("[StorySeek] Đã tìm thấy dữ liệu có sẵn trong raw_datasets/StorySeek.")
            return out_dir

        repo = (hf_repo or os.environ.get("STORYSEEK_HF_REPO", "")).strip()
        repo = repo.split("?")[0]
        prefix = "https://huggingface.co/datasets/"
        if repo.startswith(prefix):
            repo = repo[len(prefix):].strip("/")
        if not repo:
            raise ValueError("Hugging Face repository for StorySeek must not be empty.")

        print(f"[StorySeek] Loading '{repo}' from Hugging Face...")
        ds = load_dataset(repo, token=hf_token)
        for split_name, split_ds in ds.items():
            split_ds.to_json(out_dir / f"{split_name}.jsonl", force_ascii=False)
        return out_dir

    @staticmethod
    def download_seoss33_dataverse(persistent_id_or_url: str = "doi:10.7910/DVN/PDDXJ3"):
        """Tải các file SQLite của SEOSS 33 từ Harvard Dataverse."""
        out_dir = DATA_DIR / "SEOSS33"
        out_dir.mkdir(parents=True, exist_ok=True)

        if list(out_dir.rglob("*.sqlite*")):
            print("[SEOSS 33] Đã tìm thấy dữ liệu SQLite có sẵn trong raw_datasets/SEOSS33.")
            return out_dir

        pid = persistent_id_or_url.strip()
        if "persistentId=" in pid:
            pid = pid.split("persistentId=", 1)[1].split("&", 1)[0]

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "application/json"
        }
        api_url = f"https://dataverse.harvard.edu/api/datasets/:persistentId/?persistentId={pid}"
        resp = requests.get(api_url, headers=headers, timeout=30)
        if resp.status_code == 403:
            raise PermissionError(
                f"Harvard Dataverse từ chối tải tự động (403) với '{pid}'. "
                "Bạn hãy mở link SEOSS 33 trên trình duyệt, tải 5 file .sqlite về và chép vào thư mục "
                "'raw_datasets\\SEOSS33\\', sau đó chạy lại."
            )
        resp.raise_for_status()
        files = resp.json()["data"]["latestVersion"]["files"]
        sqlite_files = [f for f in files if ".sqlite" in f["dataFile"]["filename"].lower()]
        target_files = sqlite_files[:5] if sqlite_files else files[:5]

        for item in target_files:
            file_id = item["dataFile"]["id"]
            fname = item["dataFile"]["filename"]
            dest = out_dir / fname
            if not dest.exists():
                print(f"[SEOSS 33] Downloading {fname}...")
                dl_url = f"https://dataverse.harvard.edu/api/access/datafile/{file_id}"
                r = requests.get(dl_url, headers=headers, stream=True, timeout=120)
                r.raise_for_status()
                with open(dest, "wb") as fp:
                    for chunk in r.iter_content(chunk_size=8192):
                        fp.write(chunk)
        return out_dir


class GoldenSetBuilder:
    """Chuẩn hoá dữ liệu thô thành 4 tầng Golden Set + 3 dự án đối kháng."""

    @staticmethod
    def default_team() -> List[TeamMember]:
        return [
            TeamMember(member_id="M1", role="Backend", skills=["Python", "API", "DB"], capacity_hours_per_sprint=80),
            TeamMember(member_id="M2", role="Frontend", skills=["React", "UI", "TS"], capacity_hours_per_sprint=80),
            TeamMember(member_id="M3", role="QA", skills=["Testing", "Automation"], capacity_hours_per_sprint=60),
            TeamMember(member_id="M4", role="DevOps", skills=["CI/CD", "Docker", "Cloud"], capacity_hours_per_sprint=40),
        ]

    @staticmethod
    def compute_pert_from_story_points(points: List[float], hours_per_point: float) -> dict:
        """Quy đổi Story Points sang giờ bằng hệ số dự án và dựng khoảng PERT."""
        hours = np.array([p * hours_per_point for p in points if p > 0])
        if len(hours) == 0:
            return {"pert_min": 40.0, "pert_most_likely": 80.0, "pert_max": 120.0}
        total_ml = float(np.sum(hours))
        std = float(np.std(hours) * np.sqrt(len(hours)))
        return {
            "pert_min": max(8.0, round(total_ml - 1.5 * std, 2)),
            "pert_most_likely": round(total_ml, 2),
            "pert_max": round(total_ml + 2.0 * std, 2),
            "hours_per_point": hours_per_point
        }

    def build_tier1_pure(self, pure_dir: Path, limit: int = 15) -> List[GoldenProject]:
        """T1: 15 SRS từ PURE. Tách câu/đoạn yêu cầu làm req_list cơ sở (cần rà soát tay bổ sung)."""
        projects = []
        txt_files = list(pure_dir.rglob("*.txt"))[:limit]
        for idx, fpath in enumerate(txt_files, start=1):
            text = fpath.read_text(encoding="utf-8", errors="ignore")
            lines = [ln.strip() for ln in text.splitlines() if len(ln.strip()) > 30]
            reqs = [
                RequirementItem(req_id=f"REQ-{i:02d}", text=ln)
                for i, ln in enumerate(lines[:25], start=1)
            ]
            chunks = [
                RagChunk(chunk_id=f"PURE_{idx}_C{i:02d}", source_doc=fpath.name, content=ln)
                for i, ln in enumerate(lines, start=1)
            ]
            projects.append(GoldenProject(
                id=f"T1_PURE_{idx:02d}",
                source="PURE",
                tier="T1",
                srs_text=text[:12000],
                req_list=reqs,
                team_profile=self.default_team(),
                rag_corpus=chunks
            ))
        return projects

    def build_tier2_storyseek(self, ss_dir: Path, limit: int = 10) -> List[GoldenProject]:
        """T2: Tạo dự án từ StorySeek (Goal, Actor, Deliverable, User Story)."""
        projects = []
        jsonl_files = list(ss_dir.glob("*.jsonl"))
        if not jsonl_files:
            return projects

        df = pd.concat([pd.read_json(f, lines=True) for f in jsonl_files], ignore_index=True)
        if df.empty or len(df.columns) == 0:
            return projects

        group_col = next(
            (c for c in df.columns if any(k in c.lower() for k in ["project", "domain", "goal", "system"])),
            df.columns[0]
        )
        story_col = next(
            (c for c in df.columns if any(k in c.lower() for k in ["story", "requirement", "text", "description"])),
            df.columns[-1]
        )
        deliv_col = next(
            (c for c in df.columns if any(k in c.lower() for k in ["deliverable", "feature", "goal"])),
            group_col
        )

        for idx, (grp_name, group) in enumerate(list(df.groupby(group_col))[:limit], start=1):
            features, srs_lines = [], []
            for _, row in group.head(25).iterrows():
                if {"us_actor", "us_action", "us_expected_outcome"}.issubset(row.index):
                    story_txt = f"As {row['us_actor']}, I want to {row['us_action']} so that {row['us_expected_outcome']}"
                else:
                    story_txt = str(row[story_col]).strip()
                deliv_txt = str(row[deliv_col]).strip()
                srs_lines.append(f"- {story_txt}")
                features.append(ReferenceFeature(
                    feature_id=f"SS-FEAT-{len(features)+1:02d}",
                    title=deliv_txt[:100],
                    description=story_txt
                ))
            projects.append(GoldenProject(
                id=f"T2_SS_{idx:02d}",
                source="StorySeek",
                tier="T2",
                srs_text=f"Goal / Domain: {grp_name}\n" + "\n".join(srs_lines),
                reference_features=features,
                team_profile=self.default_team()
            ))
        return projects

    def build_tier2_and_3_neodataset(self, neo_dir: Path, t2_limit: int = 10, t3_limit: int = 8) -> List[GoldenProject]:
        """T2 & T3: Gom nhóm user stories theo dự án từ NEODATASET và hiệu chỉnh Story Points -> Giờ."""
        projects = []
        csv_files = list(neo_dir.rglob("*.csv"))
        if not csv_files:
            return projects

        df = pd.concat([pd.read_csv(f, on_bad_lines="skip") for f in csv_files], ignore_index=True)
        proj_col = next((c for c in df.columns if "project" in c.lower()), df.columns[0])
        title_col = next((c for c in df.columns if "title" in c.lower() or "summary" in c.lower()), df.columns[1])
        desc_col = next((c for c in df.columns if "desc" in c.lower()), title_col)
        sp_col = next((c for c in df.columns if "point" in c.lower()), None)

        grouped = list(df.groupby(proj_col))
        for idx, (proj_name, group) in enumerate(grouped[: (t2_limit + t3_limit)], start=1):
            tier = "T2" if idx <= t2_limit else "T3"
            # Hệ số quy đổi đặc thù từng dự án (mặc định 6h/SP nếu không có cột giờ thực tế)
            hours_per_sp = 6.0 + (idx % 3) * 1.5
            features, sps, srs_lines = [], [], []
            for r_i, row in group.head(30).iterrows():
                sp = float(row[sp_col]) if sp_col and pd.notna(row[sp_col]) else 3.0
                sps.append(sp)
                title = str(row[title_col])
                desc = str(row[desc_col])
                srs_lines.append(f"- {title}: {desc}")
                features.append(ReferenceFeature(
                    feature_id=f"FEAT-{len(features)+1:02d}",
                    title=title,
                    description=desc,
                    story_points=sp,
                    estimated_hours=sp * hours_per_sp
                ))
            pert = self.compute_pert_from_story_points(sps, hours_per_sp)
            team = self.default_team()
            sprint_cap = sum(m.capacity_hours_per_sprint for m in team)
            projects.append(GoldenProject(
                id=f"{tier}_NEO_{idx:02d}",
                source="NEODATASET",
                tier=tier,
                srs_text=f"Project: {proj_name}\n" + "\n".join(srs_lines),
                reference_features=features,
                reference_sizes=pert,
                team_profile=team,
                sprint_capacity_hours=sprint_cap,
                sprint_count=2,
                project_duration_hours=max(pert["pert_max"], sprint_cap * 2)
            ))
        return projects

    def build_tier4_seoss33(self, seoss_dir: Path, limit: int = 5) -> List[GoldenProject]:
        """T4: Trích xuất yêu cầu, bug, liên kết truy vết từ SQLite của SEOSS 33."""
        projects = []
        sqlite_files = list(seoss_dir.rglob("*.sqlite*"))[:limit]
        for idx, db_path in enumerate(sqlite_files, start=1):
            conn = sqlite3.connect(db_path)
            cur = conn.cursor()
            tables = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
            reqs, chunks = [], []
            if "issue" in tables:
                rows = cur.execute(
                    "SELECT issue_id, type, summary, description FROM issue LIMIT 40"
                ).fetchall()
                for issue_id, itype, summary, desc in rows:
                    content = f"[{itype}] {summary}: {desc or ''}"
                    chunks.append(RagChunk(chunk_id=str(issue_id), source_doc=db_path.name, content=content))
                    if str(itype).lower() in ("feature", "improvement", "requirement", "story"):
                        reqs.append(RequirementItem(req_id=str(issue_id), text=content))
            conn.close()
            projects.append(GoldenProject(
                id=f"T4_SEOSS_{idx:02d}",
                source="SEOSS33",
                tier="T4",
                srs_text="\n".join(r.text for r in reqs[:15]),
                req_list=reqs[:15],
                team_profile=self.default_team(),
                rag_corpus=chunks
            ))
        return projects

    def build_adversarial_set(self) -> List[GoldenProject]:
        """3 dự án đối kháng: SRS mâu thuẫn, SRS thiếu phi chức năng, SRS quá ngắn."""
        team = self.default_team()
        return [
            GoldenProject(
                id="ADV_01_CONTRADICTORY",
                source="ADVERSARIAL",
                tier="ADV",
                srs_text=(
                    "REQ-01: Hệ thống phải hoạt động hoàn toàn offline trên thiết bị di động không cần Internet.\n"
                    "REQ-02: Mọi giao dịch phải đồng bộ thời gian thực qua REST API lên máy chủ đám mây và xác thực OAuth2 online."
                ),
                req_list=[
                    RequirementItem(req_id="REQ-01", text="Hoạt động hoàn toàn offline không cần Internet."),
                    RequirementItem(req_id="REQ-02", text="Đồng bộ thời gian thực qua REST API online.")
                ],
                team_profile=team,
                adversarial_probes=["offline", "mâu thuẫn", "đồng bộ", "xung đột"]
            ),
            GoldenProject(
                id="ADV_02_MISSING_NFR",
                source="ADVERSARIAL",
                tier="ADV",
                srs_text="REQ-01: Xây dựng cổng thanh toán trực tuyến xử lý thẻ tín dụng quốc tế cho ngân hàng.",
                req_list=[RequirementItem(req_id="REQ-01", text="Cổng thanh toán thẻ tín dụng quốc tế.")],
                team_profile=team,
                adversarial_probes=["PCI-DSS", "bảo mật", "hiệu năng", "SLA", "mã hoá"]
            ),
            GoldenProject(
                id="ADV_03_TOO_SHORT",
                source="ADVERSARIAL",
                tier="ADV",
                srs_text="Làm app đặt đồ ăn giống GrabFood trong 2 tuần.",
                req_list=[RequirementItem(req_id="REQ-01", text="Làm app đặt đồ ăn giống GrabFood.")],
                team_profile=team,
                adversarial_probes=["phạm vi", "người dùng", "thanh toán", "tài xế", "làm rõ"]
            )
        ]

    @staticmethod
    def validate_trello_schema(trello_json: dict) -> bool:
        """Kiểm tra khuôn mẫu board Trello (Atlassian): board -> lists -> cards -> checklists & labels."""
        if not isinstance(trello_json, dict):
            return False
        required_keys = {"board_name", "lists"}
        if not required_keys.issubset(trello_json.keys()):
            return False
        for lst in trello_json.get("lists", []):
            if "name" not in lst or "cards" not in lst:
                return False
            for card in lst["cards"]:
                if not {"title", "labels", "checklists"}.issubset(card.keys()):
                    return False
        return True