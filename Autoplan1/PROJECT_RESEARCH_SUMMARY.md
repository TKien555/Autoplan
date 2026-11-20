# Autoplan: AI-Assisted Multi-Sprint Work Breakdown and Trello Planning

## 1. Executive summary

Autoplan is a Trello Power-Up that uses generative AI to transform a large project or card description into an actionable Work Breakdown Structure (WBS). The system assigns generated tasks to Trello board members according to their declared professional roles, distributes the tasks across multiple Sprints, constrains dates to Sprint boundaries, optionally grounds generation in board-specific technical documents through Retrieval-Augmented Generation (RAG), and can publish the reviewed task plan as Trello Lists and Cards.

The project is implemented as a two-part JavaScript application:

- **Frontend:** React 19 + Vite, embedded in Trello as an iframe/Power-Up view.
- **Backend:** Node.js + Express, responsible for authentication, validation, RAG retrieval, Gemini API calls, task normalization, and Trello API operations.

The intended interaction is human-in-the-loop:

1. A user provides a project/card description and Sprint configuration.
2. The backend retrieves relevant board knowledge when RAG is enabled.
3. Gemini generates a structured task array.
4. The backend validates and normalizes task assignments, Sprints, dates, and estimates.
5. The frontend displays an editable WBS for review.
6. After review, the user publishes the selected task plan to Trello.

## 2. Research problem and motivation

Software project planning frequently begins with an underspecified high-level request. Converting that request into a reliable WBS requires:

- decomposition into implementable work items;
- sequencing work across iterations;
- matching work to people with different skills;
- estimating effort and setting dates;
- incorporating organization-specific technical knowledge;
- preserving human control before changes reach a project-management system.

Autoplan addresses this problem by combining:

1. **Large language model generation** for task decomposition;
2. **role-aware assignment** using Trello board member metadata;
3. **multi-Sprint scheduling** with deterministic date constraints;
4. **RAG** over board-specific documents;
5. **human review** before external side effects;
6. **Trello API integration** for operational execution.

The key research angle is not merely text generation. It is the design of a constrained planning pipeline that converts natural-language requirements into structured, validated, and deployable project-management artifacts.

## 3. System objectives

### Functional objectives

- Accept a project/card title and description.
- Configure Sprint prefix, Sprint count, start date, and Sprint duration.
- Read Trello board members and their roles.
- Generate 4–20 structured tasks depending on the number of Sprints.
- Assign tasks to compatible board members.
- Retrieve relevant technical knowledge from documents attached to a board.
- Edit, add, remove, or reassign tasks before publication.
- Create Sprint-specific Trello Lists or use a shared/existing List.
- Create Trello Cards with descriptions, dates, estimates, roles, Sprint information, and references.
- Retry transient AI/Trello failures and retry failed card creations.

### Non-functional objectives

- Bound AI and external API latency.
- Avoid duplicate publication using request idempotency.
- Limit request size, upload size, queue size, and concurrent ingestion.
- Preserve board isolation for stored documents and vector retrieval.
- Provide explicit error messages instead of silent failures.
- Support graceful shutdown and SQLite WAL mode.

## 4. High-level architecture

```text
Trello Board
    |
    | Trello Power-Up iframe / connector
    v
React + Vite frontend
    |
    | /api/breakdown
    | /api/documents
    | /api/trello/push-tasks
    v
Express backend
    |
    +--> JWT validation and board/member context
    |
    +--> SQLite knowledge base
    |       +--> documents
    |       +--> chunks
    |       +--> Float32 embeddings
    |
    +--> Gemini generation and embedding APIs
    |
    +--> Trello REST API
```

### Main components

| Component | Responsibility |
|---|---|
| `frontend/src/App.jsx` | Planner UI, form state, task editing, RAG upload UI, Trello publication UI |
| `frontend/src/main.jsx` | React rendering and Trello Power-Up connector registration |
| `frontend/src/App.css` | Power-Up visual design, task cards, Sprint sections, forms, alerts |
| `frontend/public/connector.html` | Standalone connector entry point for Trello Power-Up registration |
| `backend/server.js` | API server, auth, rate limits, RAG, Gemini orchestration, Trello publication |
| `backend/migrate.js` | Optional migration/re-embedding utility from legacy JSON knowledge data |
| `backend/knowledge_base.db` | SQLite storage for documents, chunks, metadata, and embeddings |
| `frontend/vite.config.js` | Development server and `/api` proxy to backend port 3001 |
| `frontend/package.json` | Frontend scripts and dependencies |
| `backend/package.json` | Backend start command and runtime dependencies |

