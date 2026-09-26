# Guía de Disparadores y Webhooks Salientes

`mcp-whatsapp` incorpora un motor nativo de **Disparadores (Outbound Webhooks)** que permite conectar WhatsApp a sistemas externos (CRMs, ERPs, Slack, herramientas No-Code como n8n o Make, y APIs REST personalizadas) cuando una persona envía un mensaje.

---

## 1. Concepto y Arquitectura

El motor opera bajo una arquitectura **Event-Driven con Patrón Outbox persistente en SQLite**:

1. **Cero Bloqueos:** La recepción de mensajes de WhatsApp en el socket nunca espera la respuesta del servidor receptor.
2. **Garantía *At-Least-Once*:** Cada mensaje recibido se almacena transaccionalmente en la tabla `trigger_deliveries` de SQLite antes de despacharse. Si el servidor se apaga o reinicia, las entregas pendientes se reanudan automáticamente.
3. **100% Código Nativo:** Utiliza `node:events`, `globalThis.fetch`, `node:crypto` y `better-sqlite3`, sin librerías externas ni necesidad de Redis.

---

## 2. Parámetros de Configuración y Valores por Defecto

Al crear o editar un disparador, cada parámetro es configurable individualmente:

| Parámetro | Tipo | Por Defecto | Descripción |
| :--- | :--- | :--- | :--- |
| **Nombre** | `string` | *(requerido)* | Nombre identificador (ej. `Lead CRM Ventas`). |
| **Canal / Línea** | `select` | `Todos (Global)` | Línea telefónica específica o global para todas las líneas. |
| **URL Destino** | `url` | *(requerido)* | Endpoint HTTP/HTTPS receptor. |
| **Método HTTP** | `select` | `POST` | `POST`, `PUT` o `GET`. |
| **Cabeceras HTTP** | `json` | `{"Content-Type": "application/json"}` | Headers como tokens de autorización (`Authorization: Bearer ...`). |
| **Modo de Carga** | `radio` | `standard` | `standard` (formato canónico) o `custom` (plantilla personalizada). |
| **Timeout (ms)** | `number` | `5000` | Tiempo de espera por intento (1s a 30s) abortado por `AbortSignal`. |
| **Reintentos Máximos**| `number` | `3` | Intentos automáticos ante caídas o errores de red (0 a 10). |
| **Retraso Base (ms)**| `number` | `10000` | Retraso inicial para el *Exponential Backoff* (10s, 20s, 40s...). |
| **Filtro Mensaje** | `select` | `Todos` | Filtrar por `text`, `media` (imágenes, video, audio) o `document`. |
| **Ignorar Grupos** | `checkbox`| `true` (marcado) | Si está activo, ignora mensajes de grupos de WhatsApp (`@g.us`). |
| **Palabra Clave** | `string` | *(opcional)* | Activar solo si el mensaje contiene esta palabra o prefijo. |
| **Secreto HMAC** | `password`| *(opcional)* | Clave para generar la cabecera `X-Hub-Signature-256`. |

---

## 3. Modos de Carga Útil (Payload)

### Modo A: Estándar (Recomendado para endpoints propios)
Envía un JSON canónico unificado, limpio y predecible:
```json
{
  "event": "message.received",
  "timestamp": "2026-09-26T14:30:00.000Z",
  "channel": {
    "id": "chan_ventas_01",
    "name": "Línea Ventas",
    "phoneNumber": "+18295550101"
  },
  "sender": {
    "jid": "18095551234@s.whatsapp.net",
    "phoneNumber": "18095551234",
    "name": "Carlos Mendoza"
  },
  "chat": {
    "jid": "18095551234@s.whatsapp.net",
    "isGroup": false,
    "name": "Carlos Mendoza"
  },
  "message": {
    "id": "BAE5F89A123",
    "text": "Hola, solicito cotización para el servicio",
    "type": "text",
    "timestamp": 1727357900000,
    "timestampISO": "2026-09-26T14:30:00.000Z"
  }
}
```

### Modo B: Personalizado (Para integrarse a sistemas existentes sin tocarlos)
Permite definir un objeto JSON con la estructura exacta que el receptor requiere. Las variables entre `{{...}}` se sustituyen en tiempo real.

```json
{
  "origen": "WhatsApp - {{channel.name}}",
  "telefono": "{{sender.phoneNumber}}",
  "contacto": "{{sender.name}}",
  "comentarios": "{{message.text}}",
  "fecha": "{{message.timestampISO}}"
}
```

---

## 4. Diccionario de Variables Disponibles

