from __future__ import annotations
import uuid
from datetime import datetime
from typing import Literal, Optional, List, Dict

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator


# ─── Money helper ─────────────────────────────────────────────────────────────
# Public API always uses decimal (pesos), internally we store centavos.
# e.g. $10,500.50 COP → 1050050 centavos

def pesos_to_centavos(pesos: float) -> int:
    return round(pesos * 100)

def centavos_to_pesos(centavos: int) -> float:
    return centavos / 100


# ─── Users ───────────────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=100)
    phone: Optional[str] = None


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    phone: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


# ─── Accounts ────────────────────────────────────────────────────────────────

class AccountCreate(BaseModel):
    currency: Literal["COP", "USD"] = "COP"


class AccountResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    currency: str
    balance_pesos: float
    is_active: bool
    created_at: datetime

    @classmethod
    def from_orm(cls, account) -> "AccountResponse":
        return cls(
            id=account.id,
            user_id=account.user_id,
            currency=account.currency,
            balance_pesos=centavos_to_pesos(account.balance),
            is_active=account.is_active,
            created_at=account.created_at,
        )

    model_config = {"from_attributes": True}


class DepositRequest(BaseModel):
    amount_pesos: float = Field(gt=0, le=50_000_000, description="Amount in pesos (e.g. 10000.50)")

    @field_validator("amount_pesos")
    @classmethod
    def validate_precision(cls, v: float) -> float:
        # Reject more than 2 decimal places
        if round(v, 2) != v:
            raise ValueError("Amount cannot have more than 2 decimal places")
        return v


# ─── Transfers ───────────────────────────────────────────────────────────────

class TransferRequest(BaseModel):
    from_account_id: uuid.UUID
    to_account_id: uuid.UUID
    amount_pesos: float = Field(gt=0, le=50_000_000)
    description: Optional[str] = Field(default=None, max_length=200)
    idempotency_key: Optional[str] = Field(default=None, max_length=100)

    @field_validator("amount_pesos")
    @classmethod
    def validate_precision(cls, v: float) -> float:
        if round(v, 2) != v:
            raise ValueError("Amount cannot have more than 2 decimal places")
        return v

    @model_validator(mode="after")
    def accounts_must_differ(self) -> "TransferRequest":
        if self.from_account_id == self.to_account_id:
            raise ValueError("Cannot transfer to the same account")
        return self


class TransactionResponse(BaseModel):
    id: uuid.UUID
    type: str
    status: str
    amount_pesos: float
    description: Optional[str]
    created_at: datetime

    @classmethod
    def from_orm(cls, tx) -> "TransactionResponse":
        return cls(
            id=tx.id,
            type=tx.type,
            status=tx.status,
            amount_pesos=centavos_to_pesos(tx.amount),
            description=tx.description,
            created_at=tx.created_at,
        )

    model_config = {"from_attributes": True}


class LedgerEntryResponse(BaseModel):
    id: uuid.UUID
    transaction_id: uuid.UUID
    entry_type: str
    amount_pesos: float
    balance_after_pesos: float
    created_at: datetime

    @classmethod
    def from_orm(cls, entry) -> "LedgerEntryResponse":
        return cls(
            id=entry.id,
            transaction_id=entry.transaction_id,
            entry_type=entry.entry_type,
            amount_pesos=centavos_to_pesos(entry.amount),
            balance_after_pesos=centavos_to_pesos(entry.balance_after),
            created_at=entry.created_at,
        )

    model_config = {"from_attributes": True}


# ─── Groups & Debt Compression ───────────────────────────────────────────────

class GroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    member_user_ids: List[uuid.UUID] = Field(min_length=1)


class GroupResponse(BaseModel):
    id: uuid.UUID
    name: str
    created_by: uuid.UUID
    created_at: datetime

    model_config = {"from_attributes": True}


class ExpenseCreate(BaseModel):
    group_id: uuid.UUID
    paid_by: uuid.UUID
    amount_pesos: float = Field(gt=0)
    description: str = Field(min_length=1, max_length=200)
    # Maps user_id → share in pesos. Must sum to amount_pesos.
    splits: Dict[uuid.UUID, float]

    @model_validator(mode="after")
    def splits_must_balance(self) -> "ExpenseCreate":
        total_splits = sum(self.splits.values())
        if abs(total_splits - self.amount_pesos) > 0.01:
            raise ValueError(
                f"Splits sum ({total_splits}) must equal total amount ({self.amount_pesos})"
            )
        return self


class DebtSummary(BaseModel):
    """Net balance per user within a group (positive = is owed money)."""
    user_id: uuid.UUID
    full_name: str
    net_pesos: float  # positive = creditor, negative = debtor


class SettlementStep(BaseModel):
    """One atomic payment that settles part of the group debt."""
    from_user_id: uuid.UUID
    from_name: str
    to_user_id: uuid.UUID
    to_name: str
    amount_pesos: float


class DebtCompressionResult(BaseModel):
    group_id: uuid.UUID
    balances: List[DebtSummary]
    optimal_settlements: List[SettlementStep]
    # How many raw transfers were compressed
    naive_transfer_count: int
    optimized_transfer_count: int