## 5. End-to-end workflow

### 5.1 Initialization

When the React application runs inside Trello, it creates a Trello iframe context. It requests:

- the current card name, description, and List;
- the current board ID and members;
- all board Lists;
- saved member-role metadata;
- encrypted Trello credentials stored through the Power-Up API.

When the application runs outside Trello, it falls back to local development values. The frontend sends an authorization header containing a Trello JWT when available, or a development token when explicitly allowed by the backend environment.

### 5.2 Input configuration

The user configures:

- project/card title;
- detailed description;
- Sprint prefix;
- number of Sprints, bounded to 1–6;
- project start date;
- duration per Sprint, bounded to 1–60 days;
- whether board knowledge RAG is enabled;
- roles for board members.

The backend independently sanitizes and clamps these values. Client-side validation is therefore a usability layer, not the only correctness boundary.

### 5.3 Knowledge retrieval

If RAG is enabled:

1. The backend builds a search query from the task name, description, and team roles.
2. It embeds the query using the configured Gemini embedding model.
3. It loads only chunks belonging to the authenticated board.
4. It computes cosine similarity against stored Float32 vectors.
5. It keeps results above a similarity threshold and returns the top four chunks.
6. The selected chunks are inserted into the generation context with document names and similarity scores.

RAG retrieval is best-effort. If embedding or retrieval times out, the backend logs the condition and continues with a generic planning context.

### 5.4 Structured task generation

The backend sends Gemini:

- a system instruction defining the Project Manager/architect role;
- the original task input;
- Sprint schedule and date ranges;
- board member IDs, names, and roles;
- retrieved RAG context;
- a JSON-array response schema.

The requested output fields are:

```text
title
description
role
assigneeId
assigneeName
estimatedHours
sprint
startDate
dueDate
referenceSource
```

The prompt requires:

- every Sprint to receive tasks;
- Sprint names to match the supplied schedule;
- dates to remain within the assigned Sprint;
- due dates to be no earlier than start dates;
- assignee IDs to match known board members when possible;
- a reference source to be included.

The backend tries configured generation models in order and can retry transient failures such as HTTP 429 or 503 within a request deadline.

### 5.5 Post-generation normalization

The backend does not trust the model output as-is. It:

- parses a JSON array, including recovery from Markdown code fences;
- maps unknown Sprint names to deterministic fallback Sprints;
- maps valid member IDs to canonical board-member data;
- replaces invalid dates with valid Sprint-bound dates;
- clamps estimated hours to 0.5–200 hours;
- sanitizes text fields and strips prompt-control tags;
- attaches RAG metadata to the response.

The frontend adds stable local IDs for editing and displays tasks grouped by Sprint.

### 5.6 Human review

The frontend displays tasks grouped by Sprint. Users can:

- edit titles and descriptions;
- change Sprint placement;
- change start and due dates;
- change assignees;
- edit roles;
- add tasks;
- remove tasks;
- reset the generated plan.

The task is not sent to Trello during generation. Publication is a separate action after review. This is an important safety and usability property because AI output may be incomplete, unsuitable, or inconsistent with current team constraints.

### 5.7 Trello publication

The user chooses one of three publication modes:

1. **Sprint Lists:** create or reuse one Trello List for each Sprint.
2. **Existing List:** publish all cards to a selected existing List.
3. **New List:** create one new List and publish all cards there.

For each task, the backend:

- validates the task;
- resolves the destination List;
- builds a Trello Card description containing Sprint, role, estimate, dates, source, and parent card;
- optionally assigns the Trello member;
- sets start and due dates;
- retries Trello 429 responses;
- records created cards and failed cards independently.

The request includes an idempotency key. Successful requests can be returned from an in-memory idempotency store to reduce duplicate card creation after retries.

## 6. Backend design

### 6.1 API endpoints

