from __future__ import annotations
import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger, Boolean, CheckConstraint, DateTime, ForeignKey,
    String, Text, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func
from typing import Optional, List, Dict

from app.database import Base


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID]         = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    email: Mapped[str]            = mapped_column(Text, unique=True, nullable=False)
    full_name: Mapped[str]        = mapped_column(Text, nullable=False)
    phone: Mapped[Optional[str]]     = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime]  = mapped_column(DateTime(timezone=True), server_default=func.now())

    accounts: Mapped[List["Account"]] = relationship("Account", back_populates="user")


class Account(Base):
    __tablename__ = "accounts"
    __table_args__ = (
        CheckConstraint("balance >= 0", name="balance_non_negative"),
    )

    id: Mapped[uuid.UUID]         = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID]    = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    currency: Mapped[str]         = mapped_column(String(3), nullable=False, default="COP")
    # Stored in centavos. 10_000_00 = $10,000 COP.
    balance: Mapped[int]          = mapped_column(BigInteger, nullable=False, default=0)
    is_active: Mapped[bool]       = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime]  = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"]                      = relationship("User", back_populates="accounts")
    ledger_entries: Mapped[List["LedgerEntry"]] = relationship("LedgerEntry", back_populates="account")


class Transaction(Base):
    __tablename__ = "transactions"
    __table_args__ = (
        CheckConstraint("amount > 0", name="amount_positive"),
    )

    id: Mapped[uuid.UUID]            = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    idempotency_key: Mapped[Optional[str]] = mapped_column(Text, unique=True, nullable=True)
    type: Mapped[str]                = mapped_column(String(20), nullable=False)
    status: Mapped[str]              = mapped_column(String(20), nullable=False, default="COMPLETED")
    amount: Mapped[int]              = mapped_column(BigInteger, nullable=False)
    description: Mapped[Optional[str]]  = mapped_column(Text, nullable=True)
    metadata_: Mapped[Optional[dict]]   = mapped_column("metadata", JSONB, nullable=True)
    created_at: Mapped[datetime]     = mapped_column(DateTime(timezone=True), server_default=func.now())

    ledger_entries: Mapped[List["LedgerEntry"]] = relationship("LedgerEntry", back_populates="transaction")


class LedgerEntry(Base):
    __tablename__ = "ledger_entries"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ledger_amount_positive"),
        CheckConstraint("balance_after >= 0", name="ledger_balance_non_negative"),
    )

    id: Mapped[uuid.UUID]            = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    transaction_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("transactions.id"), nullable=False)
    account_id: Mapped[uuid.UUID]    = mapped_column(UUID(as_uuid=True), ForeignKey("accounts.id"), nullable=False)
    entry_type: Mapped[str]          = mapped_column(String(10), nullable=False)  # DEBIT | CREDIT
    amount: Mapped[int]              = mapped_column(BigInteger, nullable=False)
    balance_after: Mapped[int]       = mapped_column(BigInteger, nullable=False)
    created_at: Mapped[datetime]     = mapped_column(DateTime(timezone=True), server_default=func.now())

    transaction: Mapped["Transaction"] = relationship("Transaction", back_populates="ledger_entries")
    account: Mapped["Account"]         = relationship("Account", back_populates="ledger_entries")


# ─── Groups & Expenses (Debt Compression Feature) ─────────────────────────────

class Group(Base):
    __tablename__ = "groups"

    id: Mapped[uuid.UUID]        = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    name: Mapped[str]            = mapped_column(Text, nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    members: Mapped[List["GroupMember"]] = relationship("GroupMember", back_populates="group")
    expenses: Mapped[List["Expense"]]    = relationship("Expense", back_populates="group")


class GroupMember(Base):
    __tablename__ = "group_members"
    __table_args__ = (UniqueConstraint("group_id", "user_id"),)

    group_id: Mapped[uuid.UUID]  = mapped_column(UUID(as_uuid=True), ForeignKey("groups.id"), primary_key=True)
    user_id: Mapped[uuid.UUID]   = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True)
    joined_at: Mapped[datetime]  = mapped_column(DateTime(timezone=True), server_default=func.now())

    group: Mapped["Group"]   = relationship("Group", back_populates="members")
    user: Mapped["User"]     = relationship("User")


class Expense(Base):
    __tablename__ = "expenses"
    __table_args__ = (CheckConstraint("amount > 0", name="expense_amount_positive"),)

    id: Mapped[uuid.UUID]        = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    group_id: Mapped[uuid.UUID]  = mapped_column(UUID(as_uuid=True), ForeignKey("groups.id"), nullable=False)
    paid_by: Mapped[uuid.UUID]   = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    amount: Mapped[int]          = mapped_column(BigInteger, nullable=False)
    description: Mapped[str]     = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    group: Mapped["Group"]                    = relationship("Group", back_populates="expenses")
    splits: Mapped[List["ExpenseSplit"]]      = relationship("ExpenseSplit", back_populates="expense")


class ExpenseSplit(Base):
    __tablename__ = "expense_splits"
    __table_args__ = (CheckConstraint("share > 0", name="split_share_positive"),)

    expense_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("expenses.id"), primary_key=True)
    user_id: Mapped[uuid.UUID]    = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True)
    share: Mapped[int]            = mapped_column(BigInteger, nullable=False)

    expense: Mapped["Expense"] = relationship("Expense", back_populates="splits")
    user: Mapped["User"]       = relationship("User")
