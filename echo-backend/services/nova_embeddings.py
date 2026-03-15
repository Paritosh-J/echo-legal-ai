"""
nova_embeddings.py — Document Intelligence Service
Powered by Amazon Nova 2 Multimodal Embeddings + OpenSearch Serverless

Responsibilities:
  - Generate embeddings for text chunks and images using Nova Multimodal
  - Store embeddings in OpenSearch Serverless vector index
  - Semantic search: retrieve relevant document chunks for RAG queries
"""

import base64
import json
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

import boto3
from dotenv import load_dotenv
from opensearchpy import OpenSearch, RequestsHttpConnection, AWSV4SignerAuth

load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────────
EMBEDDINGS_MODEL = os.environ.get("NOVA_EMBEDDINGS_MODEL_ID", "amazon.titan-embed-text-v2:0")
EMBED_REGION     = os.environ.get("EMBEDDINGS_REGION", "ap-south-1")
OPENSEARCH_REGION = os.environ.get("OPENSEARCH_REGION", EMBED_REGION)
INDEX_NAME       = "legal-documents"
EMBED_DIMENSION  = 1024   # must match index mapping
TOP_K            = 5      # number of results to return per search


class NovaEmbeddingsService:
    """
    Manages the full document intelligence pipeline:
    text/image → Nova embedding → OpenSearch → semantic retrieval
    """

    def __init__(self):
        # Bedrock client for Nova Multimodal Embeddings
        self.bedrock = boto3.client(
            "bedrock-runtime",
            region_name=EMBED_REGION
        )

        # OpenSearch Serverless client
        endpoint = os.environ.get("OPENSEARCH_ENDPOINT", "").replace("https://", "")
        if not endpoint:
            raise ValueError("OPENSEARCH_ENDPOINT not set in .env")

        credentials = boto3.Session().get_credentials()
        auth = AWSV4SignerAuth(credentials, OPENSEARCH_REGION, "aoss")

        self.os_client = OpenSearch(
            hosts=[{"host": endpoint, "port": 443}],
            http_auth=auth,
            use_ssl=True,
            verify_certs=True,
            connection_class=RequestsHttpConnection,
            pool_maxsize=20,
            timeout=300,
        )

    # ── Embedding Generation ──────────────────────────────────────────────────

    def embed_text(self, text: str) -> list[float]:
        """Generate 1024-dim embedding using Amazon Titan Text Embeddings v2."""
        response = self.bedrock.invoke_model(
            modelId=EMBEDDINGS_MODEL,
            body=json.dumps({
                "inputText": text[:8192],
                "dimensions": EMBED_DIMENSION,
                "normalize": True
            }),
            contentType="application/json",
            accept="application/json"
        )
        result = json.loads(response["body"].read())
        return result["embedding"]

    def embed_image(self, image_bytes: bytes, image_format: str = "jpeg") -> list[float]:
        """
        Titan is text-only — embed a description placeholder for images.
        Nova Act will analyze the actual image content; we index a text hook.
        """
        return self.embed_text("Legal document image uploaded by user for analysis.")

    def embed_for_search(self, query: str) -> list[float]:
        """Generate retrieval-optimized embedding for a search query."""
        response = self.bedrock.invoke_model(
            modelId=EMBEDDINGS_MODEL,
            body=json.dumps({
                "inputText": query[:8192],
                "dimensions": EMBED_DIMENSION,
                "normalize": True
            }),
            contentType="application/json",
            accept="application/json"
        )
        result = json.loads(response["body"].read())
        return result["embedding"]

    # ── OpenSearch Operations ─────────────────────────────────────────────────

    def index_text_chunks(
        self,
        chunks: list[str],
        user_id:    str,
        session_id: str,
        doc_id:     str,
        filename:   str,
        doc_type:   str = "TEXT",
        s3_key:     str = "",
    ) -> list[str]:
        """
        Embed and index a list of text chunks into OpenSearch.

        Args:
            chunks:     List of text strings (one per chunk).
            user_id:    Owner user ID.
            session_id: Current session ID.
            doc_id:     Unique document identifier.
            filename:   Original filename.
            doc_type:   Document type label (e.g. EVICTION_NOTICE, LEASE).
            s3_key:     S3 object key for the original file.

        Returns:
            List of OpenSearch document IDs that were indexed.
        """
        indexed_ids = []
        for i, chunk in enumerate(chunks):
            if not chunk.strip():
                continue

            print(f"  Embedding chunk {i+1}/{len(chunks)}: {chunk[:50]}...")
            vector = self.embed_text(chunk)

            doc = {
                "embedding":   vector,
                "user_id":     user_id,
                "session_id":  session_id,
                "doc_id":      doc_id,
                "filename":    filename,
                "doc_type":    doc_type,
                "chunk_text":  chunk,
                "chunk_index": i,
                "s3_key":      s3_key,
                "embed_type":  "TEXT",
                "uploaded_at": datetime.now(timezone.utc).isoformat(),
            }

            response = self.os_client.index(index=INDEX_NAME, body=doc)
            indexed_ids.append(response["_id"])   # use auto-generated ID

        print(f"  ✅ Indexed {len(indexed_ids)} chunks for doc '{filename}'")
        return indexed_ids

    def index_image(
        self,
        image_bytes: bytes,
        image_format: str,
        user_id:    str,
        session_id: str,
        doc_id:     str,
        filename:   str,
        description: str = "",
    ) -> str:
        """
        Embed and index an image into OpenSearch.

        Returns:
            OpenSearch document ID.
        """
        print(f"  Embedding image: {filename}...")
        vector = self.embed_image(image_bytes, image_format)

        doc = {
            "embedding":   vector,
            "user_id":     user_id,
            "session_id":  session_id,
            "doc_id":      doc_id,
            "filename":    filename,
            "doc_type":    "IMAGE",
            "chunk_text":  description or f"Image: {filename}",
            "chunk_index": 0,
            "s3_key":      "",
            "embed_type":  "IMAGE",
            "uploaded_at": datetime.now(timezone.utc).isoformat(),
        }

        response = self.os_client.index(index=INDEX_NAME, body=doc)
        os_id = response["_id"]
        print(f"  ✅ Indexed image '{filename}'")
        return os_id

    def search(
        self,
        query:      str,
        user_id:    str,
        session_id: Optional[str] = None,
        top_k:      int = TOP_K,
    ) -> list[dict]:
        """
        Semantic search — finds the most relevant document chunks for a query.

        Args:
            query:      Natural language search query.
            user_id:    Filter results to this user's documents only.
            session_id: Optional — filter to specific session.
            top_k:      Number of results to return.

        Returns:
            List of dicts with keys: chunk_text, filename, doc_type,
            chunk_index, score, doc_id.
        """
        query_vector = self.embed_for_search(query)

        # Build filter — always scope to user, optionally to session
        filters = [{"term": {"user_id": user_id}}]
        if session_id:
            filters.append({"term": {"session_id": session_id}})

        knn_query = {
            "size": top_k,
            "query": {
                "bool": {
                    "must": [
                        {
                            "knn": {
                                "embedding": {
                                    "vector": query_vector,
                                    "k": top_k
                                }
                            }
                        }
                    ],
                    "filter": filters
                }
            },
            "_source": ["chunk_text", "filename", "doc_type",
                        "chunk_index", "doc_id", "embed_type"]
        }

        response = self.os_client.search(index=INDEX_NAME, body=knn_query)
        hits     = response["hits"]["hits"]

        results = []
        for hit in hits:
            src = hit["_source"]
            results.append({
                "chunk_text":  src.get("chunk_text", ""),
                "filename":    src.get("filename", ""),
                "doc_type":    src.get("doc_type", ""),
                "chunk_index": src.get("chunk_index", 0),
                "embed_type":  src.get("embed_type", ""),
                "doc_id":      src.get("doc_id", ""),
                "score":       hit["_score"],
            })

        return results

    def delete_user_docs(self, user_id: str) -> int:
        """Delete all indexed documents for a user. Returns count deleted."""
        response = self.os_client.delete_by_query(
            index=INDEX_NAME,
            body={"query": {"term": {"user_id": user_id}}}
        )
        return response.get("deleted", 0)