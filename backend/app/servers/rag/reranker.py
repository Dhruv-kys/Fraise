"""Cross-encoder reranker over the fused candidate shortlist.

A bi-encoder (the dense embedder) scores query and passage separately; a
cross-encoder reads the pair together and is far more precise, but too slow to run
over a whole corpus — so it only rescores the ~30 candidates hybrid retrieval
already surfaced. `jina-reranker-v1-tiny-en` via fastembed is ONNX, no torch.
"""
import threading

from fastembed.rerank.cross_encoder import TextCrossEncoder

_MODEL = "jinaai/jina-reranker-v1-tiny-en"

_lock = threading.Lock()
_encoder: TextCrossEncoder | None = None

def _load() -> TextCrossEncoder:
    global _encoder
    if _encoder is None:
        with _lock:
            if _encoder is None:
                _encoder = TextCrossEncoder(model_name=_MODEL)
    return _encoder

def warm() -> None:
    rerank("warm up", ["warm up"])

def rerank(query: str, passages: list[str]) -> list[int]:
    """Return passage indices ordered best-first by cross-encoder relevance."""
    if not passages:
        return []
    scores = list(_load().rerank(query, passages))
    return sorted(range(len(passages)), key=lambda i: scores[i], reverse=True)
