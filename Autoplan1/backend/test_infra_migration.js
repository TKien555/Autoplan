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
// ĐẶC TẢ INPUT: DỰ ÁN BẢO TRÌ HẠ TẦNG & TÁI CẤU TRÚC KIẾN TRÚC DOANH NGHIỆP
// ============================================================================
const INFRA_PROJECT_INPUT = {
    taskName: 'Dự án Bảo trì Hạ tầng, Nâng cấp Cụm Kubernetes K8s & Di chuyển CSDL Zero-Downtime',
    description: `
Dự án bảo trì kỹ thuật, hiện đại hóa hạ tầng và tái cấu trúc cơ sở dữ liệu doanh nghiệp mà KHÔNG ĐƯỢC làm gián đoạn dịch vụ của người dùng (Zero-Downtime Maintenance).

CÁC HẠNG MỤC KỸ THUẬT VÀ QUẢN TRỊ CỐT LÕI:
1. Di chuyển CSDL không gián đoạn (Zero-Downtime Database Migration):
   - Di chuyển 50 triệu bản ghi từ hệ thống CSDL MySQL 5.7 (Monolith cũ) sang PostgreSQL 16 (Tối ưu index, Partitioning).
   - Thiết lập cơ chế Change Data Capture (CDC) sử dụng Debezium & Kafka để đồng bộ dữ liệu thời gian thực giữa 2 CSDL.
   - Cơ chế Dual-write hoặc Shadow traffic để đối soát toàn vẹn dữ liệu (Data Reconciliation) kiểm tra sai lệch 0%.
2. Nâng cấp Cụm Kubernetes (EKS / K8s Upgrade):
   - Nâng cấp cụm Kubernetes từ phiên bản cũ v1.24 lên v1.30 trên môi trường Production.
   - Chuyển đổi toàn bộ Ingress API cũ (v1beta1) sang chuẩn mới Kubernetes Gateway API.
   - Cấu hình Horizontal Pod Autoscaler (HPA) theo CPU/Memory và Custom Prometheus Metrics.
3. Tối ưu Chi phí & Khả năng phục hồi Thảm họa (FinOps & Disaster Recovery - DR):
   - Thiết lập cơ chế sao lưu tự động Multi-AZ / Cross-Region với chỉ tiêu RPO < 5 phút và RTO < 30 phút.
   - Diễn tập sự cố thảm họa (Disaster Recovery Simulation Drill) trên môi trường Staging.
   - Dọn dẹp tài nguyên rác (Orphaned EBS volumes, unattached Elastic IPs, over-provisioned nodes) nhằm giảm 25% chi phí cloud hàng tháng.
4. An ninh mạng & Vá lỗ hổng (Security Hardening & Patching):
   - Vá các lỗ hổng CVE ở tầng hệ điều hành (Base OS AMI) và Container Images.
   - Cập nhật chứng chỉ TLS/SSL, cấu hình Secret Manager và xoay vòng khóa (Secret Key Rotation).
5. Kế hoạch Lùi bước khẩn cấp (Emergency Rollback Runbook):
   - Xây dựng quy trình Rollback đảo ngược (Reverse Sync từ PostgreSQL về lại MySQL) trong vòng 5 phút nếu tỷ lệ lỗi sau cutover vượt quá 0.1%.
    `,
    sprintCount: 3,
    sprintDurationDays: 14,
    sprintPrefix: 'Sprint',
    sprintStartDate: '2026-11-20',
    teamMembers: [
        { id: 'mem_1', fullName: 'Trần Quang Huy', role: 'Principal Enterprise Architect' },
        { id: 'mem_2', fullName: 'Nguyễn Minh Khôi', role: 'Senior Database & Backend Engineer' },
        { id: 'mem_3', fullName: 'Phạm Tuấn Anh', role: 'Lead DevOps / Cloud SRE' },
        { id: 'mem_4', fullName: 'Hoàng Văn Đức', role: 'DevOps / Kubernetes Specialist' },
        { id: 'mem_5', fullName: 'Vũ Thị Mai', role: 'Security & Compliance Auditor' },
        { id: 'mem_6', fullName: 'Bùi Phương Thảo', role: 'QA / Performance & Data Integrity Tester' }
    ]
};

