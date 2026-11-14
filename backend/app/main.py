"""API do English Tutor: o front manda a conversa, o servidor fala com o LLM."""
import asyncio
import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .auth import User
from .config import Settings, get_settings
from .deps import enforce_rate_limit, get_current_user, get_llm, get_memory
from .embeddings import FastEmbedEmbedder
from .llm import GroqClient, LLMError
from .memory import MistakeMemory, PgMistakeStore, Recall
from .parsing import parse_term_translation, parse_tutor_reply
from .prompts import build_chat_messages, build_translate_messages
from .schemas import MAX_USER_MESSAGE, ChatRequest, TermTranslation, TranslateRequest, TutorReply

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    store: PgMistakeStore | None = None
    warm_up: asyncio.Task | None = None
    app.state.memory = None
    if settings.database_url:
        try:
            store = await PgMistakeStore.connect(settings.database_url)
            embedder = FastEmbedEmbedder(settings.embedding_model)
            app.state.memory = MistakeMemory(store, embedder, settings.memory_top_k, settings.memory_max_distance)
            # carrega o modelo em segundo plano: o servidor já responde enquanto isso
            warm_up = asyncio.create_task(embedder.warm_up())
        except Exception:
            # a memória é um reforço: sem banco, o tutor continua funcionando
            log.exception("memória de erros desativada: falha ao conectar no banco")

    async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as http:
        app.state.llm = GroqClient(http, settings.groq_api_key, settings.groq_model)
        yield

    if warm_up:
        warm_up.cancel()
    if store:
        await store.close()


app = FastAPI(title="English Tutor API", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origin_list,
    allow_methods=["GET", "POST", "DELETE"],
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
    background: BackgroundTasks,
    user: User = Depends(enforce_rate_limit),
    llm: GroqClient = Depends(get_llm),
    memory: MistakeMemory | None = Depends(get_memory),
    settings: Settings = Depends(get_settings),
) -> TutorReply:
    """Avalia a última frase do aluno e continua a conversa."""
    last = body.messages[-1]
    if last.role != "user":
        raise HTTPException(422, "A última mensagem precisa ser do aluno.")
    if len(last.content) > MAX_USER_MESSAGE:
        raise HTTPException(422, f"Mensagem longa demais (máximo de {MAX_USER_MESSAGE} caracteres).")

    # RAG: erros antigos deste aluno parecidos com a frase nova entram no prompt
    recall = await memory.recall(user.uid, last.content) if memory else Recall()
    messages = build_chat_messages(
        body.level, body.messages, body.weak_spots, settings.max_history_messages, recall.mistakes
    )
    raw = await llm.complete(messages, max_tokens=1024)
    reply = parse_tutor_reply(raw)

    if memory and reply.feedback and reply.feedback.correction:
        # grava depois de responder: o aluno não espera pelo banco
        background.add_task(memory.remember, user.uid, last.content, reply.feedback, body.level, recall.embedding)
    return reply


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


@app.delete("/api/memory")
async def forget(
    user: User = Depends(get_current_user),
    memory: MistakeMemory | None = Depends(get_memory),
) -> dict[str, int]:
    """Apaga os erros guardados do usuário (usado quando ele zera o progresso no app)."""
    if memory is None:
        return {"deleted": 0}
    try:
        return {"deleted": await memory.forget(user.uid)}
    except Exception:
        log.exception("memória: falha ao apagar")
        raise HTTPException(503, "Não foi possível apagar a memória agora. Tente de novo.")
