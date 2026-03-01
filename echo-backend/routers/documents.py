"""
documents.py — FastAPI router for document upload and semantic search
Handles: upload → extract → embed → index → search → RAG context
"""

import io
import uuid
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import APIRouter, UploadFile, File, HTTPException, Form
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from services.nova_embeddings    import NovaEmbeddingsService
from services.document_processor import DocumentProcessor

router = APIRouter(prefix="/documents", tags=["documents"])

# Lazy-initialize services (avoids cold-start errors at import)
_embeddings_svc  = None
_processor_svc   = None

ALLOWED_TYPES = {
    "application/pdf":  "pdf",
    "image/jpeg":       "jpeg",
    "image/jpg":        "jpeg",
    "image/png":        "png",
    "image/webp":       "jpeg",
}
MAX_FILE_SIZE = 10 * 1024 * 1024   # 10 MB


def get_embeddings():
    global _embeddings_svc
    if _embeddings_svc is None:
        _embeddings_svc = NovaEmbeddingsService()
    return _embeddings_svc


def get_processor():
    global _processor_svc
    if _processor_svc is None:
        _processor_svc = DocumentProcessor()
    return _processor_svc


# ── Request/Response models ────────────────────────────────────────────────────
class SearchRequest(BaseModel):
    query:      str
    user_id:    str
    session_id: str = ""
    top_k:      int = 5


class SearchResponse(BaseModel):
    results:        list[dict]
    rag_context:    str
    result_count:   int


class UploadResponse(BaseModel):
    doc_id:        str
    filename:      str
    doc_type:      str
    chunks_indexed:int
    analysis:      dict
    message:       str


# ── Upload endpoint ────────────────────────────────────────────────────────────
@router.post("/upload", response_model=UploadResponse)
async def upload_document(
    file:       UploadFile = File(...),
    user_id:    str = Form(...),
    session_id: str = Form(...),
):
    """
    Upload a legal document (PDF or image).
    Extracts text, generates Nova embeddings, indexes in OpenSearch.
    Returns document analysis from Nova 2 Lite.
    """
    # Validate file type
    content_type = file.content_type or ""
    if content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {content_type}. "
                   f"Allowed: PDF, JPEG, PNG, WebP"
        )

    # Read file
    file_bytes = await file.read()
    if len(file_bytes) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large ({len(file_bytes)//1024}KB). Max 10MB."
        )

    doc_id    = str(uuid.uuid4())
    filename  = file.filename or "document"
    file_ext  = ALLOWED_TYPES[content_type]
    emb_svc   = get_embeddings()
    proc_svc  = get_processor()

    print(f"\n[upload] Processing: {filename} ({content_type}) — {len(file_bytes)} bytes")

    try:
        # ── PDF Processing ─────────────────────────────────────────────────
        if file_ext == "pdf":
            full_text, chunks = proc_svc.extract_text_from_pdf(file_bytes)
            print(f"[upload] Extracted {len(chunks)} chunks from PDF")

            # Analyze with Nova 2 Lite
            analysis = proc_svc.analyze_document(full_text, "legal document")
            doc_type = analysis.get("document_type", "PDF")

            # Embed and index all chunks
            emb_svc.index_text_chunks(
                chunks=chunks,
                user_id=user_id,
                session_id=session_id,
                doc_id=doc_id,
                filename=filename,
                doc_type=doc_type,
            )
            chunks_indexed = len(chunks)

        # ── Image Processing ───────────────────────────────────────────────
        else:
            processed_bytes, img_format = proc_svc.process_image(file_bytes, filename)

            # Use Nova 2 Lite to describe the image first
            analysis = proc_svc.analyze_document(
                f"[Image file: {filename}] — This is a photo or scan of a legal document.",
                "image document"
            )
            doc_type    = analysis.get("document_type", "IMAGE")
            description = analysis.get("summary", f"Legal document image: {filename}")

            # Embed and index the image
            emb_svc.index_image(
                image_bytes=processed_bytes,
                image_format=img_format,
                user_id=user_id,
                session_id=session_id,
                doc_id=doc_id,
                filename=filename,
                description=description,
            )
            chunks_indexed = 1

        print(f"[upload] ✅ Done — doc_id: {doc_id} | type: {doc_type} | chunks: {chunks_indexed}")

        return UploadResponse(
            doc_id=doc_id,
            filename=filename,
            doc_type=doc_type,
            chunks_indexed=chunks_indexed,
            analysis=analysis,
            message=f"Successfully processed '{filename}'. "
                    f"Echo found: {analysis.get('summary', 'Document indexed.')}"
        )

    except Exception as e:
        print(f"[upload_err] {type(e).__name__}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ── Search endpoint ────────────────────────────────────────────────────────────
@router.post("/search", response_model=SearchResponse)
async def search_documents(req: SearchRequest):
    """
    Semantic search over user's uploaded documents.
    Returns relevant chunks + formatted RAG context for agent use.
    """
    try:
        emb_svc  = get_embeddings()
        proc_svc = get_processor()

        results = emb_svc.search(
            query=req.query,
            user_id=req.user_id,
            session_id=req.session_id or None,
            top_k=req.top_k,
        )

        rag_context = proc_svc.build_rag_context(results)

        return SearchResponse(
            results=results,
            rag_context=rag_context,
            result_count=len(results),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Delete endpoint ────────────────────────────────────────────────────────────
@router.delete("/user/{user_id}")
async def delete_user_documents(user_id: str):
    """Delete all indexed documents for a user."""
    try:
        emb_svc = get_embeddings()
        deleted = emb_svc.delete_user_docs(user_id)
        return {"deleted": deleted, "user_id": user_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Health ─────────────────────────────────────────────────────────────────────
@router.get("/health")
async def documents_health():
    return {"status": "ok", "service": "document-intelligence"}