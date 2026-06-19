# VoiceRAG 🎙️

> Real-time voice-driven RAG (Retrieval-Augmented Generation) assistant — speak a question, get a grounded answer from your own documents.

![Python](https://img.shields.io/badge/Python-3.10%2B-blue?logo=python)
![FastAPI](https://img.shields.io/badge/FastAPI-0.111-009688?logo=fastapi)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)
![LangChain](https://img.shields.io/badge/LangChain-0.2-green)
![FAISS](https://img.shields.io/badge/FAISS-cpu-orange)
![Whisper](https://img.shields.io/badge/Whisper-base-purple)
![Groq](https://img.shields.io/badge/Groq-llama3--8b-red)

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                       BROWSER (React)                        │
│                                                              │
│  ┌─────────────┐  ┌──────────────────┐  ┌───────────────┐  │
│  │ Upload Panel│  │  Mic Button      │  │  Chat Panel   │  │
│  │  (PDF/TXT)  │  │  (MediaRecorder) │  │  (SSE stream) │  │
│  └──────┬──────┘  └────────┬─────────┘  └───────┬───────┘  │
│         │                  │                     │           │
└─────────┼──────────────────┼─────────────────────┼──────────┘
          │ POST /upload      │ POST /transcribe     │ POST /query
          ▼                  ▼                     ▼
┌─────────────────────────────────────────────────────────────┐
│                    FastAPI Backend                           │
│                                                              │
│  ┌─────────────────────┐    ┌──────────────────────────┐   │
│  │  Document Ingestion │    │  Voice Transcription     │   │
│  │                     │    │                          │   │
│  │  PyPDFLoader /      │    │  Whisper (base)          │   │
│  │  TextLoader         │    │  (runs locally, no API)  │   │
│  │       ↓             │    └──────────────────────────┘   │
│  │  RecursiveText      │                                    │
│  │  Splitter           │    ┌──────────────────────────┐   │
│  │  (chunk=500,ov=50)  │    │  RAG Query Pipeline      │   │
│  │       ↓             │    │                          │   │
│  │  SentenceTransformer│    │  1. Embed question        │   │
│  │  (all-MiniLM-L6-v2) │    │  2. FAISS top-3 retrieve │   │
│  │       ↓             │    │  3. Score → similarity   │   │
│  │  FAISS IndexFlatL2  │◄───┤  4. Build prompt+context │   │
│  │  (in-memory)        │    │  5. Groq LLM (stream)    │   │
│  └─────────────────────┘    └──────────────────────────┘   │
│                                          │                   │
└──────────────────────────────────────────┼───────────────────┘
                                           │ SSE token stream
                                           ▼
                                    ┌──────────────┐
                                    │  Groq Cloud  │
                                    │  llama3-8b   │
                                    └──────────────┘
```

---

## How It Works — RAG Pipeline Step by Step

1. **Document Upload** — User uploads a PDF or TXT file. The backend loads it with `PyPDFLoader` / `TextLoader` and splits it into 500-character chunks (50-char overlap) using LangChain's `RecursiveCharacterTextSplitter`.

2. **Embedding** — Each chunk is encoded into a 384-dimensional dense vector using `sentence-transformers/all-MiniLM-L6-v2` (runs **entirely locally**, no API key needed). Vectors are L2-normalised so cosine similarity ≈ dot-product.

3. **FAISS Index** — All chunk embeddings are added to an in-memory `faiss.IndexFlatL2`. This supports exact nearest-neighbour search in milliseconds even for large documents.

4. **Voice Input** — User holds the mic button. The browser's `MediaRecorder` API captures audio as `audio/webm`. On release, the blob is sent to `POST /transcribe`. The backend writes it to a temp file and runs **OpenAI Whisper (base model)** locally. The transcript is returned and shown in an editable text box.

5. **Query** — The (possibly edited) question is sent to `POST /query`. The backend embeds it, searches FAISS for the top-3 most similar chunks, and converts L2 distances to cosine similarity scores.

6. **Fallback guard** — If all retrieved chunk scores are below **0.3**, the pipeline returns a fixed fallback: *"I couldn't find relevant information in the uploaded document."* — preventing hallucination.

7. **Prompt construction** — Relevant chunks are assembled into a context block, along with the last 4 conversation turns, and wrapped in a system prompt that instructs the model to answer strictly from context.

8. **LLM Streaming** — The Groq SDK streams token-by-token completions from `llama3-8b-8192`. The backend re-emits them as **Server-Sent Events (SSE)**. The React frontend reads the stream incrementally and renders each token as it arrives, giving a live "typing" effect.

9. **Confidence indicator** — The top retrieval score (0–1) is mapped to **High** (≥0.7) / **Medium** (≥0.45) / **Low** (<0.45) and displayed under each answer. Source chunks are shown in a collapsible panel.

---

## Setup

### Prerequisites
- Python 3.10+
- Node.js 18+
- `ffmpeg` installed and on PATH (required by Whisper for audio decoding)
  - Windows: `winget install Gyan.FFmpeg` or download from https://ffmpeg.org/download.html
  - Mac: `brew install ffmpeg`
  - Linux: `sudo apt install ffmpeg`

### 1. Get a free Groq API key

1. Go to https://console.groq.com/
2. Sign up (free) → **API Keys** → **Create API key**
3. Copy the key (starts with `gsk_…`)

### 2. Backend

```bash
cd voicerag/backend

# Create and activate a virtual environment
python -m venv .venv
# Windows:
.venv\Scripts\activate
# Mac/Linux:
source .venv/bin/activate

# Install dependencies (first run downloads Whisper & sentence-transformer models ~400 MB)
pip install -r requirements.txt

# Set Groq API key
# Windows PowerShell:
$env:GROQ_API_KEY = "gsk_your_key_here"
# Mac/Linux:
export GROQ_API_KEY="gsk_your_key_here"

# Start the server
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

The API will be live at **http://localhost:8000**. Open **http://localhost:8000/docs** for the interactive Swagger UI.

### 3. Frontend

```bash
cd voicerag/frontend

npm install
npm run dev
```

Open **http://localhost:3000** in your browser.

---

## Usage

1. **Upload a document** — drag-and-drop or click the upload area. Wait for the green *Ready* badge.
2. **Ask with voice** — hold the mic button, speak your question, release.
3. **Edit if needed** — the transcript appears in the text box; edit before sending.
4. **Read the answer** — it streams in word-by-word. Expand *Sources* to see the retrieved chunks and confidence.
5. **Continue chatting** — the last 5 exchanges are kept in the scrollable history.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GROQ_API_KEY` | ✅ Yes | Your Groq API key from console.groq.com |

---

## Screenshots

> _Screenshots placeholder — add your own after running the app._

| Upload & Ready | Voice Recording | Streaming Answer |
|---|---|---|
| _(screenshot)_ | _(screenshot)_ | _(screenshot)_ |

---

## Project Structure

```
voicerag/
├── backend/
│   ├── main.py           ← FastAPI app (all endpoints)
│   └── requirements.txt  ← Python dependencies
├── frontend/
│   ├── src/
│   │   ├── App.jsx       ← Complete React UI (single file)
│   │   ├── main.jsx      ← React entry point
│   │   └── index.css     ← Tailwind directives
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── postcss.config.js
└── README.md
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend framework | FastAPI + Uvicorn |
| Speech-to-text | OpenAI Whisper (base, local) |
| Embeddings | sentence-transformers/all-MiniLM-L6-v2 (local) |
| Vector store | FAISS IndexFlatL2 (in-memory) |
| RAG orchestration | LangChain (text splitting + loaders) |
| LLM | Groq — llama3-8b-8192 (free tier) |
| Frontend | React 18 + Vite |
| Styling | Tailwind CSS v3 |
| Icons | lucide-react |
| PDF parsing | PyPDF (via LangChain) |

---

## Troubleshooting

**`ffmpeg not found`** — Whisper needs ffmpeg. Install it and make sure it's on your PATH.

**`GROQ_API_KEY not set`** — The `/query` endpoint will return a 500 error. Set the env variable before starting the server.

**Mic button doesn't work** — Browsers require HTTPS or `localhost` for microphone access. Make sure you're on `http://localhost:3000`.

**`No module named 'whisper'`** — Install `openai-whisper` (not `whisper`): `pip install openai-whisper`.

**Slow first response** — Whisper and sentence-transformers models are downloaded on first startup (~400 MB total). Subsequent starts are instant.
