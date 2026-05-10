"""
VoiceRAG Backend — FastAPI
Endpoints:
  POST /upload     — Chunk & embed a PDF or TXT file into FAISS
  POST /transcribe — Transcribe audio blob with Whisper (local)
  POST /query      — RAG query → Groq LLM, streamed response
  GET  /health     — Liveness check
"""
import os
import io
import json
import tempfile
import logging
from typing import AsyncGenerator, List

import whisper
import faiss
import numpy as np
from groq import Groq
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.document_loaders import PyPDFLoader, TextLoader
from sentence_transformers import SentenceTransformer

# ---------------------------------------------------------------------------
# App & CORS
# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="VoiceRAG API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Global state (in-memory)
# ---------------------------------------------------------------------------
class RAGState:
    def __init__(self):
        self.faiss_index: faiss.IndexFlatL2 | None = None
        self.chunks: List[str] = []
        self.embedder: SentenceTransformer | None = None
        self.whisper_model: whisper.Whisper | None = None
        self.dim: int = 384  # all-MiniLM-L6-v2 output dim

rag = RAGState()

# ---------------------------------------------------------------------------
# Startup: load models once
# ---------------------------------------------------------------------------
@app.on_event("startup")
async def load_models():
    logger.info("Loading sentence-transformer embedding model …")
    rag.embedder = SentenceTransformer("all-MiniLM-L6-v2")
    logger.info("Loading Whisper base model …")
    rag.whisper_model = whisper.load_model("base")
    logger.info("All models loaded. VoiceRAG ready.")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _build_faiss_index(embeddings: np.ndarray) -> faiss.IndexFlatL2:
    dim = embeddings.shape[1]
    index = faiss.IndexFlatL2(dim)
    index.add(embeddings.astype(np.float32))
    return index


def _embed(texts: List[str]) -> np.ndarray:
    """Return L2-normalised embeddings so cosine ≈ dot-product."""
    vecs = rag.embedder.encode(texts, normalize_embeddings=True, show_progress_bar=False)
    return vecs.astype(np.float32)


def _l2_to_similarity(l2_squared: float) -> float:
    """Convert FAISS squared-L2 distance of normalised vectors to cosine similarity [0,1].
    FAISS IndexFlatL2 returns d² (squared distance), NOT d.
    For unit vectors: cos_sim = 1 - d²/2
    """
    cos_sim = 1.0 - l2_squared / 2.0
    return float(np.clip(cos_sim, 0.0, 1.0))

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class QueryRequest(BaseModel):
    question: str
    chat_history: List[dict] = []

# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

# -- Health ------------------------------------------------------------------
@app.get("/health")
async def health():
    return {"status": "ok"}


# -- Upload ------------------------------------------------------------------
@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    """Accept PDF or TXT, chunk, embed, store in FAISS."""
    filename = file.filename or ""
    ext = os.path.splitext(filename)[1].lower()
    if ext not in (".pdf", ".txt"):
        raise HTTPException(status_code=400, detail="Only PDF and TXT files are supported.")

    contents = await file.read()

    try:
        # Write to a temp file so loaders can open it by path
        suffix = ext
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(contents)
            tmp_path = tmp.name

        if ext == ".pdf":
            loader = PyPDFLoader(tmp_path)
        else:
            loader = TextLoader(tmp_path, encoding="utf-8")

        docs = loader.load()
        full_text = "\n\n".join(d.page_content for d in docs)
    except Exception as e:
        logger.error("File loading failed: %s", e)
        raise HTTPException(status_code=500, detail=f"Failed to parse file: {e}")
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass

    # Chunk
    splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=50)
    chunks = splitter.split_text(full_text)
    if not chunks:
        raise HTTPException(status_code=400, detail="Document appears to be empty.")

    logger.info("Chunked into %d pieces. Embedding …", len(chunks))

    # Embed & build index
    try:
        embeddings = _embed(chunks)
        rag.faiss_index = _build_faiss_index(embeddings)
        rag.chunks = chunks
    except Exception as e:
        logger.error("Embedding/indexing failed: %s", e)
        raise HTTPException(status_code=500, detail=f"Indexing failed: {e}")

    logger.info("FAISS index built with %d vectors.", rag.faiss_index.ntotal)
    return {
        "status": "indexed",
        "filename": filename,
        "chunks": len(chunks),
    }


