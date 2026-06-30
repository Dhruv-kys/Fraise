"""Long-context ONNX encoder for late chunking.

`jina-embeddings-v2-small-en` (8192-token context, 512-dim) run directly through
onnxruntime — no torch. `encode_tokens` returns per-token hidden states plus the
character offsets of each token, which is what late chunking needs: we encode the
whole document once, then mean-pool token vectors within each chunk's span so every
chunk embedding carries full-document context. `encode_query` pools to one vector.

The session loads lazily and is reused; `warm()` triggers the download/load at
startup so the first `ask` doesn't pay for it.
"""
import threading

import numpy as np
import onnxruntime as ort
from huggingface_hub import hf_hub_download
from transformers import AutoTokenizer

_REPO = "jinaai/jina-embeddings-v2-small-en"
_MAX_TOKENS = 8192

_lock = threading.Lock()
_session: ort.InferenceSession | None = None
_tokenizer = None
_input_names: set[str] = set()


def _load() -> None:
    global _session, _tokenizer, _input_names
    if _session is not None:
        return
    with _lock:
        if _session is not None:
            return
        # Raw (non-pooled) ONNX: late chunking does its own per-span pooling.
        model_path = hf_hub_download(_REPO, "model.onnx")
        session = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
        _input_names = {i.name for i in session.get_inputs()}
        _tokenizer = AutoTokenizer.from_pretrained(_REPO)
        _session = session


def warm() -> None:
    _load()
    encode_query("warm up")


def _run(input_ids: np.ndarray, attention_mask: np.ndarray) -> np.ndarray:
    feeds = {"input_ids": input_ids, "attention_mask": attention_mask}
    if "token_type_ids" in _input_names:
        feeds["token_type_ids"] = np.zeros_like(input_ids)
    return _session.run(None, feeds)[0]  # (batch, seq, dim)


def encode_tokens(text: str) -> tuple[np.ndarray, list[tuple[int, int]]]:
    """Encode a full document, returning (token_vectors, char_offsets).

    Special tokens (offset (0, 0)) are dropped so spans map cleanly to substrings.
    """
    _load()
    enc = _tokenizer(
        text,
        return_offsets_mapping=True,
        truncation=True,
        max_length=_MAX_TOKENS,
        return_tensors="np",
    )
    hidden = _run(enc["input_ids"], enc["attention_mask"])[0]  # (seq, dim)
    offsets = enc["offset_mapping"][0]
    keep = [i for i, (a, b) in enumerate(offsets) if b > a]
    vectors = hidden[keep]
    spans = [(int(offsets[i][0]), int(offsets[i][1])) for i in keep]
    return vectors, spans


def encode_query(text: str) -> np.ndarray:
    _load()
    enc = _tokenizer(text, truncation=True, max_length=_MAX_TOKENS, return_tensors="np")
    hidden = _run(enc["input_ids"], enc["attention_mask"])[0]
    mask = enc["attention_mask"][0].astype(np.float32)
    return _normalize(_mean_pool(hidden, mask))


def _mean_pool(hidden: np.ndarray, mask: np.ndarray) -> np.ndarray:
    weighted = (hidden * mask[:, None]).sum(axis=0)
    return weighted / max(mask.sum(), 1.0)


def _normalize(vec: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(vec)
    return vec / norm if norm else vec


def pool_span(token_vectors: np.ndarray) -> np.ndarray:
    """Mean-pool the token vectors of one chunk into a normalized embedding."""
    return _normalize(token_vectors.mean(axis=0))
