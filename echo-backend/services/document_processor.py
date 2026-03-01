"""
document_processor.py — Document Text Extraction Service

Handles:
  - PDF text extraction (PyMuPDF / fitz)
  - Image preprocessing (Pillow)
  - Text chunking for optimal embedding
  - Nova 2 Lite document analysis (plain-language summary)
"""

import json
import os
import io
import uuid
from typing import Optional

import boto3
import fitz          # PyMuPDF
from PIL import Image
from dotenv import load_dotenv

load_dotenv()

REGION        = os.environ.get("AWS_DEFAULT_REGION", "us-east-1")
NOVA_LITE_ID  = os.environ.get("NOVA_LITE_MODEL_ID", "us.amazon.nova-2-lite-v1:0")
CHUNK_SIZE    = 800    # characters per chunk
CHUNK_OVERLAP = 100    # overlap between chunks to preserve context


class DocumentProcessor:
    """
    Extracts, chunks, and analyzes text from uploaded legal documents.
    """

    def __init__(self):
        self.bedrock = boto3.client("bedrock-runtime", region_name=REGION)

    # ── PDF Processing ────────────────────────────────────────────────────────
    def extract_text_from_pdf(self, pdf_bytes: bytes) -> tuple[str, list[str]]:
        """
        Extract full text from a PDF and split into chunks.

        Args:
            pdf_bytes: Raw PDF file bytes.

        Returns:
            Tuple of (full_text, chunks_list).
        """
        doc   = fitz.open(stream=pdf_bytes, filetype="pdf")
        pages = []
        for page in doc:
            pages.append(page.get_text())
        doc.close()

        full_text = "\n".join(pages)
        chunks    = self._chunk_text(full_text)
        return full_text, chunks

    # ── Image Processing ──────────────────────────────────────────────────────
    def process_image(
        self, image_bytes: bytes, filename: str
    ) -> tuple[bytes, str]:
        """
        Normalize an uploaded image for Nova Multimodal Embeddings.
        Resizes to max 2048x2048 and converts to JPEG.

        Args:
            image_bytes: Raw image bytes.
            filename:    Original filename (used to detect format).

        Returns:
            Tuple of (processed_jpeg_bytes, 'jpeg').
        """
        img = Image.open(io.BytesIO(image_bytes))

        # Convert RGBA or palette to RGB
        if img.mode in ("RGBA", "P", "LA"):
            img = img.convert("RGB")

        # Resize if too large — Nova Multimodal has size limits
        max_size = 2048
        if img.width > max_size or img.height > max_size:
            img.thumbnail((max_size, max_size), Image.LANCZOS)
            print(f"  Resized image to {img.width}x{img.height}")

        # Save as JPEG for consistent embedding
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=90)
        return buf.getvalue(), "jpeg"

    # ── Text Chunking ─────────────────────────────────────────────────────────
    def _chunk_text(self, text: str) -> list[str]:
        """
        Split text into overlapping chunks for embedding.
        Respects sentence boundaries where possible.
        """
        text   = text.strip()
        chunks = []
        start  = 0

        while start < len(text):
            end = start + CHUNK_SIZE

            # Try to break at a sentence boundary
            if end < len(text):
                for sep in [". ", ".\n", "\n\n", "\n"]:
                    boundary = text.rfind(sep, start, end)
                    if boundary > start:
                        end = boundary + len(sep)
                        break

            chunk = text[start:end].strip()
            if chunk:
                chunks.append(chunk)

            start = end - CHUNK_OVERLAP

        return chunks

    # ── Nova 2 Lite Document Analysis ─────────────────────────────────────────
    def analyze_document(
        self, text: str, doc_type_hint: str = "legal document"
    ) -> dict:
        """
        Use Nova 2 Lite to extract key legal facts from a document.

        Args:
            text:          Full document text (will be truncated if needed).
            doc_type_hint: What kind of document this is.

        Returns:
            Dict with: summary, key_dates, key_amounts, parties,
                       legal_issues, urgency_flags.
        """
        # Truncate to ~4000 chars for the prompt (leave room for instructions)
        excerpt = text[:4000] if len(text) > 4000 else text

        prompt = f"""
Analyze this {doc_type_hint} and extract key legal information.
Respond ONLY in this exact JSON format:

{{
  "document_type": "<EVICTION_NOTICE|LEASE_AGREEMENT|COURT_NOTICE|PAY_STUB|TERMINATION_LETTER|DEMAND_LETTER|OTHER>",
  "summary": "<2-3 sentence plain English summary>",
  "key_dates": ["<date and what it means>"],
  "key_amounts": ["<dollar amount and what it refers to>"],
  "parties": {{"sender": "<name or org>", "recipient": "<name or org>"}},
  "legal_issues": ["<potential legal issue identified>"],
  "urgency_flags": ["<any time-sensitive actions needed>"],
  "tenant_rights_violations": ["<any apparent legal violations, or NONE>"]
}}

Document text:
---
{excerpt}
---
"""

        response = self.bedrock.invoke_model(
            modelId=NOVA_LITE_ID,
            body=json.dumps({
                "messages": [{"role": "user", "content": [{"text": prompt}]}]
            }),
            contentType="application/json",
            accept="application/json"
        )

        result_text = json.loads(
            response["body"].read()
        )["output"]["message"]["content"][0]["text"]

        # Parse JSON from response
        try:
            # Strip markdown code fences if present
            clean = result_text.strip()
            if clean.startswith("```"):
                clean = clean.split("```")[1]
                if clean.startswith("json"):
                    clean = clean[4:]
            return json.loads(clean.strip())
        except Exception:
            return {
                "document_type": "OTHER",
                "summary": result_text[:500],
                "key_dates": [],
                "key_amounts": [],
                "parties": {},
                "legal_issues": [],
                "urgency_flags": [],
                "tenant_rights_violations": []
            }

    # ── RAG Context Builder ───────────────────────────────────────────────────
    def build_rag_context(self, search_results: list[dict]) -> str:
        """
        Format search results into a context string for Nova 2 Lite RAG.

        Args:
            search_results: Results from NovaEmbeddingsService.search().

        Returns:
            Formatted context string to inject into agent prompts.
        """
        if not search_results:
            return "No relevant documents found in user's uploaded files."

        context_parts = ["=== Relevant excerpts from user's uploaded documents ===\n"]
        for i, r in enumerate(search_results):
            context_parts.append(
                f"[Document {i+1}: {r['filename']} | {r['doc_type']} | "
                f"Relevance: {r['score']:.3f}]\n{r['chunk_text']}\n"
            )

        return "\n".join(context_parts)