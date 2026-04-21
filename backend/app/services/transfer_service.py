"""
Transfer Service — the financial core of HabiWallet.

Every transfer goes through here. Nothing else touches account balances directly.

Key guarantees:
  1. Atomicity: both ledger entries + balance updates commit or both roll back.
  2. Consistency: DB CHECK (balance >= 0) is the last line of defense.
  3. No deadlocks: we always lock accounts in ascending UUID order.
  4. No double-spend: SELECT FOR UPDATE prevents concurrent overdrafts.
  5. Idempotency: same key → same result, no duplicate debits.
"""

from __future__ import annotations
import uuid
from decimal import Decimal
from typing import Optional, List, Dict, Tuple

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import (
    AccountInactiveError,
    AccountNotFoundError,
    CurrencyMismatchError,
    DuplicateTransferError,
    InsufficientFundsError,
)
from app.models import Account, LedgerEntry, Transaction
from app.schemas import (
    TransactionResponse,
    centavos_to_pesos,
    pesos_to_centavos,
)


async def _lock_accounts_ordered(
    session: AsyncSession, id_a: uuid.UUID, id_b: uuid.UUID
) -> Tuple[Account, Account]:
    """
    Lock two accounts with SELECT FOR UPDATE in a deterministic order.

    Always locking in ascending UUID order prevents deadlocks when two
    concurrent transfers involve the same pair of accounts in opposite
    directions (A→B and B→A racing).
    """
    first_id, second_id = sorted([id_a, id_b])

    result = await session.execute(
        select(Account)
        .where(Account.id.in_([first_id, second_id]))
        .with_for_update(nowait=True)  # fail fast on lock contention
        .order_by(Account.id)
    )
    accounts = {a.id: a for a in result.scalars().all()}

    if id_a not in accounts:
        raise AccountNotFoundError(str(id_a))
    if id_b not in accounts:
        raise AccountNotFoundError(str(id_b))

    return accounts[id_a], accounts[id_b]


async def transfer(
    session: AsyncSession,
    *,
    from_account_id: uuid.UUID,
    to_account_id: uuid.UUID,
    amount_pesos: float,
    description: Optional[str] = None,
    idempotency_key: Optional[str] = None,
) -> TransactionResponse:
    """
    Execute a transfer between two accounts.

    If idempotency_key is provided and already exists in the DB, returns the
    original transaction without re-executing (safe retry).
    """

    # ── 1. Idempotency check ──────────────────────────────────────────────────
    if idempotency_key:
        existing = await session.execute(
            select(Transaction).where(Transaction.idempotency_key == idempotency_key)
        )
        existing_tx = existing.scalar_one_or_none()
        if existing_tx:
            return TransactionResponse.from_orm(existing_tx)

    amount_centavos = pesos_to_centavos(amount_pesos)

    # ── 2. Acquire row-level locks (ordered to prevent deadlocks) ─────────────
    #    SELECT FOR UPDATE NOWAIT: raises immediately if another tx holds the lock.
    #    The caller should catch OperationalError and retry with backoff.
    from_acc, to_acc = await _lock_accounts_ordered(session, from_account_id, to_account_id)

    # ── 3. Business rule validations (after lock, so reads are consistent) ────
    if not from_acc.is_active:
        raise AccountInactiveError(str(from_account_id))
    if not to_acc.is_active:
        raise AccountInactiveError(str(to_account_id))
    if from_acc.currency != to_acc.currency:
        raise CurrencyMismatchError()
    if from_acc.balance < amount_centavos:
        raise InsufficientFundsError(
            available=centavos_to_pesos(from_acc.balance),
            requested=amount_pesos,
        )

    # ── 4. Create the transaction envelope ───────────────────────────────────
    tx = Transaction(
        type="TRANSFER",
        status="COMPLETED",
        amount=amount_centavos,
        description=description,
        idempotency_key=idempotency_key,
    )
    session.add(tx)
    await session.flush()  # get tx.id before creating ledger entries

    # ── 5. Update balances and write double-entry ledger ──────────────────────
    #    DEBIT  = money leaving source account
    #    CREDIT = money arriving at destination account
    #    Invariant: DEBIT.amount == CREDIT.amount (same transaction)

    from_acc.balance -= amount_centavos
    to_acc.balance   += amount_centavos

    debit_entry = LedgerEntry(
        transaction_id=tx.id,
        account_id=from_acc.id,
        entry_type="DEBIT",
        amount=amount_centavos,
        balance_after=from_acc.balance,
    )
    credit_entry = LedgerEntry(
        transaction_id=tx.id,
        account_id=to_acc.id,
        entry_type="CREDIT",
        amount=amount_centavos,
        balance_after=to_acc.balance,
    )
    session.add(debit_entry)
    session.add(credit_entry)

    # ── 6. Commit ─────────────────────────────────────────────────────────────
    #    If the DB CHECK (balance >= 0) fires here, it raises IntegrityError.
    #    That's fine: the transaction rolls back, money is not lost.
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        # Re-check idempotency key collision vs. balance violation
        if idempotency_key and "transactions_idempotency_key_key" in str(exc):
            raise DuplicateTransferError(idempotency_key) from exc
        raise  # re-raise balance constraint violations as-is

    return TransactionResponse.from_orm(tx)


