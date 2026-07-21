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
    if not passages:
        return []
    scores = list(_load().rerank(query, passages))
    return sorted(range(len(passages)), key=lambda i: scores[i], reverse=True)
