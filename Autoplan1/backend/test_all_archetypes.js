import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
const MODELS = (process.env.GEN_MODELS || 'gemini-3.5-flash-lite,gemini-2.5-flash,gemini-3.8-flash')
    .split(',')
    .map(m => m.trim())
    .filter(Boolean);

async function callWithFallback(userPrompt, systemInstruction, schema) {
    let lastErr = null;
    for (const model of MODELS) {
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                const res = await ai.models.generateContent({
                    model,
                    contents: userPrompt,
                    config: {
                        systemInstruction,
                        responseMimeType: 'application/json',
                        responseSchema: schema,
                        temperature: 0.2
                    }
                });
                return { text: res.text, model };
            } catch (err) {
                lastErr = err;
                if (err.status === 503 || err.message?.includes('503') || err.message?.includes('demand')) {
                    console.log(`  ⚠️ Model [${model}] thử lần ${attempt} gặp 503, chờ 1s...`);
                    await new Promise(r => setTimeout(r, 1200));
                } else {
                    break;
                }
            }
        }
    }
    throw lastErr || new Error('All models failed');
}

// 7 DẠNG BÀI TOÁN
const ARCHETYPES_TO_TEST = [
    {
        typeId: 'ARCH_2_BROWNFIELD',
        name: 'Dạng 2: Brownfield / Mở rộng Tính năng (E-Commerce BNPL & Loyalty)',
        input: {
            taskName: 'Mở rộng Hệ thống E-Commerce: Tích hợp Mua trước Trả sau (BNPL) & Hệ thống Tích điểm Loyalty',
            description: `Hệ thống E-Commerce đang chạy có 1M DAU. Bổ sung phương thức thanh toán BNPL (Fundiin, Kredivo) và Loyalty Points.
Yêu cầu:
- Tương thích ngược (Backward compatibility) 100% với luồng Checkout hiện tại.
- Áp dụng Feature Flag (LaunchDarkly) để rollout dần từ 5% -> 25% -> 100%.
- API Versioning: Cung cấp API Checkout v2 trong khi duy trì v1 cho các client cũ.
- Regression testing toàn diện cho toàn bộ giỏ hàng và đơn hàng cũ.`,
            sprintCount: 3,
            teamMembers: [
                { id: 'm1', fullName: 'Trần Quang Huy', role: 'Solution Architect / Tech Lead' },
                { id: 'm2', fullName: 'Nguyễn Minh Khôi', role: 'Senior Backend Developer' },
                { id: 'm3', fullName: 'Đặng Thu Hà', role: 'Frontend React Developer' },
                { id: 'm4', fullName: 'Vũ Hoàng Long', role: 'Mobile Flutter Developer' },
                { id: 'm5', fullName: 'Bùi Phương Thảo', role: 'QA / Regression & Automation Tester' },
                { id: 'm6', fullName: 'Phạm Tuấn Anh', role: 'DevOps / Release Engineer' }
            ]
        }
    },
    {
        typeId: 'ARCH_4_SRE_FINOPS',
        name: 'Dạng 4: Tối ưu Hạ tầng, Hiệu năng SRE & FinOps (AWS High Load & Cost Down)',
        input: {
            taskName: 'Tối ưu Hóa Hiệu năng Hệ thống & Giảm 30% Chi phí Cloud AWS (SRE & FinOps Overhaul)',
            description: `Hệ thống chịu tải Black Friday kém và chi phí AWS quá cao ($45,000/tháng).
Yêu cầu:
- Giảm độ trễ P99 từ 1.8s xuống dưới 120ms cho 10,000 req/s.
- Tối ưu hóa Database query, index và thiết lập cụm Redis Enterprise Cache (Cache-aside + Write-through).
- Giảm 30% chi phí Cloud bằng FinOps: Chuyển đổi EC2 On-Demand sang Spot/Savings Plans, dọn dẹp Orphaned Snapshots/EBS, tối ưu CloudWatch retention.
- Nâng cao năng lực giám sát với Prometheus, Grafana, OpenTelemetry distributed tracing.`,
            sprintCount: 3,
            teamMembers: [
                { id: 'm1', fullName: 'Phạm Tuấn Anh', role: 'Lead DevOps / Cloud SRE' },
                { id: 'm2', fullName: 'Nguyễn Minh Khôi', role: 'Senior Database & Backend Engineer' },
                { id: 'm3', fullName: 'Hoàng Văn Đức', role: 'Cloud Infrastructure & FinOps Engineer' },
                { id: 'm4', fullName: 'Bùi Phương Thảo', role: 'QA / Performance & Stress Tester' }
            ]
        }
    },
    {
        typeId: 'ARCH_5_SECURITY',
        name: 'Dạng 5: Bảo mật & Tuân thủ Tiêu chuẩn (PCI-DSS Level 1 & SOC 2 Type II)',
        input: {
            taskName: 'Kiểm toán & Đạt Chứng chỉ An toàn Thông tin Quốc tế PCI-DSS Level 1 & SOC 2',
            description: `Chuẩn bị hạ tầng và hệ thống để vượt qua kỳ kiểm toán độc lập PCI-DSS v4.0 và SOC 2 Type II trong 6 tuần.
Yêu cầu:
- Mã hóa toàn bộ dữ liệu nhạy cảm (PAN, PII) ở trạng thái lưu trữ (At-rest AES-256) và truyền tải (TLS 1.3).
- Cấu hình AWS KMS Envelope Encryption và thiết lập Secret Rotation định kỳ 30 ngày.
- Thiết lập hệ thống SIEM (Splunk/Wazuh) thu thập log bất biến (Immutable Audit Logs) không thể chỉnh sửa.
- Vá 100% lỗ hổng bảo mật CVE mức High/Critical và vượt qua bài kiểm tra Penetration Testing của đơn vị độc lập.`,
            sprintCount: 3,
            teamMembers: [
                { id: 'm1', fullName: 'Trần Quang Huy', role: 'Chief Information Security Officer (CISO) / Lead' },
                { id: 'm2', fullName: 'Vũ Thị Mai', role: 'Security & Compliance Auditor' },
                { id: 'm3', fullName: 'Phạm Tuấn Anh', role: 'DevSecOps Engineer' },
                { id: 'm4', fullName: 'Nguyễn Minh Khôi', role: 'Senior Backend Security Engineer' }
            ]
        }
    },
    {
        typeId: 'ARCH_6_AI_RAG',
        name: 'Dạng 6: R&D / AI Agent & RAG Pipeline (Enterprise Multi-Source Search & Chatbot)',
        input: {
            taskName: 'Nghiên cứu & Triển khai Trợ lý AI Hỗ trợ Doanh nghiệp (Enterprise AI Agent & RAG Pipeline)',
            description: `Xây dựng giải pháp AI Agent trả lời nghiệp vụ từ tài liệu nội bộ (PDF, Confluence, Jira).
Yêu cầu:
- Xây dựng luồng RAG kết hợp Hybrid Search (Dense Embedding với gemini-embedding + Sparse BM25) và Cross-Encoder Reranking.
- Đánh giá chất lượng sinh nội dung dựa trên bộ tiêu chí RAG Triad (Context Relevance, Groundedness, Answer Relevance).
- Đảm bảo độ trễ phản hồi (Time-to-first-token) dưới 800ms và tổng thời gian trả lời dưới 3s.
- Thử nghiệm A/B Testing với 50 nhân viên nội bộ trước khi mở rộng.`,
            sprintCount: 3,
            teamMembers: [
                { id: 'm1', fullName: 'Trần Quang Huy', role: 'AI Solution Architect / Tech Lead' },
                { id: 'm2', fullName: 'Nguyễn Minh Khôi', role: 'Senior AI / Data Pipeline Engineer' },
                { id: 'm3', fullName: 'Đặng Thu Hà', role: 'Frontend Chat UI & Streaming Developer' },
                { id: 'm4', fullName: 'Bùi Phương Thảo', role: 'QA / AI Evaluation & Benchmark Specialist' }
            ]
        }
    },
    {
        typeId: 'ARCH_7_INCIDENT',
        name: 'Dạng 7: Xử lý Sự cố Khẩn cấp, Tái cấu trúc Phòng vệ & Post-Mortem',
        input: {
            taskName: 'Chiến dịch Khắc phục Sự cố Rò rỉ Bộ nhớ & Tắc nghẽn Giao dịch Ngân hàng (Incident Remediation & Hardening)',
            description: `Hệ thống giao dịch tài chính vừa bị sập 45 phút do Memory Leak và Connection Pool Exhaustion.
Yêu cầu:
- Khắc phục khẩn cấp: Tái hiện lỗi trên Staging, phân tích Heap Memory Snapshot và slow query logs, phát hành Hotfix Patch trong 24-48 giờ.
- Tái cấu trúc phòng vệ: Triển khai Circuit Breaker (Resilience4j / Opossum), Dead-Letter Queue (DLQ) và Rate Limiting chống sập dây chuyền (Cascading Failure).
- Khôi phục chỉ số MTTR (Mean Time to Recovery) dưới 15 phút.
- Hoàn thiện tài liệu Báo cáo Sự cố (Post-Mortem Report) và diễn tập phòng chống thảm họa tái phát.`,
            sprintCount: 3,
            teamMembers: [
                { id: 'm1', fullName: 'Trần Quang Huy', role: 'Incident Commander / Principal Architect' },
                { id: 'm2', fullName: 'Nguyễn Minh Khôi', role: 'Senior Backend Core Engineer' },
                { id: 'm3', fullName: 'Phạm Tuấn Anh', role: 'Lead SRE / On-call Specialist' },
                { id: 'm4', fullName: 'Bùi Phương Thảo', role: 'QA / Chaos & Stress Testing Engineer' }
            ]
        }
    }
];

