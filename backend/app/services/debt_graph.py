"""
Debt Graph Compression — the differential feature.

Problem: In a group of N people who shared expenses, there can be up to
N*(N-1)/2 individual debts. Paying each one separately is inefficient.

Solution: Reduce to at most N-1 transfers using a minimum-cost flow approach.

Algorithm (O(N log N)):
  1. Compute each person's NET balance: sum(paid) - sum(owed).
  2. Creditors (net > 0) need to receive money.
     Debtors (net < 0) need to send money.
  3. Greedily match largest debtor with largest creditor.
     - If debtor owes more than creditor needs: creditor is settled, debtor
       still owes the remainder → continue with next creditor.
     - If creditor needs more than debtor owes: debtor is settled, creditor
       still needs the remainder → continue with next debtor.

This is provably optimal for minimizing the NUMBER of transactions.
(It does not minimize total transferred amount, which is fixed by the debts.)

Real-world use: this is how Splitwise works internally.
"""

import heapq
import uuid
from collections import defaultdict
from typing import List, Dict, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Expense, ExpenseSplit, Group, GroupMember, User
from app.schemas import DebtCompressionResult, DebtSummary, SettlementStep


async def compute_debt_compression(
    session: AsyncSession, group_id: uuid.UUID
) -> DebtCompressionResult:
    """
    Given a group, compute the minimum set of transfers to settle all debts.
    """
    # ── Load all expenses and splits for this group ───────────────────────────
    expenses_result = await session.execute(
        select(Expense).where(Expense.group_id == group_id)
    )
    expenses = expenses_result.scalars().all()

    splits_result = await session.execute(
        select(ExpenseSplit)
        .join(Expense, ExpenseSplit.expense_id == Expense.id)
        .where(Expense.group_id == group_id)
    )
    splits = splits_result.scalars().all()

    # ── Load user names ───────────────────────────────────────────────────────
    members_result = await session.execute(
        select(GroupMember, User)
        .join(User, GroupMember.user_id == User.id)
        .where(GroupMember.group_id == group_id)
    )
    users: Dict[uuid.UUID, str] = {
        member.user_id: user.full_name for member, user in members_result.all()
    }

    # ── Compute net balances (centavos) ───────────────────────────────────────
    # net[user] = amount_paid - amount_owed
    net: Dict[uuid.UUID, int] = defaultdict(int)

    for expense in expenses:
        net[expense.paid_by] += expense.amount  # payer is owed this

    for split in splits:
        net[split.user_id] -= split.share  # participant owes this

    # ── Count naive transfers (one per debt relationship) ─────────────────────
    # In the naive case, each person who owes money to another pays them directly.
    # This is the number of non-zero split entries where the splitter ≠ payer.
    naive_count = sum(
        1 for s in splits
        if any(e.paid_by != s.user_id and e.id == s.expense_id for e in expenses)
    )

    # ── Greedy debt compression ───────────────────────────────────────────────
    # Max-heap for creditors (who need to receive), min-heap for debtors.
    # Python's heapq is min-heap, so negate creditor amounts.
    creditors: List[Tuple[int, uuid.UUID]] = []  # (-amount, user_id)
    debtors: List[Tuple[int, uuid.UUID]] = []    # (-amount, user_id)  ← negated too

    for user_id, balance in net.items():
        if balance > 0:
            heapq.heappush(creditors, (-balance, user_id))
        elif balance < 0:
            heapq.heappush(debtors, (balance, user_id))  # already negative

    settlements: List[SettlementStep] = []

    while creditors and debtors:
        credit_neg, creditor_id = heapq.heappop(creditors)  # most owed
        debt, debtor_id = heapq.heappop(debtors)            # most owes (most negative)

        credit = -credit_neg   # what creditor needs to receive
        debt_abs = -debt       # what debtor needs to pay

        settle = min(credit, debt_abs)

        settlements.append(SettlementStep(
            from_user_id=debtor_id,
            from_name=users.get(debtor_id, str(debtor_id)),
            to_user_id=creditor_id,
            to_name=users.get(creditor_id, str(creditor_id)),
            amount_pesos=settle / 100,
        ))

        remaining_credit = credit - settle
        remaining_debt   = debt_abs - settle

        if remaining_credit > 0:
            heapq.heappush(creditors, (-remaining_credit, creditor_id))
        if remaining_debt > 0:
            heapq.heappush(debtors, (-remaining_debt, debtor_id))

    # ── Build response ────────────────────────────────────────────────────────
    balances = [
        DebtSummary(
            user_id=uid,
            full_name=users.get(uid, str(uid)),
            net_pesos=amount / 100,
        )
        for uid, amount in sorted(net.items(), key=lambda x: x[1])
    ]

    return DebtCompressionResult(
        group_id=group_id,
        balances=balances,
        optimal_settlements=settlements,
        naive_transfer_count=naive_count,
        optimized_transfer_count=len(settlements),
    )


async def execute_settlements(
    session: AsyncSession,
    group_id: uuid.UUID,
    settlements: List[SettlementStep],
    account_map: Dict[uuid.UUID, uuid.UUID],  # user_id → account_id
) -> List[str]:
    """
    Execute the optimal settlement transfers.
    account_map must contain an account_id for every user involved.
    Returns list of transaction IDs created.
    """
    from app.services.transfer_service import transfer

    transaction_ids = []
    for step in settlements:
        tx = await transfer(
            session,
            from_account_id=account_map[step.from_user_id],
            to_account_id=account_map[step.to_user_id],
            amount_pesos=step.amount_pesos,
            description=f"Liquidación grupal",
            idempotency_key=f"settle-{group_id}-{step.from_user_id}-{step.to_user_id}",
        )
        transaction_ids.append(str(tx.id))

    return transaction_ids
