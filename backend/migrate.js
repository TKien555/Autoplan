import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import Database from 'better-sqlite3';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JSON_FILE = path.join(__dirname, 'knowledge_base.json');
const DB_FILE = process.env.SQLITE_PATH || path.join(__dirname, 'knowledge_base.db');

const EMBEDDING_MODEL = (process.env.EMBEDDING_MODEL || 'gemini-embedding-2').trim();
const EMBEDDING_DIM = Number(process.env.EMBEDDING_DIM) || 768;
const TARGET_BOARD_ID = process.env.DEFAULT_BOARD_ID || 'legacy';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
const docText = (title, chunk) => `title: ${title} | text: ${chunk}`;

function float32ToBuffer(arr) {
    const f32 = new Float32Array(arr);
    return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

async function embedBatch(texts) {
    const res = await ai.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: texts.map(t => ({ parts: [{ text: t }] })),
        config: { outputDimensionality: EMBEDDING_DIM }
    });
    return res.embeddings.map(e => e.values);
}

async function runMigration() {
    if (!fs.existsSync(JSON_FILE)) {
        console.log('ℹ️ Không tìm thấy file knowledge_base.json. Không cần migrate.');
        return;
    }

    const rawChunks = JSON.parse(fs.readFileSync(JSON_FILE, 'utf-8'));
    if (!Array.isArray(rawChunks) || rawChunks.length === 0) {
        console.log('ℹ️ File knowledge_base.json trống.');
        return;
    }

    console.log(`📦 Đọc được ${rawChunks.length} chunks từ knowledge_base.json.`);

    // Gom nhóm chunks theo docId
    const docsMap = new Map();
    for (const item of rawChunks) {
        if (!docsMap.has(item.docId)) {
            docsMap.set(item.docId, {
                docId: item.docId,
                docName: item.docName || 'Tài liệu cũ',
                createdAt: item.createdAt || new Date().toISOString(),
                chunks: []
            });
        }
        docsMap.get(item.docId).chunks.push(item);
    }

    const db = new Database(DB_FILE);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

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

    const insertDoc = db.prepare(`
        INSERT OR IGNORE INTO documents (doc_id, board_id, name, uploaded_by, content_hash, embedding_model, dim, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertChunk = db.prepare(`
        INSERT OR REPLACE INTO chunks (id, doc_id, board_id, idx, content, embedding)
        VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const doc of docsMap.values()) {
        const needsReEmbed = doc.chunks.some(
            c => c.embeddingModel !== EMBEDDING_MODEL || c.dim !== EMBEDDING_DIM || !Array.isArray(c.embedding) || c.embedding.length !== EMBEDDING_DIM
        );

        if (needsReEmbed) {
            console.log(`🔄 Đang re-embed tài liệu "${doc.docName}" (${doc.chunks.length} chunks) sang ${EMBEDDING_MODEL} (${EMBEDDING_DIM} chiều)...`);
            const BATCH_SIZE = 50;
            for (let i = 0; i < doc.chunks.length; i += BATCH_SIZE) {
                const batch = doc.chunks.slice(i, i + BATCH_SIZE);
                const texts = batch.map(c => docText(doc.docName, c.content));
                const newVectors = await embedBatch(texts);

                batch.forEach((c, idx) => {
                    c.embedding = newVectors[idx];
                    c.embeddingModel = EMBEDDING_MODEL;
                    c.dim = EMBEDDING_DIM;
                });

                if (i + BATCH_SIZE < doc.chunks.length) {
                    await new Promise(r => setTimeout(r, 1200)); // Delay tránh chạm ngưỡng RPM
                }
            }
        } else {
            console.log(`✅ Tài liệu "${doc.docName}" đã khớp ${EMBEDDING_MODEL}/${EMBEDDING_DIM}, copy trực tiếp vào SQLite.`);
        }

        const contentHash = crypto
            .createHash('sha256')
            .update(doc.chunks.map(c => c.content).join('\n'))
            .digest('hex');

        const tx = db.transaction(() => {
            insertDoc.run(
                doc.docId,
                TARGET_BOARD_ID,
                doc.docName,
                'legacy',
                contentHash,
                EMBEDDING_MODEL,
                EMBEDDING_DIM,
                doc.createdAt
            );

            doc.chunks.forEach((c, idx) => {
                insertChunk.run(
                    c.id || `${doc.docId}_chunk_${idx}`,
                    doc.docId,
                    TARGET_BOARD_ID,
                    idx,
                    c.content,
                    float32ToBuffer(c.embedding)
                );
            });
        });
        tx();
    }

    // Cập nhật lại cả file JSON đã re-embed để dự phòng
    fs.writeFileSync(JSON_FILE, JSON.stringify(rawChunks, null, 2), 'utf-8');
    db.close();
    console.log(`🎉 Hoàn tất migrate ${docsMap.size} tài liệu sang SQLite (${DB_FILE}) với board_id = "${TARGET_BOARD_ID}"!`);
}

runMigration().catch(err => {
    console.error('❌ Lỗi trong quá trình migrate:', err);
    process.exit(1);
});