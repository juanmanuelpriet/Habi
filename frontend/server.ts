
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import { GoogleGenAI } from "@google/genai";
import "dotenv/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database("habicapital.db");
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ─── Schema Migration ──────────────────────────────────────────────────────
// If the old single-entry ledger schema exists, drop and rebuild cleanly.
const hasDoubleEntry = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='transactions_log'")
  .get();

if (!hasDoubleEntry) {
  db.exec(`
    DROP TABLE IF EXISTS ledger;
    DROP TABLE IF EXISTS idempotency_keys;
    DROP TABLE IF EXISTS accounts;
    DROP TABLE IF EXISTS users;
  `);
}

// ─── Schema ────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    profile_picture TEXT,
    bio TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    balance INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'COP',
    trust_limit INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    CHECK(balance >= -trust_limit)
  );

  -- Transaction envelope: groups the two ledger entries of a transfer
  CREATE TABLE IF NOT EXISTS transactions_log (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('transfer','topup','withdrawal')),
    status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed','failed','reversed')),
    reference_id TEXT UNIQUE,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Double-entry ledger: every transaction generates exactly 2 rows (DEBIT + CREDIT).
  -- Invariant: SUM(amount WHERE entry_type='CREDIT') = SUM(amount WHERE entry_type='DEBIT')
  -- for every transaction_id. If this ever fails, money was created or destroyed.
  CREATE TABLE IF NOT EXISTS ledger (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL REFERENCES transactions_log(id),
    account_id TEXT NOT NULL REFERENCES accounts(id),
    entry_type TEXT NOT NULL CHECK(entry_type IN ('DEBIT','CREDIT')),
    amount INTEGER NOT NULL CHECK(amount > 0),
    balance_after INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS idempotency_keys (
    key TEXT PRIMARY KEY,
    response_code INTEGER,
    response_body TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_ledger_account ON ledger(account_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_ledger_tx ON ledger(transaction_id);
`);

// ─── Seed ──────────────────────────────────────────────────────────────────
const userCount = db.prepare("SELECT count(*) as count FROM users").get() as { count: number };
if (userCount.count === 0) {
  const aliceId = uuidv4();
  const bobId = uuidv4();
  const charlieId = uuidv4();

  db.prepare("INSERT INTO users (id, name, email) VALUES (?, ?, ?)").run(aliceId, "Alice Rodriguez", "alice@example.com");
  db.prepare("INSERT INTO users (id, name, email) VALUES (?, ?, ?)").run(bobId, "Bob Silva", "bob@example.com");
  db.prepare("INSERT INTO users (id, name, email) VALUES (?, ?, ?)").run(charlieId, "Charlie Gomez", "charlie@example.com");

  const accA = uuidv4(), accB = uuidv4(), accC = uuidv4();
  db.prepare("INSERT INTO accounts (id, user_id, balance, trust_limit) VALUES (?, ?, ?, ?)").run(accA, aliceId, 5000000, 50000);
  db.prepare("INSERT INTO accounts (id, user_id, balance, trust_limit) VALUES (?, ?, ?, ?)").run(accB, bobId, 2000000, 20000);
  db.prepare("INSERT INTO accounts (id, user_id, balance, trust_limit) VALUES (?, ?, ?, ?)").run(accC, charlieId, 0, 100000);
}

// ─── Gemini Client ─────────────────────────────────────────────────────────
const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const ASSISTANT_SYSTEM_PROMPT = `Eres HabiAssist, el asistente financiero de HabiCapital. Ayudas a los usuarios con la plataforma y conceptos financieros básicos.

PUEDES hacer:
- Explicar cómo funciona HabiCapital (transferencias, recargas, HabiTrust™, dividir cuentas)
- Guiar paso a paso para completar cualquier trámite en la app
- Explicar conceptos como ledger, idempotencia, transferencias P2P, split de gastos
- Sugerir cómo organizar gastos grupales (comidas, arriendos, viajes)

NO PUEDES hacer (límites estrictos):
- Ver ni mencionar el saldo, historial o datos de ninguna cuenta
- Ejecutar transferencias ni acciones — SOLO orientas al usuario para que él las haga
- Pedir ni revelar información financiera personal

Responde siempre en el idioma del usuario (español o inglés). Respuestas cortas y claras, máximo 4 oraciones.`;

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  // ─── Idempotency Middleware ──────────────────────────────────────────────
  app.use(async (req, res, next) => {
    const key = req.headers["x-idempotency-key"] as string;
    if (key && req.method === "POST") {
      const existing = db.prepare("SELECT * FROM idempotency_keys WHERE key = ?").get(key) as any;
      if (existing?.response_body) {
        return res.status(existing.response_code).json(JSON.parse(existing.response_body));
      }
      if (!existing) {
        db.prepare("INSERT INTO idempotency_keys (key) VALUES (?)").run(key);
      }
    }
    next();
  });

  const saveIdempotency = (key: string, code: number, body: any) => {
    if (key) {
      db.prepare("UPDATE idempotency_keys SET response_code = ?, response_body = ? WHERE key = ?")
        .run(code, JSON.stringify(body), key);
    }
  };

  // ─── Users ───────────────────────────────────────────────────────────────
  app.post("/api/users/create", (req, res) => {
    const { name, email } = req.body;
    const idempotencyKey = req.headers["x-idempotency-key"] as string;
    if (!name || !email) return res.status(400).json({ error: "Name and email are required" });

    const op = db.transaction(() => {
      const userId = uuidv4();
      const accountId = uuidv4();
      db.prepare("INSERT INTO users (id, name, email) VALUES (?, ?, ?)").run(userId, name, email);
      db.prepare("INSERT INTO accounts (id, user_id, balance, trust_limit) VALUES (?, ?, 0, 0)").run(accountId, userId);
      return { userId, accountId };
    });

    try {
      const result = op();
      saveIdempotency(idempotencyKey, 201, result);
      res.status(201).json(result);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/users", (_req, res) => {
    const users = db.prepare(`
      SELECT u.*, a.id as account_id, a.balance, a.trust_limit
      FROM users u JOIN accounts a ON u.id = a.user_id
      ORDER BY u.created_at DESC
    `).all();
    res.json(users);
  });

  app.post("/api/users/:userId/profile", (req, res) => {
    const { userId } = req.params;
    const { bio, profilePicture } = req.body;
    try {
      db.prepare("UPDATE users SET bio = ?, profile_picture = ? WHERE id = ?").run(bio, profilePicture, userId);
      res.json({ status: "success" });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ─── Ledger History ───────────────────────────────────────────────────────
  // Double-entry: for each entry belonging to accountId, find the counterparty
  // via the sibling entry in the same transaction.
  app.get("/api/ledger/:accountId", (req, res) => {
    const { accountId } = req.params;
    const history = db.prepare(`
      SELECT
        l.id,
        l.transaction_id,
        l.entry_type,
        l.amount,
        l.balance_after,
        l.created_at,
        t.type       AS transaction_type,
        t.status,
        t.metadata,
        cp_user.name AS counterparty_name
      FROM ledger l
      JOIN transactions_log t ON l.transaction_id = t.id
      LEFT JOIN ledger cp_l        ON cp_l.transaction_id = l.transaction_id
                                   AND cp_l.account_id != l.account_id
      LEFT JOIN accounts cp_acc    ON cp_l.account_id = cp_acc.id
      LEFT JOIN users cp_user      ON cp_acc.user_id = cp_user.id
      WHERE l.account_id = ?
      ORDER BY l.created_at DESC
    `).all(accountId);
    res.json(history);
  });

  // ─── Transfer ─────────────────────────────────────────────────────────────
  app.post("/api/transfer", (req, res) => {
    const { fromAccountId, toAccountId, amount, description, category } = req.body;
    const idempotencyKey = req.headers["x-idempotency-key"] as string;

    if (!fromAccountId || !toAccountId || !amount || amount <= 0) {
      const err = { error: "Invalid parameters" };
      saveIdempotency(idempotencyKey, 400, err);
      return res.status(400).json(err);
    }
    if (fromAccountId === toAccountId) {
      const err = { error: "Cannot transfer to same account" };
      saveIdempotency(idempotencyKey, 400, err);
      return res.status(400).json(err);
    }

    const execute = db.transaction(() => {
      // Lock rows in deterministic order (ascending id) to prevent deadlocks.
      const [firstId, secondId] = [fromAccountId, toAccountId].sort();
      const accs = db.prepare(
        "SELECT id, balance, trust_limit FROM accounts WHERE id IN (?, ?) ORDER BY id ASC"
      ).all(firstId, secondId) as any[];

      if (accs.length < 2) throw new Error("One or both accounts not found");

      const fromAcc = accs.find((a: any) => a.id === fromAccountId);
      const toAcc   = accs.find((a: any) => a.id === toAccountId);

      const available = fromAcc.balance + fromAcc.trust_limit;
      if (available < amount) throw new Error(`Insufficient funds. Available: ${available} centavos`);

      // Update balances
      const newFromBalance = fromAcc.balance - amount;
      const newToBalance   = toAcc.balance   + amount;
      db.prepare("UPDATE accounts SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(newFromBalance, fromAccountId);
      db.prepare("UPDATE accounts SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(newToBalance,   toAccountId);

      // Create transaction envelope
      const txId = uuidv4();
      const meta = JSON.stringify({ memo: description || "P2P Transfer", category: category || "other" });
      db.prepare("INSERT INTO transactions_log (id, type, metadata, reference_id) VALUES (?, 'transfer', ?, ?)")
        .run(txId, meta, idempotencyKey || null);

      // Double-entry: DEBIT source, CREDIT destination
      db.prepare("INSERT INTO ledger (id, transaction_id, account_id, entry_type, amount, balance_after) VALUES (?, ?, ?, 'DEBIT', ?, ?)")
        .run(uuidv4(), txId, fromAccountId, amount, newFromBalance);
      db.prepare("INSERT INTO ledger (id, transaction_id, account_id, entry_type, amount, balance_after) VALUES (?, ?, ?, 'CREDIT', ?, ?)")
        .run(uuidv4(), txId, toAccountId, amount, newToBalance);

      return { id: txId, status: "completed" };
    });

    try {
      const result = execute();
      saveIdempotency(idempotencyKey, 200, result);
      res.json(result);
    } catch (error: any) {
      const err = { error: error.message || "Transaction failed" };
      saveIdempotency(idempotencyKey, 400, err);
      res.status(400).json(err);
    }
  });

  // ─── Top-up ───────────────────────────────────────────────────────────────
  app.post("/api/topup", (req, res) => {
    const { accountId, amount } = req.body;
    const idempotencyKey = req.headers["x-idempotency-key"] as string;

    const op = db.transaction(() => {
      const acc = db.prepare("SELECT id, balance FROM accounts WHERE id = ?").get(accountId) as any;
      if (!acc) throw new Error("Account not found");

      const newBalance = acc.balance + amount;
      db.prepare("UPDATE accounts SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(newBalance, accountId);

      const txId = uuidv4();
      const meta = JSON.stringify({ memo: "Simulation Balance Load", category: "system" });
      db.prepare("INSERT INTO transactions_log (id, type, metadata, reference_id) VALUES (?, 'topup', ?, ?)")
        .run(txId, meta, idempotencyKey || null);

      // Top-up = external money entering: only CREDIT entry (no source account in system)
      db.prepare("INSERT INTO ledger (id, transaction_id, account_id, entry_type, amount, balance_after) VALUES (?, ?, ?, 'CREDIT', ?, ?)")
        .run(uuidv4(), txId, accountId, amount, newBalance);

      return { status: "success", txId };
    });

    try {
      const result = op();
      saveIdempotency(idempotencyKey, 200, result);
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // ─── Ledger Integrity Check ───────────────────────────────────────────────
  // Run: GET /api/audit/integrity — returns any transactions where money was created/destroyed.
  app.get("/api/audit/integrity", (_req, res) => {
    const broken = db.prepare(`
      SELECT transaction_id,
             SUM(CASE WHEN entry_type='CREDIT' THEN amount ELSE -amount END) AS net
      FROM ledger
      GROUP BY transaction_id
      HAVING ABS(net) > 0
         AND (SELECT type FROM transactions_log WHERE id = transaction_id) = 'transfer'
    `).all();
    res.json({ broken_transactions: broken, is_clean: broken.length === 0 });
  });

  // ─── AI Assistant (Gemini) ────────────────────────────────────────────────
  // Advisory only — no access to user data, no RAG, no actions.
  app.post("/api/assistant", async (req, res) => {
    const { messages } = req.body as {
      messages: Array<{ role: "user" | "assistant"; content: string }>;
    };

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages array is required" });
    }

    // Map to Gemini format: assistant → model, trim content
    const history = messages
      .filter(m => m.role === "user" || m.role === "assistant")
      .slice(0, -1)  // all but last
      .map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: String(m.content).slice(0, 1000) }],
      }));

    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== "user") {
      return res.status(400).json({ error: "Last message must be from user" });
    }

    try {
      const chat = genai.chats.create({
        model: "gemini-2.0-flash",
        config: { systemInstruction: ASSISTANT_SYSTEM_PROMPT, maxOutputTokens: 300 },
        history,
      });

      const response = await chat.sendMessage({ message: String(lastMessage.content).slice(0, 1000) });
      res.json({ reply: response.text ?? "" });
    } catch (err: any) {
      console.error("Assistant error:", err.message);
      res.status(500).json({ error: "El asistente no está disponible en este momento." });
    }
  });

  // ─── Vite / Static ───────────────────────────────────────────────────────
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  const PORT = 3000;
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 HabiCapital running on http://localhost:${PORT}`);
  });
}

startServer();