# -- Transcribe --------------------------------------------------------------
@app.post("/transcribe")
async def transcribe_audio(audio: UploadFile = File(...)):
    """Run Whisper on the uploaded audio blob and return transcript."""
    if rag.whisper_model is None:
        raise HTTPException(status_code=503, detail="Whisper model not loaded yet.")

    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file.")

    suffix = ".webm"
    content_type = audio.content_type or ""
    if "wav" in content_type:
        suffix = ".wav"
    elif "ogg" in content_type:
        suffix = ".ogg"
    elif "mp4" in content_type or "m4a" in content_type:
        suffix = ".mp4"

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        result = rag.whisper_model.transcribe(tmp_path, fp16=False)
        transcript = result.get("text", "").strip()
    except Exception as e:
        logger.error("Whisper transcription failed: %s", e)
        raise HTTPException(status_code=500, detail=f"Transcription failed: {e}")
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass

    return {"transcript": transcript}


# -- Query (streamed) --------------------------------------------------------
@app.post("/query")
async def query_rag(req: QueryRequest):
    """Retrieve context from FAISS, ask Groq LLM, stream the answer."""
    if rag.faiss_index is None or not rag.chunks:
        raise HTTPException(status_code=400, detail="No knowledge base uploaded yet.")

    groq_api_key = os.environ.get("GROQ_API_KEY", "")
    if not groq_api_key:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY environment variable not set.")

    question = req.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question must not be empty.")

    # Retrieve top-3 chunks
    q_vec = _embed([question])
    k = min(3, rag.faiss_index.ntotal)
    distances, indices = rag.faiss_index.search(q_vec, k)

    retrieved = []
    for dist, idx in zip(distances[0], indices[0]):
        sim = _l2_to_similarity(float(dist))
        retrieved.append({
            "chunk": rag.chunks[idx],
            "score": round(sim, 4),
        })

    logger.info("Retrieved %d chunks. Top score: %.3f", len(retrieved), retrieved[0]["score"] if retrieved else 0)

    # Fallback if no chunk is relevant enough
    if all(r["score"] < 0.15 for r in retrieved):
        async def fallback_stream() -> AsyncGenerator[str, None]:
            payload = {
                "type": "fallback",
                "content": "I couldn't find relevant information in the uploaded document.",
                "sources": [],
            }
            yield f"data: {json.dumps(payload)}\n\n"
            yield "data: [DONE]\n\n"
        return StreamingResponse(fallback_stream(), media_type="text/event-stream")

    # Build prompt
    context_blocks = "\n\n---\n\n".join(
        f"[Source {i+1}] (relevance: {r['score']:.2f})\n{r['chunk']}"
        for i, r in enumerate(retrieved)
    )
    history_text = ""
    for turn in req.chat_history[-4:]:  # last 4 turns for context
        role = turn.get("role", "user")
        content = turn.get("content", "")
        history_text += f"{role.capitalize()}: {content}\n"

    system_prompt = (
        "You are VoiceRAG, an intelligent assistant that answers questions "
        "strictly based on the provided document context. "
        "If the context is insufficient, say so clearly. "
        "Be concise and accurate."
    )

    user_message = (
        f"Context from the knowledge base:\n\n{context_blocks}\n\n"
        + (f"Conversation so far:\n{history_text}\n" if history_text else "")
        + f"Question: {question}"
    )

    # Stream from Groq
    async def groq_stream() -> AsyncGenerator[str, None]:
        try:
            client = Groq(api_key=groq_api_key)
            # First, emit source metadata
            sources_payload = {
                "type": "sources",
                "sources": retrieved,
            }
            yield f"data: {json.dumps(sources_payload)}\n\n"

            stream = client.chat.completions.create(
                model="llama3-8b-8192",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message},
                ],
                stream=True,
                max_tokens=1024,
                temperature=0.3,
            )
            for chunk in stream:
                delta = chunk.choices[0].delta
                if delta and delta.content:
                    token_payload = {"type": "token", "content": delta.content}
                    yield f"data: {json.dumps(token_payload)}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            logger.error("Groq streaming error: %s", e)
            error_payload = {"type": "error", "content": str(e)}
            yield f"data: {json.dumps(error_payload)}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(groq_stream(), media_type="text/event-stream")
