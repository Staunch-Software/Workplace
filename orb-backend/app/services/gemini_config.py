"""Which Gemini model the extractor calls, and how to configure it.

The model is a setting (GEMINI_MODEL) because Google retires and gates models on its own
schedule: in Oct 2026 new projects get a 404 "model not found" for gemini-2.5-flash, which
the code used to hardcode in six places.
"""
from app.config import get_settings


def gemini_model() -> str:
    return get_settings().GEMINI_MODEL.strip() or "gemini-2.5-flash"


def gemini_thinking_config(types):
    """Switch "thinking" off where the model supports a zero budget (2.5 family).

    Newer model families use a different control, and some cannot disable thinking at
    all, so for them the model default is left untouched rather than risk a rejected request.
    """
    if gemini_model().startswith("gemini-2.5"):
        return types.ThinkingConfig(thinking_budget=0)
    return None
