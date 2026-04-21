import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.exceptions import AccountNotFoundError
from app.schemas import TransferRequest, TransactionResponse
from app.services import transfer_service

router = APIRouter(prefix="/transfers", tags=["transfers"])


@router.post("/", response_model=TransactionResponse, status_code=201)
async def create_transfer(
    body: TransferRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Transfer funds between two accounts.

    - Atomic: all-or-nothing, no partial state.
    - Idempotent: provide idempotency_key for safe retries.
    - Deadlock-safe: accounts locked in UUID order.
    - Raises 422 on insufficient funds, 409 on idempotency conflict.
    """
    try:
        return await transfer_service.transfer(
            db,
            from_account_id=body.from_account_id,
            to_account_id=body.to_account_id,
            amount_pesos=body.amount_pesos,
            description=body.description,
            idempotency_key=body.idempotency_key,
        )
    except OperationalError:
        # Lock contention (NOWAIT fired). Caller should retry with backoff.
        await db.rollback()
        from fastapi import HTTPException, status
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "LOCK_CONTENTION", "message": "Retry in a moment."},
        )
