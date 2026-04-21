-- HabiWallet Schema — Double-Entry Ledger
-- All monetary amounts stored in centavos (COP) as BIGINT.
-- Never use FLOAT for money.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Core Identity ───────────────────────────────────────────────────────────

CREATE TABLE users (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT        UNIQUE NOT NULL,
    full_name   TEXT        NOT NULL,
    phone       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);

-- ─── Accounts (Wallets) ───────────────────────────────────────────────────────
-- One user can have multiple accounts (COP, USD in the future).
-- balance is a DENORMALIZED cache. Source of truth is ledger_entries.
-- The CHECK constraint is the last line of defense: the DB will never allow
-- balance to go negative, even if application logic has a bug.

CREATE TABLE accounts (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    currency    CHAR(3)     NOT NULL DEFAULT 'COP',
    balance     BIGINT      NOT NULL DEFAULT 0,
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT  balance_non_negative CHECK (balance >= 0)
);

CREATE INDEX idx_accounts_user_id ON accounts(user_id);

-- ─── Transactions (Envelope) ─────────────────────────────────────────────────
-- A transaction groups two ledger entries. One transaction = one transfer.
-- idempotency_key prevents duplicate submissions (same key → same result).

CREATE TABLE transactions (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key  TEXT        UNIQUE,
    type             TEXT        NOT NULL CHECK (type IN ('DEPOSIT','TRANSFER','WITHDRAWAL')),
    status           TEXT        NOT NULL DEFAULT 'COMPLETED'
                                 CHECK (status IN ('PENDING','COMPLETED','FAILED','REVERSED')),
    amount           BIGINT      NOT NULL CHECK (amount > 0),
    description      TEXT,
    metadata         JSONB,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_transactions_idempotency ON transactions(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_transactions_created_at ON transactions(created_at DESC);

-- ─── Ledger Entries (Source of Truth) ────────────────────────────────────────
-- Double-entry: every transaction has exactly one DEBIT and one CREDIT entry.
-- Invariant: SUM(amount WHERE type=CREDIT) = SUM(amount WHERE type=DEBIT) always.
-- balance_after snaps the account balance at write time (audit trail).

CREATE TABLE ledger_entries (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id  UUID        NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
    account_id      UUID        NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    entry_type      TEXT        NOT NULL CHECK (entry_type IN ('DEBIT','CREDIT')),
    amount          BIGINT      NOT NULL CHECK (amount > 0),
    balance_after   BIGINT      NOT NULL CHECK (balance_after >= 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ledger_account_id   ON ledger_entries(account_id, created_at DESC);
CREATE INDEX idx_ledger_transaction_id ON ledger_entries(transaction_id);

-- ─── Groups & Expenses (Differential Feature: Debt Compression) ──────────────

CREATE TABLE groups (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        NOT NULL,
    created_by  UUID        NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE group_members (
    group_id    UUID        NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (group_id, user_id)
);

-- Who paid what for the group
CREATE TABLE expenses (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id    UUID        NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    paid_by     UUID        NOT NULL REFERENCES users(id),
    amount      BIGINT      NOT NULL CHECK (amount > 0),
    description TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- How the expense is split among members
CREATE TABLE expense_splits (
    expense_id  UUID        NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    user_id     UUID        NOT NULL REFERENCES users(id),
    share       BIGINT      NOT NULL CHECK (share > 0),
    PRIMARY KEY (expense_id, user_id)
);

-- ─── Verify double-entry invariant (run as a health check) ───────────────────
-- SELECT t.id, SUM(CASE WHEN entry_type='CREDIT' THEN amount ELSE -amount END) AS net
-- FROM transactions t JOIN ledger_entries l ON l.transaction_id = t.id
-- GROUP BY t.id
-- HAVING SUM(CASE WHEN entry_type='CREDIT' THEN amount ELSE -amount END) != 0;
-- Must return 0 rows.
