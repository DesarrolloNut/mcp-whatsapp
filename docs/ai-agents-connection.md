# Guía de Conexión de Agentes de IA a WhatsApp (Vinculación 1:1 y Acumulador Debounce)

El módulo de **Agentes de IA** de **MCP WhatsApp Gateway** permite transformar cualquier línea de WhatsApp conectada en un asistente inteligente automatizado (usando frameworks como FastAPI, LangChain, LangGraph, Dify, OpenAI, Claude o n8n).

A diferencia de los webhooks de auditoría pasivos, este conector establece un **canal bidireccional conversacional** donde el gateway recibe los mensajes de WhatsApp, acumula los textos consecutivos del usuario para evitar respuestas fragmentadas, simula el estado *"escribiendo..."*, y entrega la respuesta final consolidada de la IA de vuelta a WhatsApp.

---

## 1. Reglas Fundamentales de Funcionamiento

### 1.1. Regla de Oro: Relación 1:1 Estricta por Línea Telefónica
* **Solo puede existir un único Agente de IA vinculado por línea telefónica.**
* Dos agentes no pueden responder simultáneamente al mismo cliente en la misma línea.
* El sistema y la base de datos (`agent_bindings.channel_id UNIQUE`) protegen activamente esta regla: el panel solo muestra líneas libres y cualquier intento de vincular una línea ya ocupada es rechazado.

### 1.2. Acumulador de Mensajes Consecutivos (Debounce por Inactividad)
Los usuarios humanos en WhatsApp suelen escribir en ráfagas de mensajes cortos:
```text
Usuario: "Hola"              (0.0s)
Usuario: "¿Tienen stock de X?" (0.7s)
Usuario: "Y a qué precio?"     (1.2s)
```
* Si el gateway enviara cada mensaje de inmediato, el agente respondería 3 veces, generaría costos innecesarios y daría una experiencia antinatural.
* El gateway implementa un **temporizador de silencio / inactividad (Trailing Debounce)** configurable (por defecto **1500 ms / 1.5s**).
* Cada mensaje recibido en la ráfaga reinicia el temporizador. Al transcurrir 1.5s sin nuevos mensajes, todos los textos se unen con saltos de línea (`\n`) y se envían en una única petición al agente.
* **Control de concurrencia:** Si el usuario sigue escribiendo mientras la IA está generando su respuesta, los mensajes se retienen en una cola protegida y se despachan en el siguiente ciclo.

### 1.3. Presencia Humana en WhatsApp ("Escribiendo...")
* Mientras transcurre la espera del acumulador y durante todo el tiempo en que la IA está pensando y generando su respuesta, el gateway activa el estado nativo de WhatsApp **"escribiendo..." (`composing`)**.
* Al terminar y enviar el mensaje, el estado vuelve a normal.

---

## 2. Contrato de Datos: Lo que el Gateway envía al Agente

El gateway envía una petición HTTP `POST` al endpoint del agente con cabeceras `Content-Type: application/json` (más las cabeceras personalizadas que hayas configurado, ej. `Authorization: Bearer <token>`).

### Carga Útil Estándar (Payload)

```json
{
  "channel": "whatsapp",
  "channel_line": "+18295550101",
  "channel_user_id": "18095550123",
  "user_id": "18095550123",
  "message": "Hola\n¿Tienen stock de X?\nY a qué precio?",
  "thread_id": null
}
```

| Campo | Tipo | Descripción |
| :--- | :--- | :--- |
| `channel` | `string` | Siempre `"whatsapp"`. |
| `channel_line` | `string` | Número telefónico de la línea emisora de WhatsApp (ej. `+18295550101`). |
| `channel_user_id`| `string` | Número telefónico del cliente de WhatsApp que envió el mensaje. |
| `user_id` | `string` | Identificador único del usuario (coincide con el número del remitente). El agente lo utiliza como clave de sesión para gestionar su historial y ventana de contexto. |
| `message` | `string` | Texto consolidado de todos los mensajes enviados por el usuario en la ráfaga. |
| `thread_id` | `string \| null` | `null` por defecto, o el número telefónico si se configuró en modo teléfono. |

---

## 3. Modos de Recepción Soportados

### Modo 1: Síncrono (JSON `/chat`)
Ideal para servidores REST estándar (FastAPI, Flask, Express, n8n, Flowise).
* El gateway espera una respuesta HTTP `200 OK` con un cuerpo JSON.
* Por defecto, extrae el texto de la propiedad `reply`.
* También soporta rutas anidadas (`data.text`) o campos habituales (`response`, `message`, `text`, `output`, `result`).

