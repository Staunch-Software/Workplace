"""Which Gemini model the extractor calls, and how to configure each call.

The model is a setting (GEMINI_MODEL) because Google retires and gates models on its own
schedule: in Oct 2026 new projects get a 404 "model not found" for gemini-2.5-flash, which
the code used to hardcode in six places. Every call goes through generate() so the model,
the thinking level and the token accounting are decided in one place.
"""
from app.config import get_settings
from app.services import gemini_usage

_THINKING_LEVELS = {"minimal", "low", "medium", "high"}


def gemini_model() -> str:
    return get_settings().GEMINI_MODEL.strip() or "gemini-2.5-flash"


def gemini_model_light() -> str:
    """Model for the simple calls (page layout, vessel name, boundary / value re-checks).
    Falls back to the main model when GEMINI_MODEL_LIGHT is not set."""
    return (get_settings().GEMINI_MODEL_LIGHT or "").strip() or gemini_model()


def _is_25(model: str) -> bool:
    return model.startswith("gemini-2.5")


def gemini_thinking_config(types, model: str | None = None):
    """Thinking control for a model.

    2.5 family: a zero budget switches thinking off. Newer families: thinking cannot always be
    switched off, but its LEVEL can be lowered (GEMINI_THINKING_LEVEL = minimal|low|medium|high);
    unset leaves the model default untouched. Thinking tokens are billed as output.
    """
    model = model or gemini_model()
    if _is_25(model):
        return types.ThinkingConfig(thinking_budget=0)
    level = (get_settings().GEMINI_THINKING_LEVEL or "").strip().lower()
    if level in _THINKING_LEVELS:
        return types.ThinkingConfig(thinking_level=level)
    return None


def gemini_max_output_tokens(base: int, model: str | None = None) -> int:
    """Output-token limit for a SMALL call (a few hundred tokens of JSON).

    On the 3.x models "thinking" tokens are counted against max_output_tokens, so a limit of
    500 is used up by thinking and the JSON comes back cut off ("Unterminated string ...").
    The 2.5 family has thinking switched off, so it keeps the original limit.
    """
    return base if _is_25(model or gemini_model()) else base + 8192


def create_prompt_cache(client, system_prompt: str, ttl_seconds: int = 1200) -> str | None:
    """Store the long, unchanging extraction instructions on Gemini's side once per upload, so each
    page call reuses them at the (much lower) cached-input price instead of re-sending ~11k tokens.

    Off unless GEMINI_PROMPT_CACHE is true. Returns the cache name, or None when caching is off or
    cannot be created (too few tokens, model without caching, API error) -- callers then simply send
    the instructions with every call as before. The TTL cleans up after a crashed upload.
    """
    import logging
    if not get_settings().GEMINI_PROMPT_CACHE:
        return None
    from google.genai import types
    try:
        cache = client.caches.create(
            model=gemini_model(),
            config=types.CreateCachedContentConfig(system_instruction=system_prompt, ttl=f"{ttl_seconds}s"),
        )
        return cache.name
    except Exception as e:
        logging.getLogger(__name__).warning("Prompt cache not created, sending instructions per call: %s", e)
        return None


def delete_prompt_cache(client, name: str | None) -> None:
    if not name:
        return
    try:
        client.caches.delete(name=name)
    except Exception:
        pass            # the TTL removes it anyway


def generate(client, kind: str, contents, *, light: bool = False, small_output: int | None = None, **config_kwargs):
    """One Gemini call: picks the model, applies thinking + output limits, records token usage.

    kind          label for the usage report ("extract", "stack_detect", ...)
    light         use GEMINI_MODEL_LIGHT (simple calls) instead of GEMINI_MODEL
    small_output  base max_output_tokens for a small JSON call (headroom added on 3.x models)
    """
    from google.genai import types

    model = gemini_model_light() if light else gemini_model()
    if small_output is not None:
        config_kwargs["max_output_tokens"] = gemini_max_output_tokens(small_output, model)
    thinking = gemini_thinking_config(types, model)
    if thinking is not None:
        config_kwargs["thinking_config"] = thinking
    response = client.models.generate_content(
        model=model, contents=contents, config=types.GenerateContentConfig(**config_kwargs),
    )
    gemini_usage.record(kind, model, response)
    return response