const TASK_ARRAY_SCHEMA = {
    type: 'array',
    items: {
        type: 'object',
        properties: {
            title: { type: 'string' },
            category: { type: 'string' },
            description: { type: 'string' },
            acceptanceCriteria: { type: 'array', items: { type: 'string' } },
            edgeCases: { type: 'array', items: { type: 'string' } },
            deliverables: { type: 'string' },
            role: { type: 'string' },
            assigneeName: { type: 'string' },
            estimatedHours: { type: 'number' },
            sprint: { type: 'string' },
            startDate: { type: 'string' },
            dueDate: { type: 'string' }
        },
        required: [
            'title', 'category', 'description', 'acceptanceCriteria', 'edgeCases',
            'deliverables', 'role', 'assigneeName', 'estimatedHours', 'sprint',
            'startDate', 'dueDate'
        ]
    }
};

async function runArchetypeAudit() {
    console.log('======================================================================');
    console.log('   KIỂM THỬ ĐỘ CHÍNH XÁC & ĐÁNH GIÁ 5 DẠNG BÀI TOÁN WBS CÒN LẠI      ');
    console.log('======================================================================\n');

    const auditReports = [];

    for (let i = 0; i < ARCHETYPES_TO_TEST.length; i++) {
        const arch = ARCHETYPES_TO_TEST[i];
        console.log(`\n>>> [${i + 1}/5] KIỂM THỬ: ${arch.name}`);

        const teamList = arch.input.teamMembers
            .map(m => `- Tên: "${m.fullName}" | Vai trò: "${m.role}"`)
            .join('\n');

        const sprintContext = `
Sprint 1: 2026-11-20 đến 2026-12-03 (Phân tích, Chuẩn bị nền tảng & Khung kỹ thuật)
Sprint 2: 2026-12-04 đến 2026-12-17 (Thực thi chuyên sâu, Tích hợp & Kiểm thử tải/đối soát)
Sprint 3: 2026-12-18 đến 2026-12-31 (Triển khai Production, Nghiệm thu UAT/Audit, Sổ tay vận hành)
        `;

        const systemInstruction = `Bạn là Senior Technical Program Director (PMP / Agile Coach) và Enterprise Architect.
Nhiệm vụ: Phân rã dự án "${arch.name}" thành WBS chuẩn PMP.

QUY TẮC BẮT BUỘC:
1. CÂN BẰNG TẢI (RESOURCE LEVELING): Mọi thành viên trong danh sách PHẢI CÓ TASK trong MỌI SPRINT (Sprint 1, 2, 3), từ 25h đến 45h/sprint. Tuyệt đối không ai 0h.
2. ĐÚNG CHUYÊN MÔN DẠNG BÀI:
   - Dạng 2 (Brownfield): Phải có Impact Analysis, Feature Flag v1/v2, Full Regression.
   - Dạng 4 (FinOps/SRE): Tập trung Profiling, Query Indexing, Redis Cache, FinOps dọn rác giảm 30% cost, OpenTelemetry. Không sinh task Web/Mobile nếu không có role đó.
   - Dạng 5 (Security): Tập trung KMS Envelope Encryption, Secret Rotation, Immutable SIEM Log, CVE Patching, Penetration Testing.
   - Dạng 6 (AI/RAG): Tập trung Hybrid Search (Dense+BM25), Reranking, Đánh giá RAG Triad, Streaming, A/B Testing.
   - Dạng 7 (Incident): Tập trung Heap Snapshot, Hotfix Patch, Circuit Breaker, MTTR < 15p, Post-Mortem.
3. TIÊU CHÍ NGHIỆM THU (DoD): Đo lường định lượng rõ ràng.`;

        const userPrompt = `DỰ ÁN: ${arch.input.taskName}
MÔ TẢ KỸ THUẬT: ${arch.input.description}
THÀNH VIÊN:
${teamList}
TIẾN TRÌNH:
${sprintContext}`;

        try {
            const start = Date.now();
            const { text, model } = await callWithFallback(userPrompt, systemInstruction, TASK_ARRAY_SCHEMA);
            const duration = Date.now() - start;
            const tasks = JSON.parse(text);

            console.log(`✓ Phân rã thành công (${model}) trong ${duration}ms, sinh ${tasks.length} tasks.`);

            // Lưu mẫu 3 task đại diện để phân tích
            auditReports.push({
                typeId: arch.typeId,
                name: arch.name,
                taskCount: tasks.length,
                durationMs: duration,
                tasks: tasks
            });

        } catch (err) {
            console.error(`✗ Lỗi kiểm thử ${arch.name}:`, err.message);
        }
    }

    // Ghi file kết quả để phân tích
    const outputPath = path.join(__dirname, 'archetypes_audit_result.json');
    fs.writeFileSync(outputPath, JSON.stringify(auditReports, null, 2), 'utf8');
    console.log(`\n✅ Đã lưu toàn bộ kết quả phân rã vào: ${outputPath}`);
}

runArchetypeAudit();