| Method | Endpoint | Purpose | Authentication |
|---|---|---|---|
| `GET` | `/api/health` | Service and model health information | No |
| `GET` | `/api/documents` | List board documents and chunk counts | Trello JWT |
| `POST` | `/api/documents` | Upload a file or ingest manual text into RAG | Trello JWT |
| `DELETE` | `/api/documents/:docId` | Delete a board document and its chunks | Trello JWT |
| `POST` | `/api/breakdown` | Generate and normalize the WBS | Trello JWT |
| `POST` | `/api/trello/push-tasks` | Create Lists and Cards in Trello | Trello JWT |

Supported document extensions are PDF, TXT, Markdown, JSON, and CSV. Uploaded files are processed in memory and limited to 10 MB.

### 6.2 Authentication model

The backend expects a Trello Power-Up JWT. It verifies:

- signature using one of two configured RSA keys;
- RS256 algorithm;
- Power-Up ID when configured;
- board ID;
- member ID.

For local development, an unverified development token can be accepted only when the explicit environment flag enables it and no JWT keys are configured. This mode must not be used in production.

### 6.3 Input protection

The backend includes:

- string length limits;
- removal of prompt-control XML tags;
- JSON request body limit;
- Multer file size and extension restrictions;
- request rate limiters per operation;
- concurrent ingestion limits;
- deadline and abort-signal propagation;
- board-scoped document access;
- board membership verification before Trello publication.

### 6.4 Asynchronous control

AI embedding and generation calls use a global task queue with configurable concurrency and maximum queue size. Requests have deadlines, and queued work can be canceled through abort signals. This prevents unlimited parallel model calls and provides predictable overload behavior.

### 6.5 Error handling

Errors are returned as JSON with a `success: false` flag and an explanatory `error` field. The system differentiates:

- invalid user input: HTTP 400;
- unauthenticated requests: HTTP 401;
- unauthorized board access: HTTP 403;
- duplicate document content: HTTP 409;
- queue or transient capacity issues: HTTP 429/503;
- Trello creation failures: HTTP 502;
- unexpected server failures: HTTP 500.

## 7. RAG and data model

### 7.1 SQLite schema

The knowledge base creates two principal tables:

#### `documents`

| Field | Meaning |
|---|---|
| `doc_id` | Document identifier |
| `board_id` | Trello board scope |
| `name` | Display name |
| `uploaded_by` | Member that uploaded the document |
| `content_hash` | Duplicate-content prevention |
| `embedding_model` | Model used for vectors |
| `dim` | Vector dimensionality |
| `created_at` | Creation timestamp |

#### `chunks`

| Field | Meaning |
|---|---|
| `id` | Chunk identifier |
| `doc_id` | Parent document |
| `board_id` | Trello board scope |
| `idx` | Chunk order |
| `content` | Chunk text |
| `embedding` | Float32 vector stored as a BLOB |

Foreign keys and an index on `chunks.board_id` support referential integrity and board-scoped retrieval. SQLite WAL mode is used for improved read/write concurrency.

### 7.2 Chunking strategy

Text is normalized by collapsing whitespace, then split into chunks of approximately 800 characters with 150-character overlap. Chunk boundaries prefer whitespace when possible. Documents exceeding 250 chunks are rejected to bound ingestion and embedding cost.

### 7.3 Retrieval strategy

The retrieval score is cosine similarity:

```text
cosine(a, b) = (a · b) / (||a|| ||b||)
```

The default retrieval configuration is:

- top K: 4;
- similarity threshold: 0.30;
- query embedding cache: up to 100 entries;
- cache key includes embedding model and dimensionality.

The cache is process-local and is invalidated per board after document ingestion or deletion.

## 8. Frontend design

The frontend is a React single-page interface rendered inside a Trello Power-Up iframe. The main planner state includes:

- current Trello context;
- board members and role assignments;
- board Lists;
- project input and Sprint configuration;
- generated tasks;
- RAG document status;
- Trello credentials;
- publication status and failed cards.

The UI is divided into three logical tabs:

1. **Planner:** project input, Sprint configuration, AI generation, task editing, Trello publication.
2. **Team:** board member roles.
3. **Knowledge:** document upload, manual text ingestion, document listing, and deletion.

The UI also uses a local development fallback when the Trello Power-Up runtime is absent.

## 9. Reliability and operational behavior

The design contains several reliability mechanisms:

- model fallback across configured Gemini models;
- bounded retries for 429/503 responses;
- request deadlines;
- abort propagation;
- queue capacity limits;
- Trello membership checks;
- idempotency keys;
- failed-card reporting and retry;
- graceful shutdown of HTTP server, AI queue, and SQLite;
- explicit health endpoint.

