import os
import unittest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import sessionmaker

# Configuramos una base de datos SQLite en memoria para tests aislados
from main import Base, app, get_db

DATABASE_URL = "sqlite:///:memory:"
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Reemplazamos la dependencia de base de datos de FastAPI por la de pruebas en memoria
def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db

class TestLLMAnnotationStudio(unittest.TestCase):
    """
    Conjunto de pruebas para verificar la API REST del LLM Annotation Studio.
    """

    def setUp(self) -> None:
        # Inicializamos las tablas de base de datos antes de cada test
        Base.metadata.create_all(bind=engine)
        self.client = TestClient(app)

    def tearDown(self) -> None:
        # Destruimos las tablas después de cada test
        Base.metadata.drop_all(bind=engine)

    def test_create_project(self) -> None:
        """
        Prueba la creación de un nuevo proyecto a través de la API.
        """
        payload = {
            "name": "Clasificacion de Sentimiento",
            "task_type": "classification",
            "labels": "positivo,negativo,neutro"
        }
        response = self.client.post("/api/projects", json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["name"], "Clasificacion de Sentimiento")
        self.assertEqual(data["task_type"], "classification")
        self.assertIn("id", data)

    def test_import_project_with_tasks(self) -> None:
        """
        Prueba la importación completa de un proyecto y su lista de tareas asociadas.
        """
        payload = {
            "name": "Alineacion DPO",
            "task_type": "rlhf",
            "labels": "",
            "tasks": [
                {
                    "text": "Escribe un poema",
                    "response_a": "Poema corto A",
                    "response_b": "Poema corto B"
                },
                {
                    "text": "Dame una receta",
                    "response_a": "Receta A",
                    "response_b": "Receta B"
                }
            ]
        }
        response = self.client.post("/api/projects/import", json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["tasks_loaded"], 2)
        self.assertIn("project_id", data)

    def test_get_next_task_and_save_annotation(self) -> None:
        """
        Prueba el flujo de obtener la siguiente tarea pendiente,
        anotarla y verificar que cambie su estado a completada.
        """
        # 1. Creamos un proyecto con una tarea mediante la API
        import_payload = {
            "name": "Proyecto NER",
            "task_type": "ner",
            "labels": "PER,LOC",
            "tasks": [
                {"text": "Juan vive en Madrid."}
            ]
        }
        import_resp = self.client.post("/api/projects/import", json=import_payload)
        project_id = import_resp.json()["project_id"]

        # 2. Obtenemos la siguiente tarea
        next_resp = self.client.get(f"/api/projects/{project_id}/tasks/next")
        self.assertEqual(next_resp.status_code, 200)
        task_data = next_resp.json()["task"]
        self.assertIsNotNone(task_data)
        self.assertEqual(task_data["text"], "Juan vive en Madrid.")
        task_id = task_data["id"]

        # 3. Guardamos una anotación de entidades NER
        annotation_payload = {
            "ner_entities": [
                {"start": 0, "end": 4, "label": "PER", "text": "Juan"},
                {"start": 13, "end": 19, "label": "LOC", "text": "Madrid"}
            ]
        }
        anno_resp = self.client.post(f"/api/tasks/{task_id}/annotations", json=annotation_payload)
        self.assertEqual(anno_resp.status_code, 200)

        # 4. Verificamos que no queden más tareas pendientes
        next_resp_2 = self.client.get(f"/api/projects/{project_id}/tasks/next")
        self.assertIsNone(next_resp_2.json()["task"])

        # 5. Exportamos el dataset y verificamos que contenga la anotación guardada
        export_resp = self.client.get(f"/api/projects/{project_id}/export")
        self.assertEqual(export_resp.status_code, 200)
        export_data = export_resp.json()
        self.assertEqual(len(export_data["dataset"]), 1)
        
        saved_anno = export_data["dataset"][0]["annotation"]
        self.assertIsNotNone(saved_anno)
        self.assertEqual(len(saved_anno["ner_entities"]), 2)
        self.assertEqual(saved_anno["ner_entities"][0]["text"], "Juan")

    def test_tokenize_endpoint(self) -> None:
        """
        Prueba que el endpoint de tokenización devuelva resultados estructurados.
        """
        payload = {"text": "Hola mundo desde FastAPI"}
        response = self.client.post("/api/tokenize", json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("tokens_count", data)
        self.assertIn("token_ids", data)
        self.assertTrue(data["tokens_count"] > 0)

if __name__ == "__main__":
    unittest.main()
