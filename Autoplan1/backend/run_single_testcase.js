import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
const MODEL = (process.env.GEN_MODELS || 'gemini-3.5-flash-lite').split(',')[0].trim();

// ============================================================================
// 1. ĐẶC TẢ INPUT TEST CASE: HỆ THỐNG ĐẶT VÉ & GIỮ GHẾ THỜI GIAN THỰC
// ============================================================================
const TEST_PROJECT_INPUT = {
    taskName: 'Xây dựng Hệ thống Đặt vé & Giữ ghế Xem phim Thời gian thực (Real-time Cinema Seat Reservation)',
    description: `
Hệ thống bán vé trực tuyến phục vụ chuỗi rạp chiếu phim với lưu lượng cao (Flash-sales / Bom tấn công chiếu).

CÁC YÊU CẦU KỸ THUẬT VÀ NGHIỆP VỤ BẮT BUỘC:
1. Giữ ghế thời gian thực (Real-time Seat Locking):
   - Khi người dùng chọn ghế, khóa tạm thời (Hold lock) trong 10 phút sử dụng Redis Distributed Lock (Redlock algorithm).
   - Đồng bộ tức thì trạng thái ghế đang giữ sang toàn bộ các client khác đang mở cùng phòng chiếu qua WebSocket / Server-Sent Events (SSE).
   - Tự động nhả ghế (Auto-release / TTL expiration) sau 10 phút nếu người dùng chưa hoàn tất thanh toán.
2. Quản lý Đặt chỗ & Ngăn chặn Race Condition:
   - Đảm bảo tính toàn vẹn (ACID): Tuyệt đối không cho phép 2 khách hàng thanh toán cùng một ghế ở cùng một suất chiếu (Zero Double-Booking).
   - Sử dụng PostgreSQL Row-Level Lock hoặc Optimistic Concurrency Control (OCC) với versioning.
3. Thanh toán & Webhook tích hợp:
   - Tích hợp Cổng thanh toán VNPay (QR Code) và MoMo.
   - Xử lý Idempotency Key cho Webhook thanh toán để tránh cộng vé trùng lặp khi cổng gửi webhook retry.
   - Cơ chế Auto-Refund (Saga Pattern) nếu thanh toán thành công nhưng webhook về trễ sau khi vé đã bị nhả do hết hạn TTL 10 phút.
4. Xuất vé Điện tử (E-Ticket) & Check-in QR:
   - Tự động sinh mã vé bảo mật kèm QR Code có chữ ký HMAC chống làm giả.
   - Hỗ trợ gửi vé qua Email (SendGrid) và SMS (Twilio/Brandname).
5. Trải nghiệm Người dùng (Web React & Mobile Flutter):
   - Sơ đồ ghế động (Interactive SVG Seatmap) mượt mà 60fps trên cả Mobile và Web.
   - Đồng hồ đếm ngược giữ ghế (Countdown timer 10:00) có cảnh báo rung/âm thanh khi còn 1 phút.
6. Hạ tầng & Khả năng chịu tải:
   - Chịu tải tối thiểu 2,500 req/s lúc mở bán vé bom tấn.
   - Triển khai Redis Cluster, PostgreSQL Connection Pooling (PgBouncer), và hệ thống đo lường Prometheus/Grafana.
    `,
    sprintCount: 3,
    sprintDurationDays: 14,
    sprintPrefix: 'Sprint',
    sprintStartDate: '2026-11-20',
    teamMembers: [
        { id: 'mem_1', fullName: 'Trần Quang Huy', role: 'Solution Architect / Tech Lead' },
        { id: 'mem_2', fullName: 'Nguyễn Minh Khôi', role: 'Senior Backend Developer (Node.js/PostgreSQL/Redis)' },
        { id: 'mem_3', fullName: 'Đặng Thu Hà', role: 'Frontend React Developer' },
        { id: 'mem_4', fullName: 'Vũ Hoàng Long', role: 'Mobile Flutter Developer' },
        { id: 'mem_5', fullName: 'Bùi Phương Thảo', role: 'QA / Automation & Performance Tester' },
        { id: 'mem_6', fullName: 'Phạm Tuấn Anh', role: 'DevOps / SRE Engineer' }
    ]
};

