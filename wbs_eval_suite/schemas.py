from typing import List, Dict, Optional, Literal, Any
from pydantic import BaseModel, Field

class RequirementItem(BaseModel):
    req_id: str                     # VD: "REQ-01"
    text: str
    req_type: Literal["functional", "non_functional", "constraint"] = "functional"

class ReferenceFeature(BaseModel):
    feature_id: str
    title: str
    description: str
    story_points: Optional[float] = None
    estimated_hours: Optional[float] = None

class TeamMember(BaseModel):
    member_id: str
    role: str                       # VD: "Backend", "Frontend", "QA", "DevOps", "PM"
    skills: List[str]
    capacity_hours_per_sprint: float

class RagChunk(BaseModel):
    chunk_id: str
    source_doc: str
    content: str

class GoldenProject(BaseModel):
    id: str
    source: Literal["PURE", "NEODATASET", "StorySeek", "SEOSS33", "ADVERSARIAL"]
    tier: Literal["T1", "T2", "T3", "T4", "ADV"]
    srs_text: str
    req_list: List[RequirementItem] = Field(default_factory=list)
    reference_features: List[ReferenceFeature] = Field(default_factory=list)
    reference_sizes: Dict[str, float] = Field(default_factory=dict)  # pert_min, pert_most_likely, pert_max, actual_hours
    team_profile: List[TeamMember] = Field(default_factory=list)
    sprint_capacity_hours: float = 160.0
    sprint_count: int = 2
    project_duration_hours: float = 320.0
    rag_corpus: List[RagChunk] = Field(default_factory=list)
    adversarial_probes: List[str] = Field(default_factory=list)

# --- Cấu trúc WBS do AI sinh ra ---
class WbsTask(BaseModel):
    task_id: str
    feature_name: str
    title: str
    description: str
    task_type: Literal["dev", "integration", "testing", "bugfix", "devops", "design"] = "dev"
    assigned_role: str
    assigned_member_id: Optional[str] = None
    estimated_hours: float
    dependencies: List[str] = Field(default_factory=list)
    acceptance_criteria: List[str] = Field(default_factory=list)
    source_refs: List[str] = Field(default_factory=list)       # Liên kết REQ-xx hoặc chunk_id
    verbatim_quotes: List[str] = Field(default_factory=list)   # Trích dẫn nguyên văn từ SRS/RAG
    confidence: Literal["high", "medium", "low"] = "medium"

class WbsOutput(BaseModel):
    project_id: str
    clarifying_questions: List[str] = Field(default_factory=list)  # Dành cho SRS mơ hồ/đối kháng
    tasks: List[WbsTask] = Field(default_factory=list)
    trello_export: Optional[Dict[str, Any]] = None                 # Cấu trúc board/cards/checklists Trello