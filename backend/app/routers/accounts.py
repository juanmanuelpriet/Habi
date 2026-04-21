from __future__ import annotations
import uuid
from typing import Optional, List

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.exceptions import AccountNotFoundError, UserNotFoundError
from app.models import Account, User
from app.schemas import AccountCreate, AccountResponse, DepositRequest, TransactionResponse
from app.services import transfer_service

router = APIRouter(prefix="/accounts", tags=["accounts"])


@router.post("/", response_model=AccountResponse, status_code=201)
async def create_account(
    user_id: uuid.UUID,
    body: AccountCreate,
    db: AsyncSession = Depends(get_db),
):
    user = await db.get(User, user_id)
    if not user:
        raise UserNotFoundError(str(user_id))

    account = Account(user_id=user_id, currency=body.currency)
    db.add(account)
    await db.commit()
    await db.refresh(account)
    return AccountResponse.from_orm(account)


@router.get("/{account_id}", response_model=AccountResponse)
async def get_account(account_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    account = await db.get(Account, account_id)
    if not account:
        raise AccountNotFoundError(str(account_id))
    return AccountResponse.from_orm(account)


@router.post("/{account_id}/deposit", response_model=TransactionResponse)
async def deposit(
    account_id: uuid.UUID,
    body: DepositRequest,
    idempotency_key: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    return await transfer_service.deposit(
        db,
        account_id=account_id,
        amount_pesos=body.amount_pesos,
        idempotency_key=idempotency_key,
    )


@router.get("/{account_id}/history")
async def get_history(
    account_id: uuid.UUID,
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    account = await db.get(Account, account_id)
    if not account:
        raise AccountNotFoundError(str(account_id))

    return await transfer_service.get_account_history(db, account_id, limit=limit, offset=offset)
