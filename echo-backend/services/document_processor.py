"""
document_processor.py — Document Text Extraction + Analysis Service

Handles:
  - PDF text extraction (PyMuPDF / fitz)
  - Image preprocessing (Pillow)
  - Text chunking for optimal embedding
  - Nova Lite document analysis (plain-language legal summary)
"""

import json
import os
import io
from typing import Optional

import boto3
import fitz          # PyMuPDF
from PIL import Image
from dotenv import load_dotenv

# explicit path so dotenv works regardless of cwd ─────────────
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))          # …/echo-backend/services
_ENV_PATH = os.path.join(_THIS_DIR, "..", ".env")               # …/echo-backend/.env
load_dotenv(dotenv_path=_ENV_PATH, override=False)

# ── Model config — read after dotenv is loaded ────────────────────────────────
NOVA_LITE_ID     = os.environ.get("NOVA_LITE_MODEL_ID",  "apac.amazon.nova-lite-v1:0")
NOVA_LITE_REGION = os.environ.get("NOVA_LITE_REGION",    "ap-south-1")

# Print at import time so it's visible in server logs
print(f"[document_processor] model  : {NOVA_LITE_ID}")
print(f"[document_processor] region : {NOVA_LITE_REGION}")

CHUNK_SIZE    = 800    # characters per chunk
CHUNK_OVERLAP = 100    # overlap between consecutive chunks to preserve context


class DocumentProcessor:
    """
    Extracts, chunks, and analyzes text from uploaded legal documents.
    Uses Nova Lite (APAC) for intelligent legal analysis.
    """

    def __init__(self):
        # Always use the dedicated NOVA_LITE_REGION — not the default AWS region
        self.bedrock = boto3.client(
            "bedrock-runtime",
            region_name=NOVA_LITE_REGION
        )

    # ── PDF Extraction ────────────────────────────────────────────────────────
    def extract_text_from_pdf(self, pdf_bytes: bytes) -> tuple[str, list[str]]:
        """
        Extract full text from a PDF and split into overlapping chunks.

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

    # ── Image Preprocessing ───────────────────────────────────────────────────
    def process_image(self, image_bytes: bytes, filename: str) -> tuple[bytes, str]:
        """
        Normalize an uploaded image: convert to RGB JPEG, resize if needed.

        Args:
            image_bytes: Raw image bytes (any PIL-supported format).
            filename:    Original filename (used only for logging).

        Returns:
            Tuple of (processed_jpeg_bytes, 'jpeg').
        """
        img = Image.open(io.BytesIO(image_bytes))

        # Convert RGBA / palette modes to plain RGB
        if img.mode in ("RGBA", "P", "LA"):
            img = img.convert("RGB")

        # Resize if too large (Bedrock model limits)
        max_size = 2048
        if img.width > max_size or img.height > max_size:
            img.thumbnail((max_size, max_size), Image.LANCZOS)
            print(f"[processor] Resized image to {img.width}x{img.height}")

        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=90)
        return buf.getvalue(), "jpeg"

    # ── Text Chunking ─────────────────────────────────────────────────────────
    def _chunk_text(self, text: str) -> list[str]:
        """
        Split text into overlapping chunks, respecting sentence boundaries.
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

    # ── Nova Lite Document Analysis ───────────────────────────────────────────
    def analyze_document(
        self, text: str, doc_type_hint: str = "legal document"
    ) -> dict:
        """
        Use Nova Lite to extract key legal facts from a document.

        Args:
            text:          Full document text (truncated to 4000 chars).
            doc_type_hint: Hint about what kind of document this is.

        Returns:
            Dict with: document_type, summary, key_dates, key_amounts,
                       parties, legal_issues, urgency_flags,
                       tenant_rights_violations.
        """
        excerpt = text[:4000] if len(text) > 4000 else text

        prompt = f"""Analyze this {doc_type_hint} and extract key legal information.
Respond ONLY in this exact JSON format — no extra text, no markdown fences:

{{
  "document_type": "<EVICTION_NOTICE|LEASE_AGREEMENT|COURT_NOTICE|PAY_STUB|TERMINATION_LETTER|DEMAND_LETTER|OTHER>",
  "summary": "<2-3 sentence plain English summary of what this document is and what action is required>",
  "key_dates": ["<date and its significance>"],
  "key_amounts": ["<amount and what it refers to>"],
  "parties": {{"sender": "<name or organization>", "recipient": "<name or organization>"}},
  "legal_issues": ["<potential legal issue identified>"],
  "urgency_flags": ["<time-sensitive action needed, e.g. respond within 3 days>"],
  "tenant_rights_violations": ["<apparent legal violation, or NONE if none found>"]
}}

Document text:
---
{excerpt}
---"""

        try:
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

            return self._parse_json_response(result_text)

        except Exception as e:
            print(f"[processor] analyze_document error: {type(e).__name__}: {e}")
            # Return a safe fallback so upload still succeeds even if analysis fails
            return {
                "document_type": "OTHER",
                "summary": (
                    f"Document uploaded successfully. "
                    f"Analysis unavailable: {str(e)[:200]}"
                ),
                "key_dates":   [],
                "key_amounts": [],
                "parties":     {},
                "legal_issues":              [],
                "urgency_flags":             [],
                "tenant_rights_violations":  [],
            }

    def _parse_json_response(self, raw: str) -> dict:
        """
        Safely parse JSON from Nova Lite's response.
        Handles markdown code fences and partial responses.
        """
        text = raw.strip()

        # Strip ```json ... ``` or ``` ... ``` fences
        if text.startswith("```"):
            lines = text.split("\n")
            # Remove first line (```json or ```) and last line (```)
            inner = lines[1:] if lines[0].startswith("```") else lines
            if inner and inner[-1].strip() == "```":
                inner = inner[:-1]
            text = "\n".join(inner).strip()

        try:
            return json.loads(text)
        except json.JSONDecodeError:
            # Try to extract just the JSON object if there's surrounding text
            start = text.find("{")
            end   = text.rfind("}") + 1
            if start >= 0 and end > start:
                try:
                    return json.loads(text[start:end])
                except json.JSONDecodeError:
                    pass

            # Final fallback
            return {
                "document_type": "OTHER",
                "summary": raw[:500],
                "key_dates":                 [],
                "key_amounts":               [],
                "parties":                   {},
                "legal_issues":              [],
                "urgency_flags":             [],
                "tenant_rights_violations":  [],
            }

    # ── RAG Context Builder ───────────────────────────────────────────────────
    def build_rag_context(self, search_results: list[dict]) -> str:
        """
        Format semantic search results into a context block for agent prompts.

        Args:
            search_results: Results from NovaEmbeddingsService.search().

        Returns:
            Formatted string ready to inject into a Nova Lite prompt.
        """
        if not search_results:
            return "No relevant documents found in user's uploaded files."

        parts = ["=== Relevant excerpts from user's uploaded documents ===\n"]
        for i, r in enumerate(search_results):
            parts.append(
                f"[Document {i+1}: {r['filename']} | Type: {r['doc_type']} | "
                f"Relevance: {r['score']:.3f}]\n{r['chunk_text']}\n"
            )

        return "\n".join(parts)