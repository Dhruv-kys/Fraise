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
    return _normalize(token_vectors.mean(axis=0))
