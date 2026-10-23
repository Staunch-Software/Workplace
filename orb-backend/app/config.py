from functools import lru_cache
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_ENV_FILE, env_file_encoding="utf-8", extra="ignore")

    # ORB's own database (the existing standalone data lives here).
    DATABASE_URL: str
    # Workplace control database: users, vessels and permissions live here.
    # Required by the API (checked at startup); the cron scrapers do not need it.
    CONTROL_DATABASE_URL: str = ""
    # Must match workplace-backend: tokens are issued there and only verified here.
    SECRET_KEY: str = ""
    ALGORITHM: str = "HS256"
    ANTHROPIC_API_KEY: str = ""
    GEMINI_API_KEY: str = ""
    # Model used for every extraction / re-check call. Google gates older models for new
    # projects, so this must be changeable without a code release.
    GEMINI_MODEL: str = "gemini-2.5-flash"
    # Cheaper model for the simple calls (page layout, vessel name, boundary / value re-checks).
    # Empty = use GEMINI_MODEL for everything.
    GEMINI_MODEL_LIGHT: str = ""
    # Thinking level for non-2.5 models: minimal | low | medium | high. Empty = model default.
    # Thinking tokens are billed as output, so a lower level is the main cost lever.
    GEMINI_THINKING_LEVEL: str = ""
    # Cache the extraction instructions on Gemini's side for the duration of one upload (cheaper input).
    GEMINI_PROMPT_CACHE: bool = False
    # Prices (USD per 1M tokens) used ONLY for the per-upload cost estimate in the log.
    GEMINI_PRICE_IN_PER_M: float = 0.75
    GEMINI_PRICE_OUT_PER_M: float = 3.75
    GEMINI_LIGHT_PRICE_IN_PER_M: float = 0.0     # 0 = same as the main model
    GEMINI_LIGHT_PRICE_OUT_PER_M: float = 0.0
    GEMINI_USD_INR: float = 0.0                  # >0 also shows the estimate in rupees
    USE_MOCK_EXTRACTION: bool = True
    UPLOAD_DIR: str = "uploads"
    MAX_UPLOAD_SIZE_MB: int = 50
    # Folder containing poppler binaries (pdftoppm). Leave empty on Linux/VM so
    # pdf2image finds them on the system PATH (/usr/bin via poppler-utils).
    # On local Windows, set to e.g. C:\poppler\poppler-26.02.0\Library\bin
    POPPLER_PATH: str = ""
    # Comma-separated list of origins allowed to call the API (CORS).
    # Set the production workplace origin in .env.
    CORS_ORIGINS: str = "http://localhost:5173"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    # Opt-in TLS verification bypass for local networks behind an SSL-inspecting
    # proxy that breaks certificate validation. MUST stay False on the VM/prod.
    DISABLE_SSL_VERIFY: bool = False

    # Azure Blob Storage — stores IOPP tank certificate/survey documents.
    AZURE_STORAGE_CONNECTION_STRING: str = ""
    AZURE_STORAGE_CONTAINER: str = "iopp-documents"
    # Separate container for original ORB upload PDFs (preview feature).
    AZURE_STORAGE_ORB_CONTAINER: str = "orb-uploads"
    # Container for files attached to alert chat messages (falls back to UPLOAD_DIR/chat when Azure is not configured).
    AZURE_STORAGE_ORB_CHAT_CONTAINER: str = "orb-chat"
    # Largest file accepted as an alert chat attachment, enforced on the server.
    MAX_CHAT_ATTACHMENT_MB: int = 10

    # ── WNI Fuel Scraper (Check 7 support) ─────────────────────────────────
    # Separate, standalone scraper — see app/scrapers/wni_fuel_scraper.py.
    # Reuses the same WNI portal credentials as the existing historical
    # scraper; set these in .env (same values you already use there).
    WNI_LOGIN_URL: str = ""
    WNI_USERNAME: str = ""
    WNI_PASSWORD: str = ""
    # Path to the newline-delimited vessel name list used by the fuel
    # scraper. Defaults to a file named vessels.txt in the backend root.
    WNI_VESSELS_FILE: str = "vessels.txt"

    # ── Extraction debug dump ───────────────────────────────────────────────
    # When set, each ORB extraction run writes one subfolder per upload here
    # containing: every image actually sent to Gemini (post-split, exactly as
    # seen by the model), the raw JSON response for each page, and a
    # manifest.json recording each page's stacked-pair split decision
    # (page_count / split_y_fraction) and its final page_number. Without this,
    # diagnosing a specific page's failure means guessing where the real
    # split boundary landed -- this makes it exact instead. Empty (default)
    # disables the dump entirely; this is diagnostic-only and never read by
    # the extraction logic itself.
    EXTRACTION_DEBUG_DIR: str = ""

    # Max number of ORB PDF extractions allowed to run concurrently across the
    # whole process. convert_from_path() loads every page of a PDF into memory
    # at once and holds it for the entire job (which can run many minutes), so
    # two large multi-page uploads landing close together in the same worker
    # can push resident memory into the multi-GB range and trigger an OOM kill
    # (confirmed in production: a single worker hit ~9GB RSS processing two
    # concurrent uploads and was killed by the kernel). Keep this at 1 unless
    # the VM has memory headroom to spare.
    MAX_CONCURRENT_EXTRACTIONS: int = 1

    # ── Offline (vessel) sync ───────────────────────────────────────────────
    # The same code runs on the VM (online = shore) and on the vessel PC under C:\WORKPLACE (offline).
    # A vessel pushes its outbox to the VM and pulls what changed there; it never calls Gemini, runs
    # extraction or creates alerts (see app/services/sync_processor.py).
    STORAGE_MODE: str = "online"            # online | offline
    VESSEL_IMO: str = ""                    # offline only: which vessel this install belongs to
    SYNC_API_KEY: str = "change-me-in-production"   # same key on the VM and every vessel
    CLOUD_BASE_URL: str = "https://workplace.ozellar.com/orb"   # the VM's ORB root (offline only)
    CLOUD_HEALTH_URL: str = ""                  # empty = CLOUD_BASE_URL + "/health"
    NETWORK_TIMEOUT_SECONDS: float = 15.0
    SYNC_INTERVAL_SECONDS: int = 60
    SYNC_BATCH_SIZE: int = 50
    SYNC_PULL_PAGE_SIZE: int = 500
    MAX_SYNC_RETRIES: int = 5
    SYNC_VERIFY_TLS: bool = True
    # Azure account of the VM, used by the vessel to copy files (PDFs, chat attachments) up and down.
    # AZURE_STORAGE_CONNECTION_STRING is then the vessel's local Azurite.
    CLOUD_STORAGE_CONNECTION_STRING: str = ""

    @property
    def is_offline_vessel(self) -> bool:
        return self.STORAGE_MODE.strip().lower() == "offline"


@lru_cache
def get_settings() -> Settings:
    return Settings()