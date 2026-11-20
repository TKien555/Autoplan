import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
const MODEL = 'gemini-3.5-flash-lite'; // Nhanh, ổn định và tuân thủ schema cao

// ============================================================================
// 1. INPUT CHI TIẾT & ĐẦY ĐỦ YÊU CẦU DỰ ÁN THỰC TẾ
// ============================================================================
export const DETAILED_PROJECT_INPUT = {
    taskName: 'Xây dựng Hệ thống Thanh toán & Quản lý Gói cước Định kỳ (Subscription & Billing Engine)',
    description: `
Hệ thống xử lý thanh toán đa cổng và quản lý vòng đời thuê bao định kỳ (Recurring Billing) cho nền tảng SaaS B2B/B2C.

YÊU CẦU NGHIỆP VỤ & KIẾN TRÚC CỐT LÕI:
1. Đa cổng thanh toán:
   - Stripe Billing: Xử lý thẻ quốc tế (Visa/Mastercard), recurring billing tự động.
   - VNPay & MoMo: Thanh toán qua QR Code và thẻ nội địa (One-off credits / Nạp lượt dùng).
2. Quản lý trạng thái Subscription (State Machine):
   - Các trạng thái: TRIAL -> ACTIVE -> PAST_DUE -> UNPAID -> CANCELED.
   - Hỗ trợ nâng cấp (Upgrade), hạ cấp (Downgrade) tính cước theo tỷ lệ sử dụng (Proration billing).
3. Xử lý Webhook & Tính bất biến (Idempotency):
   - Xác thực chữ ký số HMAC-SHA256 trên mọi incoming webhook từ Stripe và VNPay.
   - Cơ chế Idempotency Key lưu trên Redis với distributed lock để ngăn ngừa xử lý trùng lặp giao dịch (Race condition).
4. Cơ chế Thu nợ tự động (Dunning Management & Grace Period):
   - Khi gia hạn thẻ thất bại: Tự động retry theo chiến lược Exponential Backoff (sau 12h, 48h, 72h).
   - Tự động hạ trạng thái sang PAST_DUE, gửi email cảnh báo người dùng cập nhật thẻ qua SendGrid.
5. Giao diện Người dùng (Web React & Mobile Flutter):
   - Bảng giá động (Pricing Matrix), cổng thanh toán nhúng bảo mật (Stripe Elements / SDK).
   - Trang Lịch sử thanh toán & Hóa đơn điện tử PDF có thể tải về.
6. An ninh & Khả năng quan sát (Security & Observability):
   - Tuân thủ PCI-DSS Level 4: Tuyệt đối không lưu số thẻ thô trên CSDL, chỉ lưu tokenized customer ID.
   - Structured audit log cho mọi giao dịch tài chính.
   - Metric Prometheus: Tỷ lệ thanh toán thành công, Webhook latency, Churn rate. Alert về Slack khi tỷ lệ lỗi > 5%.
    `,
    sprintCount: 3,
    sprintDurationDays: 14,
    sprintPrefix: 'Sprint',
    sprintStartDate: '2026-11-20',
    teamMembers: [
        { id: 'mem_arch', fullName: 'Trần Quang Huy', role: 'Solution Architect / Tech Lead' },
        { id: 'mem_be', fullName: 'Nguyễn Minh Khôi', role: 'Senior Backend Developer (Node.js/PostgreSQL)' },
        { id: 'mem_fe', fullName: 'Đặng Thu Hà', role: 'Frontend React Developer' },
        { id: 'mem_mb', fullName: 'Vũ Hoàng Long', role: 'Mobile Flutter Developer' },
        { id: 'mem_qa', fullName: 'Bùi Phương Thảo', role: 'QA / Automation Tester' },
        { id: 'mem_devops', fullName: 'Phạm Tuấn Anh', role: 'DevOps / SRE Engineer' }
    ]
};

