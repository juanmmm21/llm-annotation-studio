import json
import os
import sys
from datetime import datetime
from typing import List, Optional
from fastapi import FastAPI, HTTPException, Depends
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import create_engine, Column, Integer, String, DateTime, ForeignKey, Text, event
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session

# Configuración del motor de Base de Datos relacional SQLite.
# Las llaves foráneas se fuerzan en la conexión para asegurar la integridad de datos.
DATABASE_URL = "sqlite:///./annotation.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})

@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


# =====================================================================
# MODELOS DE BASE DE DATOS (SQLAlchemy)
# =====================================================================

class ProjectDB(Base):
    """
    Representa un proyecto de anotacion.
    task_type puede ser: 'classification', 'rlhf' o 'ner'.
    labels contiene una cadena de etiquetas separadas por comas (ej: "PER,LOC,ORG").
    """
    __tablename__ = "projects"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    task_type = Column(String(50), nullable=False)
    labels = Column(Text, nullable=False, default="")


class TaskDB(Base):
    """
    Representa un item o tarea individual que debe ser anotada.
    """
    __tablename__ = "tasks"
    
    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    text = Column(Text, nullable=False)  # El texto a clasificar o el prompt del LLM
    response_a = Column(Text, nullable=True)  # Usado en RLHF
    response_b = Column(Text, nullable=True)  # Usado en RLHF
    status = Column(String(20), nullable=False, default="pending")  # 'pending', 'completed'


class AnnotationDB(Base):
    """
    Almacena el resultado del etiquetado de una tarea.
    """
    __tablename__ = "annotations"
    
    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, unique=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    
    # Campo para clasificacion
    user_label = Column(String(100), nullable=True)
    
    # Campos para RLHF/DPO
    selected_response = Column(String(10), nullable=True)  # 'A', 'B' o 'none'
    rating = Column(Integer, nullable=True)  # Valoracion en estrellas 1-5
    edited_response = Column(Text, nullable=True)  # Respuesta dorada editada por el humano
    
    # Campos para NER (guardado en formato JSON estructurado como string)
    ner_entities = Column(Text, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)

Base.metadata.create_all(bind=engine)


# =====================================================================
# CONEXIÓN CON EL TOKENIZER PROPIO (Interlinking)
# =====================================================================
# Agregamos la ruta local de bpe-tokenizer-from-scratch para reutilizar
# nuestro tokenizador nativo en la medicion de tokens en el frontend.
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "bpe-tokenizer-from-scratch")))

try:
    from tokenizer import BPETokenizer
    tokenizer_instance = BPETokenizer()
    # Entrenamos un vocabulario base basico para que tenga las reglas por defecto
    tokenizer_instance.train("El tokenizador propio de la infraestructura de IA.", vocab_size=260)
except ImportError:
    tokenizer_instance = None


# =====================================================================
# ESQUEMAS DE VALIDACIÓN DE ENTRADA/SALIDA (Pydantic)
# =====================================================================

class ProjectCreate(BaseModel):
    name: str
    task_type: str
    labels: str = ""


class TaskCreate(BaseModel):
    text: str
    response_a: Optional[str] = None
    response_b: Optional[str] = None


class ProjectImport(BaseModel):
    name: str
    task_type: str
    labels: str = ""
    tasks: List[TaskCreate]


class AnnotationCreate(BaseModel):
    user_label: Optional[str] = None
    selected_response: Optional[str] = None
    rating: Optional[int] = None
    edited_response: Optional[str] = None
    ner_entities: Optional[List[dict]] = None


class TokenizeRequest(BaseModel):
    text: str


# =====================================================================
# SERVIDOR FastAPI
# =====================================================================

app = FastAPI(title="LLM Annotation Studio", description="Plataforma de anotacion de datos de nivel de produccion")

# Dependencia para obtener la sesion de la base de datos
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# Servir la carpeta estatica para el Frontend SPA
# La ruta estatica se define despues de las APIs para no interceptar llamadas
# static_dir se crea si no existe
static_dir = os.path.join(os.path.dirname(__file__), "static")
if not os.path.exists(static_dir):
    os.makedirs(static_dir)

