import Database from 'better-sqlite3';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

let passedTests = 0;
let totalTests = 0;

function report(name, passed, detail = '') {
    totalTests++;
    if (passed) {
        passedTests++;
        console.log(`${GREEN}  ✓ PASS:${RESET} ${name}${detail ? ` (${detail})` : ''}`);
    } else {
        console.log(`${RED}  ✗ FAIL:${RESET} ${name}${detail ? ` (${RED}${detail}${RESET})` : ''}`);
    }
}

async function runTestSuite() {
    console.log(`\n${BOLD}${CYAN}=====================================================${RESET}`);
    console.log(`${BOLD}${CYAN}    AUTOPLAN - HỆ THỐNG KIỂM THỬ TỰ ĐỘNG TOÀN DIỆN   ${RESET}`);
    console.log(`${BOLD}${CYAN}=====================================================${RESET}\n`);

    // ------------------------------------------------------------------------
    // TEST SUITE 1: Biến môi trường & Cấu hình
    // ------------------------------------------------------------------------
    console.log(`${BOLD}[1/5] Kiểm tra cấu hình môi trường (.env)${RESET}`);
    const hasApiKey = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.length > 10);
    report('GEMINI_API_KEY hợp lệ', hasApiKey);

    const port = Number(process.env.PORT) || 3001;
    report('PORT cấu hình', port > 0, `PORT=${port}`);

    const genModels = (process.env.GEN_MODELS || '').split(',').map(m => m.trim()).filter(Boolean);
    report('Cấu hình Model AI (GEN_MODELS)', genModels.length > 0, genModels.join(', '));

    const embModel = (process.env.EMBEDDING_MODEL || '').trim();
    report('Cấu hình Embedding Model', Boolean(embModel), embModel);

    // ------------------------------------------------------------------------
    // TEST SUITE 2: SQLite Knowledge Base & Schema
    // ------------------------------------------------------------------------
    console.log(`\n${BOLD}[2/5] Kiểm tra cơ sở dữ liệu SQLite & Quan hệ dữ liệu${RESET}`);
    const dbPath = path.join(__dirname, 'knowledge_base.db');
    let db;
    try {
        db = new Database(dbPath);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');

        // Đảm bảo bảng tồn tại
        db.exec(`
            CREATE TABLE IF NOT EXISTS documents (
                doc_id TEXT PRIMARY KEY,
                board_id TEXT NOT NULL,
                name TEXT NOT NULL,
                uploaded_by TEXT,
                content_hash TEXT NOT NULL,
                embedding_model TEXT NOT NULL,
                dim INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(board_id, content_hash)
            );
            CREATE TABLE IF NOT EXISTS chunks (
                id TEXT PRIMARY KEY,
                doc_id TEXT NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,
                board_id TEXT NOT NULL,
                idx INTEGER NOT NULL,
                content TEXT NOT NULL,
                embedding BLOB NOT NULL
            );
            CREATE INDEX IF NOT EXISTS chunks_board ON chunks(board_id);
        `);
        report('Kết nối SQLite & Thiết lập chế độ WAL', true, dbPath);

        // Test Foreign Key & Cascade Delete
        const testBoardId = `test_board_${Date.now()}`;
        const testDocId = `test_doc_${Date.now()}`;
        const testChunkId = `chunk_${testDocId}_0`;

        db.prepare(`
            INSERT INTO documents (doc_id, board_id, name, uploaded_by, content_hash, embedding_model, dim, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(testDocId, testBoardId, 'Test Doc', 'tester', 'hash123', 'gemini-embedding-2', 768, new Date().toISOString());

        db.prepare(`
            INSERT INTO chunks (id, doc_id, board_id, idx, content, embedding)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(testChunkId, testDocId, testBoardId, 0, 'Test chunk content', Buffer.alloc(768 * 4));

        const chunkBefore = db.prepare('SELECT COUNT(*) as c FROM chunks WHERE doc_id = ?').get(testDocId);
        report('Ghi Document & Chunks thành công', chunkBefore.c === 1);

        // Xóa document và kiểm tra cascade
        db.prepare('DELETE FROM documents WHERE doc_id = ?').run(testDocId);
        const chunkAfter = db.prepare('SELECT COUNT(*) as c FROM chunks WHERE doc_id = ?').get(testDocId);
        report('Cơ chế ON DELETE CASCADE hoạt động chính xác', chunkAfter.c === 0);

    } catch (e) {
        report('Thao tác SQLite', false, e.message);
    } finally {
        if (db) db.close();
    }

    // ------------------------------------------------------------------------
    // TEST SUITE 3: Google Gemini API & Phân rã WBS theo JSON Schema
    // ------------------------------------------------------------------------
    console.log(`\n${BOLD}[3/5] Kiểm tra Gemini AI: Phân rã công việc đa Sprint (WBS)${RESET}`);
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

    const TASK_SCHEMA = {
        type: 'array',
        items: {
            type: 'object',
            properties: {
                title: { type: 'string' },
                description: { type: 'string' },
                role: { type: 'string' },
                assigneeName: { type: 'string' },
                estimatedHours: { type: 'number' },
                sprint: { type: 'string' },
                startDate: { type: 'string' },
                dueDate: { type: 'string' }
            },
            required: ['title', 'role', 'assigneeName', 'estimatedHours', 'sprint', 'startDate', 'dueDate']
        }
    };

    let wbsSuccess = false;
    let chosenModel = '';
    let chosenTime = 0;
    let taskCount = 0;
    for (const model of genModels) {
        try {
            const start = Date.now();
            const res = await ai.models.generateContent({
                model,
                contents: 'Phân rã chức năng Quản lý người dùng cho Sprint 1 (2026-11-20 đến 2026-11-30). Thành viên: Dev A (Backend Developer)',
                config: {
                    systemInstruction: 'Bạn là Project Manager. Hãy sinh mảng JSON danh sách các task.',
                    responseMimeType: 'application/json',
                    responseSchema: TASK_SCHEMA,
                    temperature: 0.2
                }
            });
            const duration = Date.now() - start;
            const tasks = JSON.parse(res.text);
            const isValid = Array.isArray(tasks) && tasks.length > 0 && tasks[0].title && tasks[0].sprint;
            if (isValid) {
                wbsSuccess = true;
                chosenModel = model;
                chosenTime = duration;
                taskCount = tasks.length;
                break;
            }
        } catch (e) {
            console.log(`  ⚠️ Model [${model}] tạm thời bận, thử fallback tiếp theo...`);
        }
    }
    report(`Sinh WBS AI (Model [${chosenModel}])`, wbsSuccess, `${chosenTime}ms, ${taskCount} tasks`);

    // ------------------------------------------------------------------------
    // TEST SUITE 4: Gemini Embedding & Semantic Search (RAG)
    // ------------------------------------------------------------------------
    console.log(`\n${BOLD}[4/5] Kiểm tra Vector Embedding & Tìm kiếm ngữ nghĩa (RAG)${RESET}`);
    try {
        const textA = 'Hệ thống dùng Redis để lưu session và refresh token 7 ngày.';
        const textB = 'Cách nấu món phở bò truyền thống thơm ngon đậm đà.';
        const query = 'Cơ chế lưu trữ token và phiên đăng nhập là gì?';

        const [resA, resB, resQ] = await Promise.all([
            ai.models.embedContent({ model: embModel, contents: [{ parts: [{ text: textA }] }], config: { outputDimensionality: 768 } }),
            ai.models.embedContent({ model: embModel, contents: [{ parts: [{ text: textB }] }], config: { outputDimensionality: 768 } }),
            ai.models.embedContent({ model: embModel, contents: [{ parts: [{ text: query }] }], config: { outputDimensionality: 768 } })
        ]);

        const vecA = new Float32Array(resA.embeddings[0].values);
        const vecB = new Float32Array(resB.embeddings[0].values);
        const vecQ = new Float32Array(resQ.embeddings[0].values);

        const norm = (v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
        const cosine = (v1, v2) => {
            const dot = v1.reduce((s, x, i) => s + x * v2[i], 0);
            return dot / (norm(v1) * norm(v2));
        };

        const scoreA = cosine(vecQ, vecA);
        const scoreB = cosine(vecQ, vecB);

        report(`Vector Embedding (${embModel}) sinh 768 chiều`, vecA.length === 768);
        report(`Độ khớp ngữ nghĩa đúng ngữ cảnh: ${(scoreA * 100).toFixed(1)}%`, scoreA > 0.65);
        report(`Khoảng cách phân tách ngữ cảnh đạt chuẩn: +${((scoreA - scoreB) * 100).toFixed(1)}%`, (scoreA - scoreB) > 0.20);
        report('RAG Semantic Similarity Filter (Score Đúng > Score Sai)', scoreA > scoreB);
    } catch (e) {
        report('Vector Embedding / RAG', false, e.message);
    }

    // ------------------------------------------------------------------------
    // TEST SUITE 5: Kết nối Trello REST API
    // ------------------------------------------------------------------------
    console.log(`\n${BOLD}[5/5] Kiểm tra xác thực & Tích hợp Trello REST API${RESET}`);
    const trelloKey = '3b15a7cd04187b0fe6cac3a5c980d9ab';
    const trelloToken = 'ATTAf0ead5b45de5b414c18e787e336bc09705e883b0ae275c2602c95216af18a6e69645188D';

    try {
        const res = await fetch(`https://api.trello.com/1/members/me?key=${trelloKey}&token=${trelloToken}`);
        if (res.ok) {
            const member = await res.json();
            report('Xác thực Trello Token thành công', true, `${member.fullName} (@${member.username})`);

            const boardsRes = await fetch(`https://api.trello.com/1/members/me/boards?key=${trelloKey}&token=${trelloToken}&fields=id,name`);
            if (boardsRes.ok) {
                const boards = await boardsRes.json();
                report('Truy vấn danh sách Trello Boards', true, `${boards.length} bảng truy cập được`);
            } else {
                report('Truy vấn danh sách Trello Boards', false, `${boardsRes.status}`);
            }
        } else {
            report('Xác thực Trello Token', false, `${res.status} ${res.statusText}`);
        }
    } catch (e) {
        report('Kết nối Trello API', false, e.message);
    }

    // ------------------------------------------------------------------------
    // TỔNG KẾT
    // ------------------------------------------------------------------------
    console.log(`\n${BOLD}=====================================================${RESET}`);
    if (passedTests === totalTests) {
        console.log(`${BOLD}${GREEN}  TẤT CẢ TEST ĐÃ VƯỢT QUA: ${passedTests}/${totalTests} THÀNH CÔNG (100%)${RESET}`);
    } else {
        console.log(`${BOLD}${YELLOW}  KẾT QUẢ KIỂM THỬ: ${passedTests}/${totalTests} ĐẠT${RESET}`);
    }
    console.log(`${BOLD}${CYAN}=====================================================${RESET}\n`);

    if (passedTests < totalTests) {
        process.exit(1);
    }
}

runTestSuite();