const TASK_ARRAY_SCHEMA = {
    type: 'array',
    description: 'Danh sách các công việc kỹ thuật chuyên sâu (WBS) chuẩn Senior Project Manager (PMP) với cân bằng tải và phân kỳ hoàn chỉnh',
    items: {
        type: 'object',
        properties: {
            title: { type: 'string', description: 'Tiêu đề công việc kỹ thuật cụ thể, phản ánh giải pháp kiến trúc' },
            category: { type: 'string', description: 'Phân loại: Architecture | Backend | Frontend | Mobile | Security | DevOps | QA' },
            description: { type: 'string', description: 'Mô tả giải pháp kỹ thuật, công nghệ, kiến trúc và luồng xử lý dữ liệu' },
            acceptanceCriteria: {
                type: 'array',
                items: { type: 'string' },
                description: 'Danh sách tiêu chuẩn nghiệm thu (Definition of Done) đo lường được: HTTP code, test coverage, validation, SLA'
            },
            edgeCases: {
                type: 'array',
                items: { type: 'string' },
                description: 'Các ca biên, kịch bản lỗi mạng, race condition, timeout, bảo mật cần xử lý'
            },
            deliverables: { type: 'string', description: 'Sản phẩm đầu ra cụ thể: PR, migration script, test suite, OpenAPI spec...' },
            role: { type: 'string' },
            assigneeId: { type: 'string', nullable: true },
            assigneeName: { type: 'string' },
            estimatedHours: { type: 'number' },
            sprint: { type: 'string', description: 'Tên Sprint đúng theo danh sách trong <sprint_context>' },
            startDate: { type: 'string', description: 'Ngày bắt đầu YYYY-MM-DD' },
            dueDate: { type: 'string', description: 'Hạn hoàn thành YYYY-MM-DD' },
            referenceSource: { type: 'string' }
        },
        required: [
            'title', 'category', 'description', 'acceptanceCriteria', 'edgeCases',
            'deliverables', 'role', 'assigneeName', 'estimatedHours', 'sprint',
            'startDate', 'dueDate', 'referenceSource'
        ]
    }
};