**Ejemplo de respuesta del servidor de IA:**
```json
{
  "reply": "¡Hola! Sí, tenemos stock disponible del producto X a un precio de $25 USD. ¿Deseas hacer un pedido?"
}
```

### Modo 2: Streaming SSE (`/chat/stream`)
Ideal para modelos generativos o agentes basados en tokens en tiempo real (LangGraph, Dify, FastAPI con `StreamingResponse`, Ollama, OpenAI Streaming).
* El gateway se conecta con la cabecera `Accept: text/event-stream`.
* Lee el flujo en tiempo real consumiendo fragmentos `data: {"chunk": "..."}` o texto continuo hasta recibir `data: [DONE]`.
* El gateway acumula todos los fragmentos y los envía a WhatsApp **como un único mensaje cohesivo y consolidado** (WhatsApp no soporta streaming visual carácter por carácter en chats).

**Ejemplo de flujo SSE:**
```http
HTTP/1.1 200 OK
Content-Type: text/event-stream

data: {"chunk": "¡Hola! "}

data: {"chunk": "Sí, tenemos stock "}

data: {"chunk": "disponible del producto X."}

data: [DONE]
```

---

## 4. Ejemplos de Implementación del Servidor del Agente

### Ejemplo A: Python (FastAPI) — Modo Síncrono y Streaming SSE

```python
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse
import asyncio
import json

app = FastAPI(title="Agente de IA para WhatsApp")

# 1. Modo Síncrono (JSON)
@app.post("/api/chat")
async def chat_sync(request: Request):
    data = await request.json()
    user_id = data.get("user_id")
    message = data.get("message")
    
    # Aquí interactúas con tu LLM, LangChain, etc.
    # El user_id sirve para recuperar la memoria de conversación.
    respuesta = f"Hola, recibí tu mensaje: '{message}'. ¿En qué puedo ayudarte hoy?"
    
    return {"reply": respuesta}

# 2. Modo Streaming SSE
@app.post("/api/chat/stream")
async def chat_stream(request: Request):
    data = await request.json()
    user_id = data.get("user_id")
    message = data.get("message")
    
    async def sse_generator():
        frases = ["¡Hola! ", "Recibí tu consulta: ", f"'{message}'. ", "Estamos procesando tu solicitud."]
        for frase in frases:
            yield f"data: {json.dumps({'chunk': frase})}\n\n"
            await asyncio.sleep(0.3)
        yield "data: [DONE]\n\n"
        
    return StreamingResponse(sse_generator(), media_type="text/event-stream")
```

### Ejemplo B: Node.js (Express) — Modo Síncrono

```javascript
import express from 'express';

const app = express();
app.use(express.json());

app.post('/api/chat', (req, res) => {
  const { user_id, message, channel_line } = req.body;
  
  // Procesar con tu modelo o lógica de negocio
  const reply = `Hola, gracias por contactar a ${channel_line}. Tu mensaje fue: "${message}".`;
  
  res.json({ reply });
});

app.listen(8000, () => console.log('Agente activo en puerto 8000'));
```

---

## 5. Configuración en el Panel Web (`/panel`)

1. Abre el panel administrativo en `http://localhost:3000/panel`.
2. Dirígete a la pestaña **🤖 Agentes de IA**.
3. Haz clic en **+ Vincular Agente**.
4. Completa los parámetros:
   * **Línea Telefónica (Canal):** Selecciona la línea que responderá con este agente.
   * **Nombre Identificador:** Nombre descriptivo (ej. *"Asesor de Soporte Técnico"*).
   * **URL del Endpoint del Agente:** URL completa accesible por el gateway (ej. `http://mi-servidor:8000/api/chat`).
   * **Modo de Recepción:** Síncrono (JSON) o Streaming SSE.
   * **Acumulador de Mensajes Consecutivos (ms):** Tiempo de espera tras el último mensaje (1500 ms recomendado).
   * **Cabeceras HTTP (JSON):** Si tu servidor requiere autenticación:
     ```json
     {
       "Authorization": "Bearer mi-clave-secreta"
     }
     ```
   * **Mensaje de Contingencia:** Mensaje que WhatsApp entregará al usuario si tu servidor de IA está apagado o responde con error (ej. *"En este momento no podemos responder, por favor intenta en unos minutos."*).
5. Haz clic en **⚡ Probar Conexión** para verificar la comunicación en tiempo real.
6. Haz clic en **Guardar Vinculación**.

¡Listo! A partir de ese momento, cualquier persona que le escriba a esa línea de WhatsApp recibirá atención automática de tu Agente de IA.
