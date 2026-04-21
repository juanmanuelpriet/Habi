from fastapi import HTTPException, status


class InsufficientFundsError(HTTPException):
    def __init__(self, available: float, requested: float):
        super().__init__(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "INSUFFICIENT_FUNDS",
                "available_pesos": available,
                "requested_pesos": requested,
            },
        )


class AccountNotFoundError(HTTPException):
    def __init__(self, account_id: str):
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "ACCOUNT_NOT_FOUND", "account_id": account_id},
        )


class AccountInactiveError(HTTPException):
    def __init__(self, account_id: str):
        super().__init__(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "ACCOUNT_INACTIVE", "account_id": account_id},
        )


class DuplicateTransferError(HTTPException):
    """Idempotency key collision: same key, different payload."""
    def __init__(self, idempotency_key: str):
        super().__init__(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "IDEMPOTENCY_CONFLICT",
                "idempotency_key": idempotency_key,
                "message": "A different transfer was already submitted with this key.",
            },
        )


class CurrencyMismatchError(HTTPException):
    def __init__(self):
        super().__init__(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "CURRENCY_MISMATCH", "message": "Both accounts must share the same currency."},
        )


class UserNotFoundError(HTTPException):
    def __init__(self, user_id: str):
        super().__init__(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "USER_NOT_FOUND", "user_id": user_id},
        )