// ============================================================================
// 2. SCHEMA CŨ (HIỆN TẠI)
// ============================================================================
const OLD_TASK_SCHEMA = {
    type: 'array',
    items: {
        type: 'object',
        properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            role: { type: 'string' },
            assigneeId: { type: 'string', nullable: true },
            assigneeName: { type: 'string' },
            estimatedHours: { type: 'number' },
            sprint: { type: 'string' },
            startDate: { type: 'string' },
            dueDate: { type: 'string' },
            referenceSource: { type: 'string' }
        },
        required: ['title', 'description', 'role', 'assigneeName', 'estimatedHours', 'sprint', 'startDate', 'dueDate', 'referenceSource']
    }
};

// ============================================================================
// 3. SCHEMA MỚI NÂNG CẤP (CHUYÊN SÂU KỸ THUẬT & CHỐNG CRUD)
// ============================================================================
const ENHANCED_TASK_SCHEMA = {
    type: 'array',
    description: 'Danh sách các công việc kỹ thuật chuyên sâu được phân rã chi tiết, có checklist DoD, xử lý ngoại lệ và liên kết phụ thuộc',
    items: {
        type: 'object',
        properties: {
            title: { type: 'string', description: 'Tiêu đề task kỹ thuật rõ ràng, phản ánh giải pháp thay vì thao tác CRUD đơn thuần' },
            category: { type: 'string', description: 'Hạng mục: Architecture | Backend | Frontend | Mobile | Security | DevOps | QA' },
            description: { type: 'string', description: 'Mô tả chi tiết giải pháp kỹ thuật, công nghệ áp dụng, luồng xử lý dữ liệu' },
            acceptanceCriteria: {
                type: 'array',
                items: { type: 'string' },
                description: 'Danh sách checklist Definition of Done (DoD) có thể kiểm chứng nghiệm thu (HTTP code, test coverage, validation, SLA)'
            },
            edgeCases: {
                type: 'array',
                items: { type: 'string' },
                description: 'Các ca biên, kịch bản lỗi, race condition, timeout hoặc bảo mật cần xử lý'
            },
            deliverables: { type: 'string', description: 'Sản phẩm đầu ra cụ thể: Migration script, API contract, Component, Test suite, Helm chart...' },
            role: { type: 'string' },
            assigneeId: { type: 'string', nullable: true },
            assigneeName: { type: 'string' },
            estimatedHours: { type: 'number' },
            sprint: { type: 'string' },
            startDate: { type: 'string' },
            dueDate: { type: 'string' },
            referenceSource: { type: 'string', description: 'Nguồn quy chuẩn: PCI-DSS, Stripe Docs, RFC 7519, Clean Architecture...' }
        },
        required: [
            'title', 'category', 'description', 'acceptanceCriteria', 'edgeCases',
            'deliverables', 'role', 'assigneeName', 'estimatedHours', 'sprint',
            'startDate', 'dueDate', 'referenceSource'
        ]
    }
};