# Ruta base para servir la interfaz web
@app.get("/", response_class=HTMLResponse)
def read_index():
    index_path = os.path.join(static_dir, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse(
        content="<h2>LLM Annotation Studio</h2><p>El frontend se esta cargando o la carpeta static esta vacia.</p>"
    )


# =====================================================================
# ENDPOINTS DE API REST
# =====================================================================

@app.get("/api/projects")
def list_projects(db: Session = Depends(get_db)):
    projects = db.query(ProjectDB).all()
    return projects


@app.post("/api/projects")
def create_project(project: ProjectCreate, db: Session = Depends(get_db)):
    if project.task_type not in ("classification", "rlhf", "ner"):
        raise HTTPException(status_code=400, detail="Tipo de tarea no valido. Debe ser classification, rlhf o ner.")
        
    db_project = ProjectDB(
        name=project.name,
        task_type=project.task_type,
        labels=project.labels
    )
    db.add(db_project)
    db.commit()
    db.refresh(db_project)
    return db_project


@app.post("/api/projects/import")
def import_project(data: ProjectImport, db: Session = Depends(get_db)):
    if data.task_type not in ("classification", "rlhf", "ner"):
        raise HTTPException(status_code=400, detail="Tipo de tarea no valido.")
        
    db_project = ProjectDB(
        name=data.name,
        task_type=data.task_type,
        labels=data.labels
    )
    db.add(db_project)
    db.commit()
    db.refresh(db_project)
    
    for t in data.tasks:
        db_task = TaskDB(
            project_id=db_project.id,
            text=t.text,
            response_a=t.response_a,
            response_b=t.response_b,
            status="pending"
        )
        db.add(db_task)
        
    db.commit()
    return {"message": "Proyecto importado correctamente", "project_id": db_project.id, "tasks_loaded": len(data.tasks)}


@app.get("/api/projects/{project_id}/tasks/next")
def get_next_task(project_id: int, db: Session = Depends(get_db)):
    # Buscamos la primera tarea que este en estado pending
    task = db.query(TaskDB).filter(
        TaskDB.project_id == project_id,
        TaskDB.status == "pending"
    ).first()
    
    if not task:
        return {"message": "No quedan mas tareas pendientes de anotacion.", "task": None}
        
    return {"task": task}


@app.post("/api/tasks/{task_id}/annotations")
def save_annotation(task_id: int, anno: AnnotationCreate, db: Session = Depends(get_db)):
    task = db.query(TaskDB).filter(TaskDB.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Tarea no encontrada.")
        
    # Verificar si ya existe una anotacion para esta tarea y actualizarla,
    # o crear una nueva si no existe (upsert)
    existing_anno = db.query(AnnotationDB).filter(AnnotationDB.task_id == task_id).first()
    
    ner_str = json.dumps(anno.ner_entities) if anno.ner_entities is not None else None
    
    if existing_anno:
        existing_anno.user_label = anno.user_label
        existing_anno.selected_response = anno.selected_response
        existing_anno.rating = anno.rating
        existing_anno.edited_response = anno.edited_response
        existing_anno.ner_entities = ner_str
    else:
        new_anno = AnnotationDB(
            task_id=task_id,
            project_id=task.project_id,
            user_label=anno.user_label,
            selected_response=anno.selected_response,
            rating=anno.rating,
            edited_response=anno.edited_response,
            ner_entities=ner_str
        )
        db.add(new_anno)
        
    task.status = "completed"
    db.commit()
    return {"message": "Anotacion guardada con exito."}


@app.get("/api/projects/{project_id}/export")
def export_project_dataset(project_id: int, db: Session = Depends(get_db)):
    project = db.query(ProjectDB).filter(ProjectDB.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado.")
        
    # Consultamos las tareas y sus anotaciones
    tasks = db.query(TaskDB).filter(TaskDB.project_id == project_id).all()
    
    exported_data = []
    for t in tasks:
        # Obtenemos la anotacion correspondiente si existe
        anno = db.query(AnnotationDB).filter(AnnotationDB.task_id == t.id).first()
        
        anno_data = None
        if anno:
            ner_entities = None
            if anno.ner_entities:
                try:
                    ner_entities = json.loads(anno.ner_entities)
                except Exception:
                    ner_entities = anno.ner_entities
                    
            anno_data = {
                "user_label": anno.user_label,
                "selected_response": anno.selected_response,
                "rating": anno.rating,
                "edited_response": anno.edited_response,
                "ner_entities": ner_entities,
                "created_at": anno.created_at.isoformat() if anno.created_at else None
            }
            
        exported_data.append({
            "task_id": t.id,
            "text": t.text,
            "response_a": t.response_a,
            "response_b": t.response_b,
            "status": t.status,
            "annotation": anno_data
        })
        
    # Sanitizamos el nombre del proyecto para construir un nombre de archivo seguro
    safe_name = "".join(c for c in project.name if c.isalnum() or c in (" ", "_", "-")).strip().replace(" ", "_")
    filename = f"dataset_{safe_name}.json"
    
    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"'
    }
    
    content = {
        "project_id": project.id,
        "project_name": project.name,
        "task_type": project.task_type,
        "labels": project.labels.split(",") if project.labels else [],
        "dataset": exported_data
    }
    
    return JSONResponse(content=content, headers=headers)


@app.post("/api/tokenize")
def tokenize_text(req: TokenizeRequest):
    """
    Realiza la tokenizacion utilizando el BPETokenizer propio de la infraestructura.
    Devuelve los codigos resultantes y la cantidad de tokens.
    """
    if tokenizer_instance is None:
        # Fallback simple por caracteres/palabras si el tokenizer no esta disponible
        words = req.text.split()
        return {
            "tokens_count": len(words),
            "token_ids": [hash(w) for w in words],
            "fallback_used": True
        }
        
    try:
        ids = tokenizer_instance.encode(req.text)
        return {
            "tokens_count": len(ids),
            "token_ids": ids,
            "fallback_used": False
        }
    except Exception as e:
        return {
            "tokens_count": 0,
            "error": str(e),
            "fallback_used": True
        }

# Montamos la carpeta static para recursos adicionales si es necesario
app.mount("/static", StaticFiles(directory=static_dir), name="static")

if __name__ == "__main__":
    import uvicorn
    # Levantamos el servidor en el puerto 8000 por defecto
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
