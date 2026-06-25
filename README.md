# LLM Annotation Studio

Este subproyecto forma parte de la infraestructura modular de Inteligencia Artificial ai-core-infra. Implementa una plataforma web interactiva completa (Full-Stack local) para el etiquetado y anotación de datos orientada al entrenamiento de modelos de lenguaje, permitiendo flujos de trabajo eficientes para tareas clásicas de Procesamiento del Lenguaje Natural (PLN) y alineación con humanos (Human-in-the-Loop).

Para este sistema decidí desarrollar una aplicación de una sola página (SPA) que se conecta con un backend en FastAPI y una base de datos relacional SQLite para el almacenamiento estructurado y seguro de las anotaciones locales, facilitando la posterior exportación para el ajuste fino de modelos.

---

## Modos de Anotación Soportados

La interfaz permite alternar dinámicamente entre tres flujos de trabajo distintos según el proyecto:

1. **Clasificación de Texto:** Etiquetado categórico rápido de cadenas de texto para análisis de sentimiento, clasificación de intenciones o categorización temática de enunciados.
2. **Alineación Comparativa (RLHF/DPO):** Interfaz para comparar de manera visual dos respuestas generadas por diferentes versiones de un LLM (Respuesta A y Respuesta B). El anotador puede seleccionar su preferida, calificar la respuesta con estrellas (1-5) y editar el texto directamente en pantalla para consolidar la respuesta final dorada (Ground Truth).
3. **Reconocimiento de Entidades Nombradas (NER):** Anotador visual interactivo que permite al usuario seleccionar palabras directamente con el cursor del ratón sobre el texto de entrada y asociarles categorías específicas (como Persona, Organización, Ubicación). El sistema calcula los offsets absolutos de caracteres y destaca visualmente los fragmentos resaltados con colores diferenciados.

---

## Tecnologías Utilizadas

- **Backend:** Python 3.10+ con FastAPI para la API REST de alto rendimiento.
- **Base de Datos:** SQLAlchemy + SQLite local con forzado de claves foráneas para asegurar la integridad referencial y relacional del dataset.
- **Frontend:** SPA autocontenida desarrollada con HTML5 semántico, JavaScript moderno (con manipulación interactiva de rangos de selección DOM) y Vanilla CSS3, aplicando un diseño pulido en modo oscuro con gradientes sutiles.
- **Interlinking:** Integración con el tokenizador nativo [bpe-tokenizer-from-scratch](https://github.com/juanmmm21/bpe-tokenizer-from-scratch) para calcular estadísticas y desgloses de tokens en tiempo real sobre los textos anotados.

---

## Instalación y Uso

### 1. Clonar e Inicializar
Clona este repositorio en tu máquina local y accede al directorio del proyecto:
```bash
git clone https://github.com/juanmmm21/llm-annotation-studio.git
cd llm-annotation-studio
```

### 2. Instalar Dependencias
Se recomienda utilizar un entorno virtual de Python. Puedes instalar los requisitos del servidor web mediante:
```bash
pip install -r requirements.txt
```
*Nota: Para correr los tests unitarios automatizados del servidor, es útil tener instalado httpx (pip install httpx).*

### 3. Ejecutar el Servidor Web
Inicia el servidor uvicorn localmente:
```bash
python3 main.py
```
El servidor levantará en el puerto 8000. Accede desde tu navegador preferido a:
`http://127.0.0.1:8000`

### 4. Flujo de Trabajo e Importación
- Al iniciar la interfaz, puedes importar un proyecto y sus tareas asociadas haciendo clic en "Importar Proyecto".
- Introduce el nombre del proyecto, el tipo de tarea y las etiquetas separadas por comas.
- Pega el JSON con la lista de tareas en el cuadro de texto de acuerdo al formato especificado en el modal y haz clic en "Cargar Proyecto".
- Una vez finalizada la anotación, puedes exportar el dataset consolidado en formato JSON haciendo clic en "Exportar Dataset".

### 5. Ejecutar Pruebas Unitarias
El proyecto cuenta con cobertura de pruebas unitarias locales para validar el comportamiento del API y la base de datos relacional:
```bash
python3 -m unittest test_main.py
```

---

## Conexión con el Ecosistema ai-core-infra

El llm-annotation-studio actúa como el nodo de curación humana del ecosistema:
- Utiliza localmente el [bpe-tokenizer-from-scratch](https://github.com/juanmmm21/bpe-tokenizer-from-scratch) para medir y visualizar los identificadores de tokens de entrada.
- El dataset JSON estructurado y limpio exportado por este estudio sirve de alimentación directa para el pipeline de ajuste fino eficiente de [llm-qlora-finetuner](https://github.com/juanmmm21/llm-qlora-finetuner).
- Los datos anotados y curados también alimentan el arnés de evaluación automatizado de [llm-eval-harness](https://github.com/juanmmm21/llm-eval-harness) para medir regresiones en los modelos ajustados.
