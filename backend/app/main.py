import time
import uuid

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api import admin, auth, chat, documents, profile
from app.core.config import settings
from app.core.logging_config import configure_logging, logger
from app.db.database import Base, engine
from app.db.migrations import apply_migrations

configure_logging(level="DEBUG" if settings.environment == "development" else "INFO")

Base.metadata.create_all(bind=engine)
apply_migrations(engine)

app = FastAPI(
    title="CampusMind AI API",
    description="AI-powered smart college assistant - grounded RAG over official college documents.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_logging_and_id(request: Request, call_next):
    """Attaches a short request_id to every request/response, and logs
    method/path/status/latency without ever logging request bodies (which
    could contain passwords, tokens, or chat message content)."""
    request_id = uuid.uuid4().hex[:12]
    request.state.request_id = request_id
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        duration_ms = round((time.perf_counter() - start) * 1000, 1)
        logger.exception(
            "request_id=%s method=%s path=%s duration_ms=%s status=unhandled_exception",
            request_id,
            request.method,
            request.url.path,
            duration_ms,
        )
        raise
    duration_ms = round((time.perf_counter() - start) * 1000, 1)
    log = logger.warning if response.status_code >= 500 else logger.info
    log(
        "request_id=%s method=%s path=%s status=%s duration_ms=%s",
        request_id,
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
    )
    response.headers["X-Request-ID"] = request_id
    return response


def _first_readable_message(errors: list) -> str:
    """Turns FastAPI/Pydantic's structured validation error list into a
    single, user-facing sentence. Pydantic v2 prefixes custom
    field_validator ValueErrors with 'Value error, ' - strip that so
    messages like 'Full name shouldn't contain numbers.' read cleanly
    instead of 'Value error, Full name shouldn't contain numbers.'"""
    if not errors:
        return "That request doesn't look right. Please check the form and try again."
    first = errors[0]
    msg = str(first.get("msg", "Invalid input."))
    prefix = "Value error, "
    if msg.startswith(prefix):
        msg = msg[len(prefix) :]
    loc = first.get("loc") or []
    field = loc[-1] if loc and isinstance(loc[-1], str) else None
    # Our own custom validators (in schemas.py) already write a complete,
    # field-named sentence ending in a period, e.g. "Full name shouldn't
    # contain numbers." Built-in pydantic messages ("Field required") don't
    # end in a period and don't name the field, so prepend it for those.
    if field and field not in ("body",) and not msg.rstrip().endswith("."):
        field_label = field.replace("_", " ")
        msg = f"{field_label}: {msg}"
    return msg


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Every validation failure across the API returns {"detail": "<single
    readable sentence>"} instead of FastAPI's default structured array, so
    every client (this frontend, curl, a future mobile app) can render
    err.detail directly without special-casing the shape."""
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": _first_readable_message(exc.errors())},
    )


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    """Passes through intentional HTTPExceptions (403, 404, 409, etc.)
    unchanged - they already carry a clean, developer-written detail
    string. This handler exists mainly so 404s on unknown API paths get the
    same {"detail": ...} shape as everything else rather than Starlette's
    default {"detail": "Not Found"} inconsistency with custom 404s."""
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Last resort for genuine bugs: never leak a stack trace or internal
    error message to the client. Full detail goes to the server log,
    tagged with the same request_id returned to the client, so a bug
    report ("it broke, X-Request-ID: abc123") can be traced to the exact
    log line without exposing internals over the wire."""
    request_id = getattr(request.state, "request_id", "unknown")
    logger.exception("Unhandled exception on request_id=%s", request_id)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "detail": "Something went wrong on our end. Please try again.",
            "request_id": request_id,
        },
    )


app.include_router(auth.router)
app.include_router(documents.router)
app.include_router(chat.router)
app.include_router(profile.router)
app.include_router(admin.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "ai_provider": settings.ai_provider, "environment": settings.environment}