async function executePmpTestCase() {
    console.log('======================================================================');
    console.log('   CHẠY KIỂM THỬ WBS: CHUẨN SENIOR PROJECT MANAGER (PMP GOVERNANCE)   ');
    console.log('======================================================================\n');
    console.log(`Dự án: ${TEST_PROJECT_INPUT.taskName}`);
    console.log(`Đội ngũ: ${TEST_PROJECT_INPUT.teamMembers.length} thành viên | 3 Sprints (6 tuần)\n`);

    const sprintContext = `
Danh sách các Sprint cần phân bổ:
- Tên Sprint: "Sprint 1" | Từ ngày: 2026-11-20 đến ngày: 2026-12-03 (Khởi động, Hạ tầng Dev, Khóa ghế Redis & Khung kiểm thử)
- Tên Sprint: "Sprint 2" | Từ ngày: 2026-12-04 đến ngày: 2026-12-17 (WebSocket Realtime, Sơ đồ ghế SVG, Cổng thanh toán & Stress Test k6)
- Tên Sprint: "Sprint 3" | Từ ngày: 2026-12-18 đến ngày: 2026-12-31 (Check-in QR, Nộp duyệt App Store, UAT Sign-off & Production HA)
    `;

    const teamListText = TEST_PROJECT_INPUT.teamMembers
        .map(m => `- ID: "${m.id}" | Tên: "${m.fullName}" | Vai trò chuyên môn: "${m.role}"`)
        .join('\n');

    // SYSTEM INSTRUCTION NÂNG CẤP VỚI BỘ QUY TẮC PMP THỰC CHIẾN
    const pmpSystemInstruction = `Bạn là một Senior Technical Program Director (PMP / Agile Coach) và Principal Enterprise Architect.
Nhiệm vụ của bạn là phân rã công việc thành từ 15 đến 18 task kỹ thuật và quản trị CHUYÊN SÂU, PHÂN BỔ HOÀN HẢO THEO CHUẨN PMP vào 3 Sprint.

BỘ NGUYÊN TẮC QUẢN TRỊ DỰ ÁN (PMP GOVERNANCE RULES) - BẮT BUỘC:

1. QUY TẮC CÂN BẰNG TẢI NHÂN SỰ (RESOURCE LEVELING & CAPACITY SMOOTHING):
   - MỌI thành viên trong <team_members> BẮT BUỘC PHẢI CÓ TASK trong MỌI SPRINT (Sprint 1, Sprint 2 và Sprint 3).
   - TUYỆT ĐỐI KHÔNG ĐƯỢC để bất kỳ thành viên nào nhận 0 giờ trong một Sprint.
   - Tổng số giờ ước tính của mỗi thành viên trong 1 Sprint phải nằm trong ngưỡng an toàn: từ 20 giờ đến tối đa 50 giờ (tránh quá tải >60h).

2. PHÂN KỲ VÒNG ĐỜI DEVOPS CHUẨN THỰC TẾ (DEVOPS PROGRESSIVE ROLLOUT):
   - Sprint 1: Dựng CI/CD Pipeline tự động, Docker Compose Local, môi trường Staging/Dev cho PostgreSQL và Redis để Dev tích hợp ngay từ tuần đầu.
   - Sprint 2: Thiết lập Logging tập trung (Loki/ELK), cấu hình Nginx/SSL, hỗ trợ scale WebSocket cluster trên Staging.
   - Sprint 3: Cấu hình Production High-Availability (Redis Cluster Failover, PgBouncer Connection Pooling), hệ thống cảnh báo Prometheus/Grafana, và xây dựng Cutover/Rollback Runbook.

3. PHÂN KỲ VÒNG ĐỜI QA CHUẨN THỰC TẾ (QA PROGRESSIVE VALIDATION):
   - Sprint 1: Phân tích Test Scenarios, xây dựng Test Matrix cho các ca biên & Concurrency, dựng Automation Framework (Playwright/Jest).
   - Sprint 2: Integration Testing cho Payment/WebSocket, viết kịch bản Early Stress Test k6 (2,500 req/s) kiểm tra Zero Double-Booking.
   - Sprint 3: E2E Regression Cross-Platform, Hỗ trợ nghiệm thu UAT với Business, Audit bảo mật và ký Biên bản Nghiệm thu Kỹ thuật (Sign-off).

4. QUẢN TRỊ BÀN GIAO & ĐÓNG GÓI SẢN PHẨM (RELEASE GATEKEEPING):
   - Mobile: Phải có task chuẩn bị hồ sơ và nộp duyệt App Store / Google Play trước ngày 2026-12-25 (dự phòng 3-5 ngày chờ duyệt).
   - Frontend: Sprint 3 phải có task hoàn thiện màn hình Lịch sử vé, UI Polish, và Fix bug phát sinh từ UAT.
   - Tech Lead/Architect: Sprint 1 (Kiến trúc & CSDL), Sprint 2 (Code Review & Tối ưu luồng Saga/Idempotency), Sprint 3 (Security Audit & Trực chiến Golive).

5. MỖI TASK BẮT BUỘC CÓ:
   - Tiêu chuẩn nghiệm thu (DoD) định lượng rõ ràng.
   - Ca biên & Rủi ro (Edge Cases).
   - Sản phẩm đầu ra cụ thể (Deliverables).`;

    const userPrompt = `<user_input>
Tiêu đề công việc: ${TEST_PROJECT_INPUT.taskName}
Mô tả chi tiết: ${TEST_PROJECT_INPUT.description}
</user_input>

<sprint_context>
${sprintContext}
</sprint_context>

<team_members>
${teamListText}
</team_members>`;

    // BƯỚC 1: SINH WBS ĐỢT 1 VỚI QUY TẮC PMP
    console.log(`[BƯỚC 1/3] Đang gọi AI (${MODEL}) sinh WBS chuẩn PMP với cơ chế Resource Leveling...`);
    const t0 = Date.now();
    const res1 = await ai.models.generateContent({
        model: MODEL,
        contents: userPrompt,
        config: {
            systemInstruction: pmpSystemInstruction,
            responseMimeType: 'application/json',
            responseSchema: TASK_ARRAY_SCHEMA,
            temperature: 0.2
        }
    });
    console.log(`✓ Bước 1 hoàn thành trong ${Date.now() - t0}ms.`);
    const draftTasks = JSON.parse(res1.text);

    // BƯỚC 2: PHẢN BIỆN TỪ PMP AUDITOR
    console.log('\n[BƯỚC 2/3] Kích hoạt PMP Auditor rà soát ma trận nhân sự và tiến độ bàn giao...');
    const criticPrompt = `Hãy đóng vai Giám đốc Quản lý Dự án (PMO Director) kiểm tra danh sách WBS:
${JSON.stringify(draftTasks, null, 2)}

Kiểm tra nghiêm ngặt:
1. Có thành viên nào trong 6 người bị 0 giờ trong bất kỳ Sprint nào không?
2. DevOps và QA đã phân bổ việc đều qua cả 3 Sprint chưa?
3. Có task nộp App Store trước 2026-12-25 và task UAT Sign-off chưa?
Hãy đưa ra nhận xét ngắn gọn 3-4 câu để hoàn thiện.`;

    const criticRes = await ai.models.generateContent({
        model: MODEL,
        contents: criticPrompt,
        config: { temperature: 0.2 }
    });
    const critiqueText = criticRes.text;
    console.log(`✓ Nhận xét từ PMO Director:\n"${critiqueText.trim()}"`);

    // BƯỚC 3: TINH CHỈNH HOÀN HẢO
    console.log('\n[BƯỚC 3/3] Tinh chỉnh phiên bản WBS chuẩn Senior PMP...');
    const refinePrompt = `BẢN WBS HIỆN TẠI:
${JSON.stringify(draftTasks, null, 2)}

Ý KIẾN TỪ PMO DIRECTOR:
${critiqueText}

YÊU CẦU: Hãy áp dụng toàn bộ ý kiến để hoàn thiện bản WBS đạt chuẩn PMP tuyệt đối (100% thành viên có việc trong cả 3 Sprint, cân bằng tải hoàn hảo, đầy đủ UAT và Release).`;

    const refinedRes = await ai.models.generateContent({
        model: MODEL,
        contents: refinePrompt,
        config: {
            systemInstruction: pmpSystemInstruction,
            responseMimeType: 'application/json',
            responseSchema: TASK_ARRAY_SCHEMA,
            temperature: 0.2
        }
    });
    const finalTasks = JSON.parse(refinedRes.text);
    console.log(`✓ Hoàn tất tinh chỉnh! Tổng số tasks: ${finalTasks.length}\n`);

    // PHÂN TÍCH MA TRẬN PHÂN BỔ NHÂN SỰ THEO CHUẨN PMP
    console.log('======================================================================');
    console.log('              MA TRẬN CÂN BẰNG TẢI NHÂN SỰ (CAPACITY MATRIX)           ');
    console.log('======================================================================');

    const members = TEST_PROJECT_INPUT.teamMembers;
    const sprints = ['Sprint 1', 'Sprint 2', 'Sprint 3'];

    const matrix = {};
    members.forEach(m => {
        matrix[m.fullName] = { role: m.role, 'Sprint 1': 0, 'Sprint 2': 0, 'Sprint 3': 0, total: 0 };
    });

    finalTasks.forEach(t => {
        const m = members.find(x => x.id === t.assigneeId || x.fullName === t.assigneeName);
        const name = m ? m.fullName : t.assigneeName;
        if (!matrix[name]) matrix[name] = { role: t.role, 'Sprint 1': 0, 'Sprint 2': 0, 'Sprint 3': 0, total: 0 };

        for (const sp of sprints) {
            if (t.sprint?.toLowerCase().includes(sp.toLowerCase())) {
                matrix[name][sp] += Number(t.estimatedHours) || 0;
                matrix[name].total += Number(t.estimatedHours) || 0;
            }
        }
    });

    console.log('| Họ tên thành viên      | Vai trò               | Sprint 1 | Sprint 2 | Sprint 3 | Tổng giờ | Đánh giá PMP |');
    console.log('|:-----------------------|:----------------------|:--------:|:--------:|:--------:|:--------:|:-------------|');
    for (const [name, data] of Object.entries(matrix)) {
        const hasZero = data['Sprint 1'] === 0 || data['Sprint 2'] === 0 || data['Sprint 3'] === 0;
        const status = hasZero ? '⚠️ LỆCH TẢI' : '✅ CÂN BẰNG TỐT';
        console.log(`| ${name.padEnd(23)} | ${data.role.slice(0, 21).padEnd(21)} | ${String(data['Sprint 1'] + 'h').padEnd(8)} | ${String(data['Sprint 2'] + 'h').padEnd(8)} | ${String(data['Sprint 3'] + 'h').padEnd(8)} | ${String(data.total + 'h').padEnd(8)} | ${status} |`);
    }

    // IN DANH SÁCH CHI TIẾT
    console.log('\n======================================================================');
    console.log('               DANH SÁCH TASK CHI TIẾT TỪNG SPRINT (PMP STANDARD)     ');
    console.log('======================================================================\n');

    for (const sp of sprints) {
        const spTasks = finalTasks.filter(t => t.sprint?.toLowerCase().includes(sp.toLowerCase()));
        console.log(`\n######################################################################`);
        console.log(`                     ${sp.toUpperCase()} (${spTasks.length} TASKS)`);
        console.log(`######################################################################\n`);

        spTasks.forEach((t, i) => {
            console.log(`----------------------------------------------------------------------`);
            console.log(`📌 Task #${i + 1}: ${t.title}`);
            console.log(`🏷️  Phân loại: [${t.category}] | ⏱️  Thời lượng: ${t.estimatedHours}h | 📅 ${t.startDate} -> ${t.dueDate}`);
            console.log(`👤 Phụ trách: ${t.assigneeName} (${t.role})`);
            console.log(`📦 Sản phẩm đầu ra: ${t.deliverables}`);
            console.log(`✅ Tiêu chuẩn nghiệm thu (DoD):`);
            t.acceptanceCriteria?.forEach(ac => console.log(`   [ ] ${ac}`));
            console.log(`⚠️ Ca biên & Kịch bản lỗi:`);
            t.edgeCases?.forEach(ec => console.log(`   ! ${ec}`));
            console.log('');
        });
    }
}

executePmpTestCase();