| Variable | Tipo | Descripción | Ejemplo |
| :--- | :--- | :--- | :--- |
| `{{sender.phoneNumber}}` | `string` | Número telefónico internacional | `"18095551234"` |
| `{{sender.name}}` | `string` | Nombre del contacto en WhatsApp | `"Carlos Mendoza"` |
| `{{sender.jid}}` | `string` | JID internacional de WhatsApp | `"18095551234@s.whatsapp.net"` |
| `{{message.id}}` | `string` | ID único del mensaje | `"BAE5F89A123"` |
| `{{message.text}}` | `string` | Texto del mensaje | `"Hola, quiero información"` |
| `{{message.type}}` | `string` | Tipo de contenido (`text`, `image`, etc.) | `"text"` |
| `{{message.timestamp}}` | `number` | Marca de tiempo Unix en ms | `1727357900000` |
| `{{message.timestampISO}}`| `string` | Fecha en formato ISO 8601 | `"2026-09-26T14:30:00.000Z"` |
| `{{message.mediaUrl}}` | `string` | URL del adjunto (si aplica) | `"/media/download/..."` |
| `{{message.mentions}}` | `array` | JIDs mencionados | `["1809...@s.whatsapp.net"]` |
| `{{chat.jid}}` | `string` | JID de la conversación | `"1809...@s.whatsapp.net"` |
| `{{chat.isGroup}}` | `boolean`| Si el chat es un grupo | `false` |
| `{{channel.id}}` | `string` | ID de la línea en el gateway | `"chan_prod_01"` |
| `{{channel.name}}` | `string` | Nombre descriptivo de la línea | `"Línea Principal"` |
| `{{channel.phoneNumber}}`| `string` | Número del canal emisor | `"+18295550101"` |

> [!TIP]
> **Preservación de Tipos y Arreglos:**
> Si un campo de la plantilla es exactamente `"{{message.timestamp}}"`, el motor preserva el tipo nativo (`number`). Si es `"{{message.mentions}}"`, genera un `Array` real de JSON.

### Transformación de Listas con la Directiva `$map`
Para transformar dinámicamente cada elemento de un arreglo del mensaje a un formato distinto:
```json
{
  "destinatarios": {
    "$map": "message.mentions",
    "$item": {
      "identificador": "{{item}}",
      "fuente": "whatsapp"
    }
  }
}
```

---

## 5. Ejemplos Prácticos Listos para Usar

### Ejemplo 1: Notificaciones en Canales de Slack
* **URL:** `https://hooks.slack.com/services/T00/B00/XXXXX`
* **Método:** `POST`
* **Modo:** `Personalizado`
* **Plantilla:**
```json
{
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*Nuevo mensaje de:* {{sender.name}} (`{{sender.phoneNumber}}`)\n*Línea:* {{channel.name}}"
      }
    },
    {
      "type": "section",
      "text": {
        "type": "plain_text",
        "text": "{{message.text}}"
      }
    }
  ]
}
```

### Ejemplo 2: Integración con CRM / ERP
* **URL:** `https://mi-crm.empresa.com/api/v1/leads`
* **Método:** `POST`
* **Cabeceras:** `{"Content-Type": "application/json", "Authorization": "Bearer MI_TOKEN_SECRETO"}`
* **Modo:** `Personalizado`
* **Plantilla:**
```json
{
  "lead_source": "WhatsApp",
  "phone_number": "{{sender.phoneNumber}}",
  "full_name": "{{sender.name}}",
  "initial_inquiry": "{{message.text}}",
  "created_at": "{{message.timestampISO}}"
}
```

### Ejemplo 3: Automatización en n8n / Make / Zapier
* **URL:** `https://n8n.mi-servidor.com/webhook/whatsapp-inbound`
* **Método:** `POST`
* **Modo:** `Estándar` (n8n recibirá el JSON unificado para usar cualquier variable en el flujo).

---

## 6. Clasificación de Respuestas y Políticas de Reintento

El despachador evalúa la respuesta del servidor receptor de la siguiente manera:

1. **Éxito (`200`–`299`):**
   * Estado: `delivered`.
   * La entrega concluye con éxito.
2. **Error Permanente (`400`, `401`, `403`, `404`):**
   * Estado: `failed`.
   * **No se reintenta automáticamente** para evitar saturar el servidor o reenviar peticiones con credenciales inválidas.
3. **Error Transitorio (Caída de red, Timeout, `500`, `502`, `503`, `504` o `429`):**
   * Estado: `pending`.
   * Se programa un **reintento con backoff exponencial** (`next_retry_at = now + retryDelayMs * 2^(intentos)`).
   * Al alcanzar `max_retries` sin éxito, la entrega pasa a estado `failed`.

---

## 7. Recuperación tras Caídas (*Replay Engine*)

Si tu sistema receptor estuvo fuera de línea por mantenimiento o un fallo de infraestructura:

1. Ve a la pestaña **Disparadores (Webhooks)** en el panel web.
2. En la fila del disparador afectado, haz clic en el botón **`📋 Entregas`**.
3. Verás el contador de entregas fallidas y la causa del fallo (ej. `HTTP 502 Bad Gateway` o `ECONNREFUSED`).
4. Haz clic en el botón superior **`↻ Reintentar Todos los Fallidos`**.
5. Todas las entregas fallidas se restablecerán a `pending` y el worker las despachará en orden sin pérdida de información.

---

## 8. Verificación de Seguridad HMAC (Opcional)

Si configuras un **Secreto de Firma HMAC** en el disparador, el gateway enviará la cabecera:
`X-Hub-Signature-256: sha256=<hash_hexadecimal>`

### Cómo verificar la firma en el receptor (Node.js / Express):
```javascript
import crypto from 'node:crypto';

app.post('/api/webhook', (req, res) => {
  const secret = 'tu_secreto_configurado';
  const signature = req.headers['x-hub-signature-256'];
  const rawBody = JSON.stringify(req.body);

  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  if (signature !== expected) {
    return res.status(401).send('Firma HMAC no coincide');
  }

  // Procesar webhook de forma segura
  res.sendStatus(200);
});
```
