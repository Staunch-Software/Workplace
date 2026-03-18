# app/__init__.py

# This ensures that all models are registered with SQLAlchemy's Base
# when the 'app' package is imported.
from . import models
from . import generator_models