// ============================================================================
// 4. TIÊU CHÍ ĐÁNH GIÁ CHUẨN XÁC & TRỰC QUAN (RUBRIC EVALUATOR)
// ============================================================================
const RUBRIC_EVALUATION_SCHEMA = {
    type: 'object',
    properties: {
        technicalDepthScore: { type: 'number', description: 'Điểm 0-10: Độ sâu kỹ thuật, giải quyết bài toán phức tạp, tránh CRUD hời hợt' },
        technicalDepthReason: { type: 'string', description: 'Nhận xét chi tiết về độ sâu kỹ thuật' },
        actionabilityScore: { type: 'number', description: 'Điểm 0-10: Tính cụ thể của tiêu chí nghiệm thu (DoD), checklist kiểm thử' },
        actionabilityReason: { type: 'string', description: 'Nhận xét chi tiết về tính khả thi và tiêu chí nghiệm thu' },
        roleAndSprintScore: { type: 'number', description: 'Điểm 0-10: Tính hợp lý trong phân công đúng vai trò và chia đều 3 Sprint theo tiến trình' },
        roleAndSprintReason: { type: 'string', description: 'Nhận xét về phân bổ vai trò và trình tự Sprint' },
        resilienceSecurityScore: { type: 'number', description: 'Điểm 0-10: Xử lý ngoại lệ, race conditions, idempotency, bảo mật PCI-DSS, retry' },
        resilienceSecurityReason: { type: 'string', description: 'Nhận xét về xử lý lỗi và an toàn hệ thống' },
        groundingScore: { type: 'number', description: 'Điểm 0-10: Mức độ bám sát yêu cầu, không ảo giác, trích dẫn chuẩn kỹ thuật' },
        groundingReason: { type: 'string', description: 'Nhận xét về nguồn gốc và độ khớp yêu cầu' },
        totalScore: { type: 'number', description: 'Tổng điểm trên thang 50' },
        overallVerdict: { type: 'string', description: 'Kết luận tổng thể: POOR | ACCEPTABLE | EXCELLENT' }
    },
    required: [
        'technicalDepthScore', 'technicalDepthReason',
        'actionabilityScore', 'actionabilityReason',
        'roleAndSprintScore', 'roleAndSprintReason',
        'resilienceSecurityScore', 'resilienceSecurityReason',
        'groundingScore', 'groundingReason',
        'totalScore', 'overallVerdict'
    ]
};

async function evaluateTasks(tasks, inputSpec, versionLabel) {
    console.log(`\n🔍 Đang chấm điểm và đánh giá kết quả [${versionLabel}] theo Bộ tiêu chí trực quan...`);
    const prompt = `
Bạn là Giám đốc Công nghệ (CTO) và Chuyên gia Đánh giá Quản trị Dự án Phần mềm Cấp cao.
Hãy chấm điểm danh sách Work Breakdown Structure (WBS) dưới đây dựa trên bản đặc tả yêu cầu dự án.

ĐẶC TẢ YÊU CẦU DỰ ÁN:
${inputSpec.taskName}
${inputSpec.description}

DANH SÁCH THÀNH VIÊN VÀ VAI TRÒ:
${JSON.stringify(inputSpec.teamMembers, null, 2)}

DANH SÁCH TASK CẦN ĐÁNH GIÁ (${tasks.length} tasks):
${JSON.stringify(tasks, null, 2)}

TIÊU CHÍ ĐÁNH GIÁ (Thang điểm 10 cho mỗi tiêu chí, Tổng điểm / 50):
1. Technical Depth (Độ sâu kỹ thuật & Anti-CRUD): Task có phân rã sâu vào State Machine, Distributed Lock, Idempotency, Transaction, Architecture không? Hay chỉ là CRUD hời hợt (Thêm, Sửa, Xóa)?
2. Actionability & Acceptance Criteria (Tính khả thi & DoD): Task có checklist nghiệm thu cụ thể (mã lỗi HTTP, unit test, SLA, validation rule) để dev và tester làm việc rõ ràng không?
3. Role & Sprint Sequencing (Phân công & Tiến trình): Các vai trò (Architect, BE, FE, Mobile, QA, DevOps) được giao đúng sở trường chưa? Tiến trình 3 Sprint có hợp lý theo đường găng (Kiến trúc -> Core -> Hardening/Testing/DevOps) không?
4. Resilience, Edge Cases & Security (Ngoại lệ & Bảo mật): Có bao quát xử lý race condition, webhook replay, PCI-DSS tokenization, retry backoff, circuit breaker không?
5. Grounding & Provenance (Nguồn gốc & Tham chiếu): Task có bám sát 100% công nghệ yêu cầu (Stripe, VNPay, Redis, PostgreSQL, Flutter, React) và trích dẫn chuẩn kỹ thuật không?`;

    const res = await ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: {
            responseMimeType: 'application/json',
            responseSchema: RUBRIC_EVALUATION_SCHEMA,
            temperature: 0.1
        }
    });

    return JSON.parse(res.text);
}