async def deposit(
    session: AsyncSession,
    *,
    account_id: uuid.UUID,
    amount_pesos: float,
    description: str = "Depósito",
    idempotency_key: Optional[str] = None,
) -> TransactionResponse:
    """Simulate loading funds into an account (no source account)."""

    if idempotency_key:
        existing = await session.execute(
            select(Transaction).where(Transaction.idempotency_key == idempotency_key)
        )
        if (existing_tx := existing.scalar_one_or_none()):
            return TransactionResponse.from_orm(existing_tx)

    amount_centavos = pesos_to_centavos(amount_pesos)

    result = await session.execute(
        select(Account).where(Account.id == account_id).with_for_update(nowait=True)
    )
    acc = result.scalar_one_or_none()
    if not acc:
        raise AccountNotFoundError(str(account_id))
    if not acc.is_active:
        raise AccountInactiveError(str(account_id))

    acc.balance += amount_centavos

    tx = Transaction(
        type="DEPOSIT",
        status="COMPLETED",
        amount=amount_centavos,
        description=description,
        idempotency_key=idempotency_key,
    )
    session.add(tx)
    await session.flush()

    session.add(LedgerEntry(
        transaction_id=tx.id,
        account_id=acc.id,
        entry_type="CREDIT",
        amount=amount_centavos,
        balance_after=acc.balance,
    ))

    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        if idempotency_key and "transactions_idempotency_key_key" in str(exc):
            raise DuplicateTransferError(idempotency_key) from exc
        raise

    return TransactionResponse.from_orm(tx)


async def get_account_history(
    session: AsyncSession,
    account_id: uuid.UUID,
    limit: int = 50,
    offset: int = 0,
) -> List[Dict]:
    """Returns chronological ledger history for an account."""
    result = await session.execute(
        select(LedgerEntry, Transaction)
        .join(Transaction, LedgerEntry.transaction_id == Transaction.id)
        .where(LedgerEntry.account_id == account_id)
        .order_by(LedgerEntry.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    rows = result.all()
    return [
        {
            "ledger_entry_id": str(entry.id),
            "transaction_id": str(entry.transaction_id),
            "type": tx.type,
            "entry_type": entry.entry_type,
            "amount_pesos": centavos_to_pesos(entry.amount),
            "balance_after_pesos": centavos_to_pesos(entry.balance_after),
            "description": tx.description,
            "created_at": entry.created_at.isoformat(),
        }
        for entry, tx in rows
    ]
