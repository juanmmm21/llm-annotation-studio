"""Compatibilidad: el código vive en el paquete `llm_annotation_studio`. Este módulo se
conserva para quien añade esta carpeta a `sys.path` e importa `main`
directamente."""

from llm_annotation_studio.main import *  # noqa: F401,F403
from llm_annotation_studio.main import app, Base, get_db  # noqa: F401
