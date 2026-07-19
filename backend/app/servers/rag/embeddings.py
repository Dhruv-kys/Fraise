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
_SEGMENT_TOKENS = 512
_MAX_DOC_TOKENS = 30000
_MAX_QUERY_TOKENS = 512

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
    return _session.run(None, feeds)[0]

def encode_tokens(text: str) -> tuple[np.ndarray, list[tuple[int, int]]]:
    """Encode a document into per-token vectors plus each token's char offsets.

    Tokenized once (no special tokens, so every position maps to a substring),
    then run through the encoder in `_SEGMENT_TOKENS` slices — each wrapped in
    CLS/SEP so the model sees a well-formed sequence — and the slice outputs are
    concatenated back into one per-token array aligned with the offsets.
    """
    _load()
    with _lock:
        enc = _tokenizer(
            text,
            return_offsets_mapping=True,
            truncation=True,
            max_length=_MAX_DOC_TOKENS,
            add_special_tokens=False,
            return_tensors="np",
        )
        ids = enc["input_ids"][0]
        offsets = enc["offset_mapping"][0]
        cls, sep = _tokenizer.cls_token_id, _tokenizer.sep_token_id

        parts = []
        for start in range(0, len(ids), _SEGMENT_TOKENS):
            seg = ids[start:start + _SEGMENT_TOKENS]
            wrapped = np.array([[cls, *seg, sep]], dtype=ids.dtype)
            hidden = _run(wrapped, np.ones_like(wrapped))[0]
            parts.append(hidden[1:-1])
        vectors = np.concatenate(parts, axis=0) if parts else np.zeros((0, 512), np.float32)

    spans = [(int(a), int(b)) for a, b in offsets]
    return vectors, spans

def encode_query(text: str) -> np.ndarray:
    _load()
    with _lock:
        enc = _tokenizer(text, truncation=True, max_length=_MAX_QUERY_TOKENS, return_tensors="np")
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