// ============================================================================
// 5. THỰC THI THỬ NGHIỆM SO SÁNH (BASELINE vs ENHANCED)
// ============================================================================
async function runComparisonBenchmark() {
    console.log('================================================================');
    console.log('   BẮT ĐẦU CHẠY BENCHMARK: THẨM ĐỊNH & CẢI TIẾN WBS TỰ ĐỘNG     ');
    console.log('================================================================');

    const sprintContext = `
Sprint 1: 2026-11-20 đến 2026-12-03 (Nền tảng, Kiến trúc & Cơ sở dữ liệu)
Sprint 2: 2026-12-04 đến 2026-12-17 (Core Billing Engine, Webhooks & UI Clients)
Sprint 3: 2026-12-18 đến 2026-12-31 (Dunning, Resilience, E2E Testing & Release)
    `;

    // -------------------------------------------------------------
    // Bước 1: Sinh theo prompt cũ (Baseline)
    // -------------------------------------------------------------
    console.log('\n[1/4] Đang sinh WBS theo PROMPT CŨ (Current Baseline)...');
    const oldSystemPrompt = `Bạn là Quản lý dự án phần mềm theo Agile.
Nhiệm vụ của bạn là phân rã công việc thành từ 8 đến 15 task nhỏ khả thi, phân bổ vào các Sprint và giao cho thành viên dựa theo vai trò.
Quy tắc:
- Phân bổ vào 3 Sprint (Sprint đầu: DB/khung; Sprint giữa: chức năng cốt lõi; Sprint cuối: kiểm thử/devops).
- Gán đúng assigneeId và assigneeName.
- Điền startDate và dueDate hợp lệ trong Sprint.`;

    const oldUserPrompt = `Tiêu đề: ${DETAILED_PROJECT_INPUT.taskName}\nMô tả: ${DETAILED_PROJECT_INPUT.description}\nSprint:\n${sprintContext}\nThành viên:\n${JSON.stringify(DETAILED_PROJECT_INPUT.teamMembers)}`;

    const oldGenRes = await ai.models.generateContent({
        model: MODEL,
        contents: oldUserPrompt,
        config: {
            systemInstruction: oldSystemPrompt,
            responseMimeType: 'application/json',
            responseSchema: OLD_TASK_SCHEMA,
            temperature: 0.2
        }
    });
    const oldTasks = JSON.parse(oldGenRes.text);
    console.log(`✓ Baseline sinh thành công ${oldTasks.length} tasks.`);
    console.log(`  Ví dụ Task 1 cũ: "${oldTasks[0]?.title}" -> Mô tả: "${oldTasks[0]?.description?.slice(0, 100)}..."`);

    // Chấm điểm Baseline
    const oldScore = await evaluateTasks(oldTasks, DETAILED_PROJECT_INPUT, 'BASELINE - PROMPT CŨ');

    // -------------------------------------------------------------
    // Bước 2: Sinh theo Quy trình Mới (Generation -> Validate -> Refine)
    // -------------------------------------------------------------
    console.log('\n[2/4] Bắt đầu Quy trình MỚI: AI Sinh -> Thẩm định Phản biện -> Tinh chỉnh (Refinement Loop)...');

    const enhancedSystemPrompt = `Bạn là một Principal Software Architect và Technical Program Director vận hành theo mô hình Clean Architecture & Domain-Driven Design (DDD).
Nhiệm vụ: Phân rã yêu cầu thành 12-16 task KỸ THUẬT CHUYÊN SÂU.

QUY TẮC BẮT BUỘC (ANTI-CRUD & TECHNICAL EXCELLENCE):
1. TUYỆT ĐỐI KHÔNG chia task theo kiểu CRUD hời hợt (Ví dụ cấm: "Tạo API thanh toán", "Làm trang quản trị", "Viết CRUD gói cước").
2. Mỗi task phải tập trung vào một lát cắt kỹ thuật chuyên sâu:
   - Data & State Machine: Thiết kế bảng, index, enum trạng thái, audit trail, concurrency lock.
   - Core Processing: Idempotency filter, HMAC signature check, Stripe SDK webhook ingestion, Proration calculation.
   - Resilience & Integration: Dunning engine, exponential backoff worker, dead-letter queue, email notification worker.
   - Client Engineering: Stripe Elements integration, Payment state machine UI, optimistic updates, offline handling.
   - Testing & Telemetry: Mock payment gateway E2E test, Prometheus business metrics, load test 1000 req/s.
3. Mỗi task BẮT BUỘC có ít nhất 3-5 gạch đầu dòng Acceptance Criteria (DoD) có thể nghiệm thu đo lường được (HTTP Status, mã lỗi, test coverage > 85%, validation rule).
4. Mỗi task phải chỉ rõ Edge Cases (Kịch bản lỗi mạng, Race condition, Webhook tới trễ, Thẻ hết hạn).
5. Phân công đúng vai trò chuyên môn và cân đối đều qua 3 Sprint theo đường găng phát triển.`;

    const initialEnhancedRes = await ai.models.generateContent({
        model: MODEL,
        contents: oldUserPrompt,
        config: {
            systemInstruction: enhancedSystemPrompt,
            responseMimeType: 'application/json',
            responseSchema: ENHANCED_TASK_SCHEMA,
            temperature: 0.2
        }
    });
    let intermediateTasks = JSON.parse(initialEnhancedRes.text);
    console.log(`✓ Bước sinh ban đầu tạo ra ${intermediateTasks.length} tasks kỹ thuật.`);

    // -------------------------------------------------------------
    // Bước 3: Phản biện / Thẩm định (Critique / Grounding Check)
    // -------------------------------------------------------------
    console.log('\n[3/4] Chạy Critic/Validation Agent để rà soát lỗi CRUD và khoảng trống kỹ thuật...');
    const criticPrompt = `
Hãy đóng vai một Tech Lead khó tính rà soát lại danh sách task kỹ thuật sau:
${JSON.stringify(intermediateTasks, null, 2)}

YÊU CẦU KIỂM TRA:
1. Có task nào còn mang tư duy CRUD tầm thường hoặc mô tả chung chung không?
2. Có thiếu sót các yêu cầu cốt lõi trong đặc tả: Idempotency Key Redis, Webhook HMAC-SHA256, Dunning Retry, Mobile Flutter SDK, Prometheus Metric không?
3. Checklist Acceptance Criteria đã đủ cụ thể và đo lường được chưa?

Hãy đưa ra hướng dẫn hiệu chỉnh cụ thể (Actionable feedback) để cải thiện bản WBS lên mức độ hoàn hảo.`;

    const criticRes = await ai.models.generateContent({
        model: MODEL,
        contents: criticPrompt,
        config: { temperature: 0.2 }
    });
    const feedback = criticRes.text;
    console.log(`✓ Critic Agent phản biện:\n${feedback.slice(0, 300)}...`);

    // -------------------------------------------------------------
    // Bước 4: Tinh chỉnh lại danh sách Task (Regenerate / Refine)
    // -------------------------------------------------------------
    console.log('\n[4/4] Tinh chỉnh và tái cấu trúc danh sách Task dựa trên phản biện...');
    const refinePrompt = `
BẢN PHÂN RÃ HIỆN TẠI:
${JSON.stringify(intermediateTasks, null, 2)}

Ý KIẾN PHẢN BIỆN TỪ TECH LEAD:
${feedback}

YÊU CẦU: Hãy áp dụng toàn bộ ý kiến phản biện để hoàn thiện lại danh sách task đạt tiêu chuẩn sản xuất cao nhất. Đảm bảo mọi task đều có checklist DoD xuất sắc, xử lý đầy đủ edge cases và phân bổ tối ưu theo vai trò.`;

    const refinedRes = await ai.models.generateContent({
        model: MODEL,
        contents: refinePrompt,
        config: {
            systemInstruction: enhancedSystemPrompt,
            responseMimeType: 'application/json',
            responseSchema: ENHANCED_TASK_SCHEMA,
            temperature: 0.2
        }
    });
    const finalTasks = JSON.parse(refinedRes.text);
    console.log(`✓ Hoàn thành phiên bản tinh chỉnh với ${finalTasks.length} tasks.`);

    // Chấm điểm Phiên bản Nâng cấp
    const enhancedScore = await evaluateTasks(finalTasks, DETAILED_PROJECT_INPUT, 'ENHANCED - VÒNG LẶP SINH & TINH CHỈNH');

    // -------------------------------------------------------------
    // BÁO CÁO SO SÁNH TRỰC QUAN
    // -------------------------------------------------------------
    console.log('\n================================================================');
    console.log('              KẾT QUẢ SO SÁNH TRỰC QUAN (RUBRIC REPORT)         ');
    console.log('================================================================');
    console.log(`Tiêu chí 1: Technical Depth (Độ sâu kỹ thuật)      | Cũ: ${oldScore.technicalDepthScore}/10  ==> Mới: ${enhancedScore.technicalDepthScore}/10`);
    console.log(`Tiêu chí 2: Actionability & DoD (Tính khả thi & DoD)| Cũ: ${oldScore.actionabilityScore}/10  ==> Mới: ${enhancedScore.actionabilityScore}/10`);
    console.log(`Tiêu chí 3: Role & Sprint Sequencing (Phân công)   | Cũ: ${oldScore.roleAndSprintScore}/10  ==> Mới: ${enhancedScore.roleAndSprintScore}/10`);
    console.log(`Tiêu chí 4: Resilience & Security (Ngoại lệ & Bảo mật)| Cũ: ${oldScore.resilienceSecurityScore}/10  ==> Mới: ${enhancedScore.resilienceSecurityScore}/10`);
    console.log(`Tiêu chí 5: Grounding & Provenance (Bám sát chuẩn)  | Cũ: ${oldScore.groundingScore}/10  ==> Mới: ${enhancedScore.groundingScore}/10`);
    console.log('----------------------------------------------------------------');
    console.log(`TỔNG ĐIỂM (/50):                                     | Cũ: ${oldScore.totalScore}/50 (${oldScore.overallVerdict}) ==> Mới: ${enhancedScore.totalScore}/50 (${enhancedScore.overallVerdict})`);
    console.log('================================================================\n');

    // Hiển thị một ví dụ so sánh trực quan
    console.log('--- VÍ DỤ MINH HỌA SỰ KHÁC BIỆT ---');
    console.log('[BASELINE - BẢN CŨ]:');
    console.log(`- Title: ${oldTasks[0]?.title}`);
    console.log(`- Role: ${oldTasks[0]?.role} | Assignee: ${oldTasks[0]?.assigneeName}`);
    console.log(`- Description: ${oldTasks[0]?.description}`);
    console.log('\n[ENHANCED - BẢN MỚI]:');
    console.log(`- Title: ${finalTasks[0]?.title}`);
    console.log(`- Category: [${finalTasks[0]?.category}] | Role: ${finalTasks[0]?.role} (${finalTasks[0]?.assigneeName})`);
    console.log(`- Description: ${finalTasks[0]?.description}`);
    console.log(`- Deliverables: ${finalTasks[0]?.deliverables}`);
    console.log(`- Acceptance Criteria (DoD):`);
    finalTasks[0]?.acceptanceCriteria?.forEach(ac => console.log(`   * [ ] ${ac}`));
    console.log(`- Edge Cases:`);
    finalTasks[0]?.edgeCases?.forEach(ec => console.log(`   ! ${ec}`));
    console.log('================================================================');
}

runComparisonBenchmark();
