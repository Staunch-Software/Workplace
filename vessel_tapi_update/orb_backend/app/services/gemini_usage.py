"""Token usage and estimated cost of the Gemini calls made for one upload.

Collection is per upload via a ContextVar: asyncio.to_thread() copies the context, so calls made
inside worker threads report to the collector of the upload that started them.
"""
import threading
from contextvars import ContextVar

from app.config import get_settings


class UsageCollector:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.by_kind: dict[str, dict] = {}

    def add(self, kind: str, model: str, usage) -> None:
        def n(name: str) -> int:
            v = getattr(usage, name, None)
            return int(v) if isinstance(v, (int, float)) else 0

        with self._lock:
            row = self.by_kind.setdefault(kind, {"model": model, "calls": 0, "input": 0, "cached": 0, "output": 0, "thinking": 0})
            row["calls"] += 1
            row["input"] += n("prompt_token_count")
            row["cached"] += n("cached_content_token_count")
            row["output"] += n("candidates_token_count")
            row["thinking"] += n("thoughts_token_count")

    def summary(self) -> dict:
        s = get_settings()
        main_in, main_out = s.GEMINI_PRICE_IN_PER_M, s.GEMINI_PRICE_OUT_PER_M
        light_in = s.GEMINI_LIGHT_PRICE_IN_PER_M or main_in
        light_out = s.GEMINI_LIGHT_PRICE_OUT_PER_M or main_out
        light_model = (s.GEMINI_MODEL_LIGHT or "").strip()
        total = {"calls": 0, "input": 0, "cached": 0, "output": 0, "thinking": 0, "usd": 0.0}
        kinds = {}
        for kind, r in self.by_kind.items():
            pin, pout = (light_in, light_out) if (light_model and r["model"] == light_model and light_model != s.GEMINI_MODEL) else (main_in, main_out)
            # cached input is billed at a fraction of the input price; 25% is used as an estimate
            billable = max(r["input"] - r["cached"], 0)
            usd = (billable * pin + r["cached"] * pin * 0.25 + (r["output"] + r["thinking"]) * pout) / 1_000_000
            kinds[kind] = {**r, "usd": round(usd, 4)}
            for k in ("calls", "input", "cached", "output", "thinking"):
                total[k] += r[k]
            total["usd"] += usd
        total["usd"] = round(total["usd"], 4)
        if s.GEMINI_USD_INR:
            total["inr"] = round(total["usd"] * s.GEMINI_USD_INR, 2)
        return {"total": total, "by_kind": kinds}

    def describe(self) -> str:
        s = self.summary()
        t = s["total"]
        head = (f"{t['calls']} calls, input {t['input']:,} (cached {t['cached']:,}), output {t['output']:,}, "
                f"thinking {t['thinking']:,}, est. ${t['usd']:.2f}" + (f" (~Rs {t['inr']:.0f})" if "inr" in t else ""))
        lines = [f"  {k:16} {r['calls']:>4} calls  in {r['input']:>9,} (cached {r['cached']:>9,})  out {r['output']:>8,}  "
                 f"think {r['thinking']:>8,}  ${r['usd']:.3f}  [{r['model']}]" for k, r in sorted(s["by_kind"].items())]
        return head + ("\n" + "\n".join(lines) if lines else "")


_current: ContextVar["UsageCollector | None"] = ContextVar("gemini_usage_collector", default=None)


def start_collection() -> UsageCollector:
    c = UsageCollector()
    _current.set(c)
    return c


def record(kind: str, model: str, response) -> None:
    c = _current.get()
    if c is None:
        return
    try:
        c.add(kind, model, getattr(response, "usage_metadata", None))
    except Exception:
        pass            # accounting must never break an extraction