The current system is a single-process backend. Caches, rate-limit stores, queues, and idempotency data are in memory. A multi-instance deployment would require shared infrastructure for these concerns.

## 10. Security and privacy considerations

### Existing controls

- Trello JWT verification;
- board-scoped document queries;
- role-based contextual assignment rather than unrestricted member selection;
- input sanitization and prompt-boundary removal;
- CSP `frame-ancestors` restrictions for Trello embedding;
- CORS allow-list configuration;
- rate limiting;
- upload validation;
- encrypted Trello secret storage through the Power-Up API;
- no API credentials in generated task descriptions.

### Important risks and research limitations

1. Local development can accept unverified tokens when enabled.
2. Trello credentials are sent from frontend to backend for the Trello REST API operation; deployment should use strict TLS and secret handling.
3. The in-memory idempotency store does not survive process restarts.
4. The in-memory rate limiter is not shared across instances.
5. RAG retrieval is based on dense cosine similarity without a lexical or reranking stage.
6. Model output may still be semantically incorrect even after structural normalization.
7. The system currently exposes no persistent audit log of who approved or published a plan.
8. The project includes local environment files and credential-oriented command notes; these must never be committed or included in a paper appendix.

## 11. Proposed research contributions

The project can be framed around the following contributions:

### Contribution A: Constrained LLM-to-WBS pipeline

A pipeline that combines natural-language project descriptions with explicit Sprint schedules, date windows, team roles, and a typed output schema. Post-generation normalization provides deterministic guarantees where the model is uncertain.

### Contribution B: Board-scoped RAG for planning

Technical documents are chunked, embedded, stored with board isolation, and retrieved at planning time. This allows planning suggestions to reflect organization-specific standards without hard-coding every standard into the prompt.

### Contribution C: Human-in-the-loop publication

AI-generated tasks are treated as a draft. Users can inspect and edit the WBS before it creates external project-management artifacts. This separates recommendation from execution.

### Contribution D: Operational integration

The system connects planning output to real Trello Lists and Cards, including dates, member assignment, descriptions, idempotency, retries, and partial-failure recovery.

## 12. Suggested research questions

1. Does RAG improve the technical relevance and organization-specific compliance of generated tasks?
2. Does explicit Sprint/date constraint handling reduce invalid schedules compared with unconstrained LLM generation?
3. Does role-aware assignment improve human-rated assignment appropriateness?
4. How much editing do users perform before approving an AI-generated WBS?
5. Does the human-review step reduce harmful or unwanted Trello changes?
6. What is the latency and cost trade-off between RAG-enabled and non-RAG planning?
7. How robust is the pipeline under invalid model JSON, unknown members, invalid dates, rate limits, and partial Trello failures?

## 13. Evaluation methodology

### 13.1 Dataset

Construct a benchmark of project/card descriptions from several domains, such as:

- e-commerce;
- payment systems;
- internal business applications;
- mobile applications;
- data/AI systems.

For each item, collect:

- expected work categories;
- expected Sprint ordering;
- recommended roles;
- date constraints;
- domain-specific reference documents.

### 13.2 Baselines

Compare:

1. LLM generation without constraints;
2. LLM generation with Sprint/date constraints but without RAG;
3. LLM generation with RAG but without role-aware assignment;
4. full Autoplan pipeline.

### 13.3 Metrics

#### Structural validity

- JSON parse success rate;
- required-field completeness;
- percentage of tasks assigned to valid Sprints;
- percentage of dates inside Sprint bounds;
- percentage of due dates greater than or equal to start dates.

#### Planning quality

- task completeness;
- task non-redundancy;
- actionability;
- Sprint sequencing quality;
- effort-estimate plausibility;
- assignment appropriateness.

These can be rated by experienced project managers using a Likert scale or pairwise preference test.

#### RAG quality

- retrieval precision at K;
- citation/reference correctness;
- domain-standard coverage;
- groundedness/hallucination rate.

#### Human factors

- time to first acceptable plan;
- number of edits per plan;
- approval rate;
- perceived trust;
- perceived workload;
- System Usability Scale score.

#### Operational metrics

- p50/p95 generation latency;
- p50/p95 end-to-end publication latency;
- API failure rate;
- retry rate;
- partial publication rate;
- cost per generated plan.

