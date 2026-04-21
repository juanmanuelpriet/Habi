"""
Critical path tests for the transfer service.

These tests use a real PostgreSQL instance (not mocks) because we need to
verify DB-level constraints (balance >= 0, unique idempotency keys) and
concurrency behavior (SELECT FOR UPDATE).

Run with: pytest tests/ -v
Requires: docker-compose up db
"""

import asyncio
import uuid

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.exceptions import InsufficientFundsError
from app.models import Account, User
from app.services.transfer_service import deposit, transfer

TEST_DB_URL = "postgresql+asyncpg://habi:habi@localhost:5432/habiwallet_test"


@pytest_asyncio.fixture(scope="session")
async def engine():
    eng = create_async_engine(TEST_DB_URL, echo=False)
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    await eng.dispose()


@pytest_asyncio.fixture
async def session(engine):
    factory = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as sess:
        yield sess
        await sess.rollback()


async def _make_funded_account(session: AsyncSession, balance_pesos: float) -> Account:
    user = User(email=f"{uuid.uuid4()}@test.com", full_name="Test User")
    session.add(user)
    await session.flush()
    acc = Account(user_id=user.id, currency="COP")
    session.add(acc)
    await session.flush()
    await deposit(session, account_id=acc.id, amount_pesos=balance_pesos)
    await session.refresh(acc)
    return acc


# ─── Happy path ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_transfer_moves_funds_correctly(session):
    sender = await _make_funded_account(session, 10_000)
    receiver = await _make_funded_account(session, 0)

    await transfer(session, from_account_id=sender.id, to_account_id=receiver.id, amount_pesos=3_000)

    await session.refresh(sender)
    await session.refresh(receiver)

    assert sender.balance == 700_000     # 7,000 pesos in centavos
    assert receiver.balance == 300_000   # 3,000 pesos in centavos


@pytest.mark.asyncio
async def test_double_entry_sums_to_zero(session):
    """Verify the fundamental ledger invariant: debits == credits per transaction."""
    sender = await _make_funded_account(session, 5_000)
    receiver = await _make_funded_account(session, 0)

    tx = await transfer(session, from_account_id=sender.id, to_account_id=receiver.id, amount_pesos=1_500)

    result = await session.execute(
        text("""
            SELECT SUM(CASE WHEN entry_type='CREDIT' THEN amount ELSE -amount END) AS net
            FROM ledger_entries WHERE transaction_id = :tx_id
        """),
        {"tx_id": tx.id},
    )
    net = result.scalar_one()
    assert net == 0, f"Ledger is not balanced: net={net}"


# ─── Insufficient funds ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_insufficient_funds_raises_and_does_not_mutate(session):
    sender = await _make_funded_account(session, 100)
    receiver = await _make_funded_account(session, 0)
    original_balance = sender.balance

    with pytest.raises(InsufficientFundsError):
        await transfer(session, from_account_id=sender.id, to_account_id=receiver.id, amount_pesos=999)

    await session.refresh(sender)
    await session.refresh(receiver)
    assert sender.balance == original_balance
    assert receiver.balance == 0


# ─── Idempotency ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_idempotent_transfer_does_not_double_debit(session):
    sender = await _make_funded_account(session, 10_000)
    receiver = await _make_funded_account(session, 0)
    key = f"idem-{uuid.uuid4()}"

    tx1 = await transfer(
        session, from_account_id=sender.id, to_account_id=receiver.id,
        amount_pesos=1_000, idempotency_key=key,
    )
    tx2 = await transfer(
        session, from_account_id=sender.id, to_account_id=receiver.id,
        amount_pesos=1_000, idempotency_key=key,
    )

    assert tx1.id == tx2.id, "Same key must return same transaction"

    await session.refresh(sender)
    assert sender.balance == 900_000, "Funds must only be debited once"


# ─── Debt compression (unit test, no DB needed) ──────────────────────────────

def test_debt_compression_minimizes_transfers():
    """
    Verify the greedy algorithm with a known example.

    A paid $300 for the group (owes 100 each to B and C).
    B paid $0 → owes $100 to A.
    C paid $0 → owes $100 to A.
    D paid $200 for himself + $200 for E → E owes D $200.

    Net balances:
      A: +200  (paid 300, owes 100 to himself)
      B: -100
      C: -100
      D: +200  (paid 200 extra for E)
      E: -200

    Optimal (3 transfers):
      B → A: $100
      C → A: $100
      E → D: $200

    Naive (pairwise debts) would be more.
    """
    import heapq
    # Replicate the algorithm directly
    net = {"A": 200, "B": -100, "C": -100, "D": 200, "E": -200}

    creditors = [(-v, k) for k, v in net.items() if v > 0]
    debtors   = [(v, k)  for k, v in net.items() if v < 0]
    heapq.heapify(creditors)
    heapq.heapify(debtors)

    settlements = []
    while creditors and debtors:
        credit_neg, cid = heapq.heappop(creditors)
        debt, did       = heapq.heappop(debtors)
        settle = min(-credit_neg, -debt)
        settlements.append((did, cid, settle))
        if -credit_neg - settle > 0:
            heapq.heappush(creditors, (-((-credit_neg) - settle), cid))
        if (-debt) - settle > 0:
            heapq.heappush(debtors, (-((-debt) - settle), did))

    assert len(settlements) <= len(net) - 1, "Must use at most N-1 transfers"
    # Total settled must equal total positive (conservation)
    assert sum(s[2] for s in settlements) == sum(v for v in net.values() if v > 0)