const TASK_ARRAY_SCHEMA = {
    type: 'array',
    description: 'Danh sách các công việc phân rã cho dự án bảo trì hạ tầng và kiến trúc chuẩn PMP',
    items: {
        type: 'object',
        properties: {
            title: { type: 'string', description: 'Tiêu đề công việc kỹ thuật chuyên sâu về bảo trì/hạ tầng/kiến trúc' },
            category: { type: 'string', description: 'Phân loại: Architecture | DatabaseMigration | Kubernetes | DevOps | Security | QA' },
            description: { type: 'string', description: 'Mô tả giải pháp kỹ thuật, công nghệ, quy trình chuyển đổi' },
            acceptanceCriteria: {
                type: 'array',
                items: { type: 'string' },
                description: 'Danh sách tiêu chuẩn nghiệm thu (Definition of Done) đo lường được: RPO, RTO, tỷ lệ sai lệch dữ liệu, downtime, SLA'
            },
            edgeCases: {
                type: 'array',
                items: { type: 'string' },
                description: 'Kịch bản sự cố thảm họa, mất mát dữ liệu, xung đột CDC, lỗi API Kubernetes'
            },
            deliverables: { type: 'string', description: 'Sản phẩm đầu ra cụ thể: Terraform script, Debezium CDC config, Rollback runbook...' },
            role: { type: 'string' },
            assigneeId: { type: 'string', nullable: true },
            assigneeName: { type: 'string' },
            estimatedHours: { type: 'number' },
            sprint: { type: 'string', description: 'Tên Sprint' },
            startDate: { type: 'string' },
            dueDate: { type: 'string' },
            referenceSource: { type: 'string' }
        },
        required: [
            'title', 'category', 'description', 'acceptanceCriteria', 'edgeCases',
            'deliverables', 'role', 'assigneeName', 'estimatedHours', 'sprint',
            'startDate', 'dueDate', 'referenceSource'
        ]
    }
};

