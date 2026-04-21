from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError

from app.routers import accounts, groups, transfers, users


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield  # startup / shutdown hooks go here (DB pool warm-up, etc.)


app = FastAPI(
    title="HabiWallet API",
    description="Fintech wallet with double-entry ledger and debt compression",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(users.router)
app.include_router(accounts.router)
app.include_router(transfers.router)
app.include_router(groups.router)


@app.exception_handler(IntegrityError)
async def integrity_error_handler(request: Request, exc: IntegrityError):
    """Catch DB constraint violations not handled by service layer."""
    msg = str(exc.orig) if exc.orig else str(exc)
    if "balance_non_negative" in msg or "balance_after >= 0" in msg:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={"code": "BALANCE_CONSTRAINT_VIOLATED", "detail": "Balance cannot go negative."},
        )
    if "unique" in msg.lower() or "duplicate" in msg.lower():
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={"code": "DUPLICATE_ENTRY", "detail": msg},
        )
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"code": "DATABASE_ERROR", "detail": "An unexpected database error occurred."},
    )


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/")
async def root():
    return {
        "service": "HabiWallet",
        "docs": "/docs",
        "health": "/health",
    }
