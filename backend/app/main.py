"""API do English Tutor: o front manda a conversa, o servidor fala com o LLM."""
from contextlib import asynccontextmanager

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .auth import User
from .config import Settings, get_settings
from .deps import enforce_rate_limit, get_llm
from .llm import GroqClient, LLMError
from .parsing import parse_term_translation, parse_tutor_reply
from .prompts import build_chat_messages, build_translate_messages
from .schemas import MAX_USER_MESSAGE, ChatRequest, TermTranslation, TranslateRequest, TutorReply


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as http:
        app.state.llm = GroqClient(http, settings.groq_api_key, settings.groq_model)
        yield


app = FastAPI(title="English Tutor API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origin_list,
    allow_methods=["GET", "POST"],
    allow_headers=["authorization", "content-type"],
    expose_headers=["retry-after"],
)


@app.exception_handler(LLMError)
async def llm_error_handler(_: Request, exc: LLMError) -> JSONResponse:
    return JSONResponse({"detail": exc.message}, status_code=exc.status)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/chat", response_model=TutorReply)
async def chat(
    body: ChatRequest,
    _user: User = Depends(enforce_rate_limit),
    llm: GroqClient = Depends(get_llm),
    settings: Settings = Depends(get_settings),
) -> TutorReply:
    """Avalia a última frase do aluno e continua a conversa."""
    last = body.messages[-1]
    if last.role != "user":
        raise HTTPException(422, "A última mensagem precisa ser do aluno.")
    if len(last.content) > MAX_USER_MESSAGE:
        raise HTTPException(422, f"Mensagem longa demais (máximo de {MAX_USER_MESSAGE} caracteres).")

    messages = build_chat_messages(body.level, body.messages, body.weak_spots, settings.max_history_messages)
    raw = await llm.complete(messages, max_tokens=1024)
    return parse_tutor_reply(raw)


@app.post("/api/translate", response_model=TermTranslation)
async def translate(
    body: TranslateRequest,
    _user: User = Depends(enforce_rate_limit),
    llm: GroqClient = Depends(get_llm),
) -> TermTranslation:
    """Traduz um termo em inglês para o português considerando a frase onde apareceu."""
    raw = await llm.complete(build_translate_messages(body.term, body.context), max_tokens=256)
    try:
        return parse_term_translation(raw, body.term)
    except ValueError:
        raise HTTPException(502, "Não foi possível traduzir.")
