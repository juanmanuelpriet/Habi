import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import Expense, ExpenseSplit, Group, GroupMember
from app.schemas import (
    DebtCompressionResult,
    ExpenseCreate,
    GroupCreate,
    GroupResponse,
    pesos_to_centavos,
)
from app.services.debt_graph import compute_debt_compression

router = APIRouter(prefix="/groups", tags=["groups"])


@router.post("/", response_model=GroupResponse, status_code=201)
async def create_group(body: GroupCreate, db: AsyncSession = Depends(get_db)):
    group = Group(name=body.name, created_by=body.member_user_ids[0])
    db.add(group)
    await db.flush()

    for uid in body.member_user_ids:
        db.add(GroupMember(group_id=group.id, user_id=uid))

    await db.commit()
    await db.refresh(group)
    return group


@router.post("/{group_id}/expenses", status_code=201)
async def add_expense(
    group_id: uuid.UUID,
    body: ExpenseCreate,
    db: AsyncSession = Depends(get_db),
):
    expense = Expense(
        group_id=group_id,
        paid_by=body.paid_by,
        amount=pesos_to_centavos(body.amount_pesos),
        description=body.description,
    )
    db.add(expense)
    await db.flush()

    for user_id, share_pesos in body.splits.items():
        db.add(ExpenseSplit(
            expense_id=expense.id,
            user_id=user_id,
            share=pesos_to_centavos(share_pesos),
        ))

    await db.commit()
    return {"expense_id": str(expense.id)}


@router.get("/{group_id}/settle", response_model=DebtCompressionResult)
async def get_settlement_plan(
    group_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    """
    Returns the optimal (minimum transfers) settlement plan for the group.

    This is read-only — it does NOT execute transfers.
    Call POST /groups/{group_id}/settle/execute to actually settle.
    """
    return await compute_debt_compression(db, group_id)