### 13.4 Ablation studies

Recommended ablations:

- remove RAG;
- remove date normalization;
- remove role metadata;
- remove model fallback;
- remove human review;
- change chunk size and overlap;
- change retrieval threshold and top K.

## 14. Threats to validity

- Project-manager ratings may be subjective.
- Prompt and model versions can change output quality.
- Synthetic project descriptions may not represent real organizational work.
- Trello is one project-management platform, so generalization to Jira or Azure DevOps requires additional validation.
- The current system does not yet maintain a formal historical dataset of accepted and rejected plans.
- Embedding similarity does not guarantee that retrieved text is truly relevant to every generated task.
- Human review can improve safety but also makes fully automatic quality comparisons difficult.

## 15. Future work

### Product and engineering

- add persistent plan versions and approval audit trails;
- support plan diffing between AI generations;
- add explicit confidence scores per task;
- add dependency relationships between tasks;
- support Jira, GitHub Projects, and Azure DevOps;
- replace process-local queue/cache/idempotency state with shared services;
- add automated integration tests with mocked Gemini and Trello APIs;
- add observability for latency, token usage, retrieval quality, and publication failures;
- add configurable organizational policies for security, testing, and Definition of Done.

### Research

- learn assignment preferences from approved plans;
- evaluate human-AI mixed-initiative planning;
- compare dense retrieval with hybrid lexical+dense retrieval;
- investigate constrained decoding or function calling for stronger schema compliance;
- measure whether repeated use improves planning consistency;
- study explainable assignment rationales and user trust.

## 16. Reproducibility notes

### Development services

Backend:

```powershell
cd backend
npm.cmd start
```

Frontend:

```powershell
cd frontend
npm.cmd run dev
```

The frontend development server proxies `/api` requests to the backend at port 3001 through the Vite configuration. The frontend normally runs at port 5173.

### Environment variables

The backend reads environment configuration from `backend/.env`. The research artifact should document variable names and meanings, but must not contain actual values for:

- Gemini API keys;
- Trello JWT keys;
- Trello API keys;
- Trello tokens.

### Verification

The frontend provides:

```powershell
cd frontend
npm.cmd run build
npm.cmd run lint
```

The backend can be syntax-checked with:

```powershell
node --check backend\server.js
```

The health endpoint is:

```text
http://localhost:3001/api/health
```

## 17. Source map

This summary is based on the following project files:

- [backend/server.js](./backend/server.js)
- [backend/migrate.js](./backend/migrate.js)
- [backend/package.json](./backend/package.json)
- [frontend/src/App.jsx](./frontend/src/App.jsx)
- [frontend/src/App.css](./frontend/src/App.css)
- [frontend/src/index.css](./frontend/src/index.css)
- [frontend/src/main.jsx](./frontend/src/main.jsx)
- [frontend/public/connector.html](./frontend/public/connector.html)
- [frontend/vite.config.js](./frontend/vite.config.js)
- [frontend/package.json](./frontend/package.json)
- [frontend/index.html](./frontend/index.html)
- [lenh.txt](./lenh.txt), used only to understand local startup notes; its credentials are intentionally excluded from this document.

## 18. Paper-ready abstract draft

**Abstract—** This paper presents Autoplan, a human-in-the-loop planning system that uses generative AI to transform high-level software project descriptions into structured, multi-Sprint work breakdown structures. The system combines role-aware task assignment, deterministic Sprint and date constraints, board-scoped retrieval-augmented generation over technical documents, and direct integration with Trello. Unlike a direct text-generation approach, Autoplan applies schema validation, output normalization, date correction, member resolution, bounded retries, and explicit review before creating project-management artifacts. The architecture is implemented with a React/Vite Trello Power-Up frontend, an Express backend, Gemini generation and embedding services, and SQLite-based vector storage. The proposed evaluation measures structural validity, planning quality, groundedness, assignment appropriateness, human editing effort, latency, and publication reliability. The system provides a practical testbed for studying constrained LLM planning and human oversight in software project management.

## 19. Paper structure suggestion

1. Introduction
2. Background and related work
3. Problem definition and requirements
4. System architecture
5. Constrained WBS generation method
6. Board-scoped RAG method
7. Human-in-the-loop Trello execution
8. Experimental setup
9. Results
10. Threats to validity
11. Discussion and future work
12. Conclusion