async function testInfraMigrationProject() {
    console.log('======================================================================');
    console.log('   KIỂM THỬ DỰ ÁN BẢO TRÌ HẠ TẦNG & TÁI CẤU TRÚC KIẾN TRÚC DOANH NGHIỆP');
    console.log('======================================================================\n');

    const sprintContext = `
Danh sách các Sprint phân kỳ bảo trì & chuyển đổi hạ tầng:
- Tên Sprint: "Sprint 1" | Từ ngày: 2026-11-20 đến ngày: 2026-12-03 (Audit Hiện trạng, Thiết lập Debezium CDC Pipeline & K8s Staging Upgrade)
- Tên Sprint: "Sprint 2" | Từ ngày: 2026-12-04 đến ngày: 2026-12-17 (Đồng bộ ngầm 50 triệu bản ghi, Dual-write Test, Diễn tập Thảm họa DR Drill)
- Tên Sprint: "Sprint 3" | Từ ngày: 2026-12-18 đến ngày: 2026-12-31 (Cutover Zero-Downtime Production, Security Patching & Dọn dẹp FinOps)
    `;

    const teamListText = INFRA_PROJECT_INPUT.teamMembers
        .map(m => `- ID: "${m.id}" | Tên: "${m.fullName}" | Vai trò chuyên môn: "${m.role}"`)
        .join('\n');

    const systemInstruction = `Bạn là một Senior Technical Program Director (PMP / Agile Coach) và Principal Enterprise Cloud Architect.
Nhiệm vụ: Phân rã dự án BẢO TRÌ HẠ TẦNG, DI CHUYỂN DỮ LIỆU & NÂNG CẤP KIẾN TRÚC thành 15-18 task kỹ thuật CHUYÊN SÂU.

QUY TẮC PMP ĐẶC THÙ CHO DỰ ÁN BẢO TRÌ HẠ TẦNG & KIẾN TRÚC:
1. CÂN BẰNG TẢI (RESOURCE LEVELING):
   - Mọi thành viên trong <team_members> PHẢI CÓ TASK trong MỌI SPRINT (Sprint 1, 2, 3), từ 25h đến 45h/sprint. Không ai 0h, không ai quá tải.
2. TIẾN TRÌNH DI CHUYỂN DỮ LIỆU ZERO-DOWNTIME (DATA MIGRATION LIFECYCLE):
   - Sprint 1: Thiết lập đường ống CDC (Debezium + Kafka), schema mapping, audit bảng dữ liệu.
   - Sprint 2: Initial snapshot load 50 triệu records, stream delta changes, chạy shadow traffic đối soát sai lệch dữ liệu (Data Reconciliation 0%).
   - Sprint 3: Switchover/Cutover chính thức ban đêm, kích hoạt Reverse Sync (Postgres -> MySQL phòng rollback), tắt CSDL cũ.
3. TIẾN TRÌNH NÂNG CẤP HẠ TẦNG KUBERNETES & DR:
   - Sprint 1: Nâng cấp Staging K8s v1.30, convert Ingress sang Gateway API, kiểm tra tương thích helm charts.
   - Sprint 2: Thiết lập Multi-Region Backup (RPO < 5p, RTO < 30p), chạy diễn tập thảm họa (Disaster Recovery Simulation).
   - Sprint 3: Nâng cấp Production K8s cluster kiểu Rolling Blue/Green không gián đoạn, cấu hình HPA và FinOps dọn rác giảm 25% chi phí.
4. BẢO MẬT & KIỂM THỬ TOÀN VẸN:
   - Security: Quét CVE, xoay vòng secret, kiểm toán quyền IAM.
   - QA: Kiểm thử tải stress test đối soát 50M records, kiểm tra độ trễ truy vấn trước và sau migration.
5. TIÊU CHÍ NGHIỆM THU (DoD) ĐỊNH LƯỢNG RÕ:
   - Phải có con số cụ thể: RPO, RTO, Tỷ lệ sai lệch dữ liệu = 0%, Thời gian cutover, Tỷ lệ giảm chi phí.`;

    const userPrompt = `<user_input>
Tiêu đề công việc: ${INFRA_PROJECT_INPUT.taskName}
Mô tả chi tiết: ${INFRA_PROJECT_INPUT.description}
</user_input>

<sprint_context>
${sprintContext}
</sprint_context>

<team_members>
${teamListText}
</team_members>`;

    console.log(`Đang gọi AI (${MODEL}) sinh WBS cho dự án bảo trì hạ tầng...`);
    const t0 = Date.now();
    const res = await ai.models.generateContent({
        model: MODEL,
        contents: userPrompt,
        config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: TASK_ARRAY_SCHEMA,
            temperature: 0.2
        }
    });
    console.log(`✓ Phân rã thành công trong ${Date.now() - t0}ms.`);
    const tasks = JSON.parse(res.text);

    console.log(`Tổng số task sinh ra: ${tasks.length}`);

    // In Ma trận nhân sự
    console.log('\n======================================================================');
    console.log('              MA TRẬN CÂN BẰNG TẢI NHÂN SỰ (CAPACITY MATRIX)           ');
    console.log('======================================================================');
    const matrix = {};
    INFRA_PROJECT_INPUT.teamMembers.forEach(m => {
        matrix[m.fullName] = { role: m.role, 'Sprint 1': 0, 'Sprint 2': 0, 'Sprint 3': 0, total: 0 };
    });

    tasks.forEach(t => {
        const m = INFRA_PROJECT_INPUT.teamMembers.find(x => x.id === t.assigneeId || x.fullName === t.assigneeName);
        const name = m ? m.fullName : t.assigneeName;
        if (!matrix[name]) matrix[name] = { role: t.role, 'Sprint 1': 0, 'Sprint 2': 0, 'Sprint 3': 0, total: 0 };
        ['Sprint 1', 'Sprint 2', 'Sprint 3'].forEach(sp => {
            if (t.sprint?.toLowerCase().includes(sp.toLowerCase())) {
                matrix[name][sp] += Number(t.estimatedHours) || 0;
                matrix[name].total += Number(t.estimatedHours) || 0;
            }
        });
    });

    console.log('| Họ tên thành viên      | Vai trò               | Sprint 1 | Sprint 2 | Sprint 3 | Tổng giờ | Đánh giá PMP |');
    console.log('|:-----------------------|:----------------------|:--------:|:--------:|:--------:|:--------:|:-------------|');
    for (const [name, data] of Object.entries(matrix)) {
        const hasZero = data['Sprint 1'] === 0 || data['Sprint 2'] === 0 || data['Sprint 3'] === 0;
        const status = hasZero ? '⚠️ LỆCH TẢI' : '✅ CÂN BẰNG TỐT';
        console.log(`| ${name.padEnd(23)} | ${data.role.slice(0, 21).padEnd(21)} | ${String(data['Sprint 1'] + 'h').padEnd(8)} | ${String(data['Sprint 2'] + 'h').padEnd(8)} | ${String(data['Sprint 3'] + 'h').padEnd(8)} | ${String(data.total + 'h').padEnd(8)} | ${status} |`);
    }

    // In tóm tắt các tasks của từng Sprint
    ['Sprint 1', 'Sprint 2', 'Sprint 3'].forEach(sp => {
        const spTasks = tasks.filter(t => t.sprint?.toLowerCase().includes(sp.toLowerCase()));
        console.log(`\n======================================================================`);
        console.log(`                   ${sp.toUpperCase()} (${spTasks.length} TASKS)`);
        console.log(`======================================================================`);
        spTasks.forEach((t, i) => {
            console.log(`\n📌 Task #${i + 1}: ${t.title}`);
            console.log(`🏷️  [${t.category}] | ⏱️  ${t.estimatedHours}h | 👤 ${t.assigneeName} (${t.role})`);
            console.log(`📦 Đầu ra: ${t.deliverables}`);
            console.log(`📝 Giải pháp: ${t.description.slice(0, 180)}...`);
            console.log(`✅ Tiêu chuẩn nghiệm thu (DoD):`);
            t.acceptanceCriteria?.slice(0, 3).forEach(ac => console.log(`   [ ] ${ac}`));
            console.log(`⚠️ Ca biên:`);
            t.edgeCases?.slice(0, 2).forEach(ec => console.log(`   ! ${ec}`));
        });
    });
}

testInfraMigrationProject();
