# Guía del Panel de Administración Web

`mcp-whatsapp` v2.0 incorpora un panel web liviano y moderno (SPA sin frameworks) servido directamente por la aplicación en `/panel`.

---

## 1. Acceso al Panel

- **URL Local:** `http://localhost:3000/panel` (o el puerto configurado en `HTTP_PORT`).
- **Credenciales por Defecto:**
  - **Usuario:** `admin`
  - **Contraseña:** `admin`

> [!WARNING]  
> **Seguridad en Producción:**  
> Las credenciales predeterminadas (`admin`/`admin`) son exclusivamente para desarrollo inicial. En entornos productivos debes definir en las variables de entorno:
> ```bash
> ADMIN_USERNAME=tu_usuario_personalizado
> ADMIN_PASSWORD=tu_clave_de_alta_entropia
> ```
> Si el servidor arranca con las credenciales por defecto, emitirá una advertencia explícita en `stderr`.

---

## 2. Funcionalidades del Panel

### 2.1 Panel General (Dashboard)
- Muestra el total de proveedores conectados.
- Muestra el número de líneas/canales activos y la línea actualmente designada como **predeterminada** (`Default`).
- Muestra el tiempo de actividad del servicio (uptime).

### 2.2 Gestión de Proveedores (Providers)
- **Registrar Proveedor:** Permite configurar un nuevo backend WhatsApp:
  - **WhatsApp Web Directo (Baileys / Embebido):** Conexión nativa sin necesidad de servidores externos. No requiere URL ni API Key externa.
  - **Evolution API v2:** Conexión con servidor Evolution API autohospedado.
  - **Meta Cloud API / Twilio:** Integraciones oficiales de Meta y Twilio.
- **Probar Conectividad:** Botón `⚡ Probar` que ejecuta una verificación en tiempo real de las credenciales y estado del proveedor.
- **Desactivar:** Permite deshabilitar temporalmente un proveedor sin eliminar su historial.

### 2.3 Gestión de Canales / Líneas Telefónicas (Channels)
- **Registrar Línea:** Asocia un número telefónico o instancia al proveedor configurado.
- **Menú de Acciones de Línea (Tres Puntos `⋮`):** Cada línea cuenta con un menú desplegable contextual con las siguientes opciones:
  - **💬 Enviar Mensaje:** Abre un modal interactivo que permite enviar mensajes de texto de prueba directamente desde esa línea específica a cualquier número internacional (invocando `POST /api/messages/text`).
  - **📱 Vincular / Estado QR:** (Para líneas `baileys`) Abre el visor en tiempo real para generar o regenerar el código QR de WhatsApp Web o consultar la conexión activa.
  - **★ Hacer Predeterminada:** Designa la línea como el canal por defecto del sistema.
  - **🗑️ Desactivar Línea:** Da de baja la línea del enrutador de mensajes.
- **Vincular WhatsApp Web (Código QR):** Para canales asociados al proveedor `baileys`, al abrir la vinculación QR:
  1. Se inicializa el socket directo de Baileys.
  2. Se renderiza un código QR de alta resolución en tiempo real.
  3. Escaneas el código desde WhatsApp en tu teléfono (*Dispositivos vinculados > Vincular un dispositivo*).
  4. La sesión se autentica, almacena las credenciales en `./data/sessions/<channel_id>/` de forma permanente y detecta el número telefónico automáticamente.

### 2.4 Gestión de Disparadores (Webhooks Salientes)
- **Registrar Disparador:** Permite configurar un webhook para reaccionar a mensajes entrantes de WhatsApp:
  - **Asociación de Canal:** Asigna el disparador a una línea específica o a todas las líneas globales.
  - **URL y Método HTTP:** Configura endpoints `POST`, `PUT` o `GET` con cabeceras HTTP personalizadas (ej. tokens de autorización).
  - **Modo Estándar vs Personalizado:** Elige entre enviar el JSON unificado de WhatsApp o definir una plantilla dinámica (`{{sender.phoneNumber}}`, `{{message.text}}`, etc.) con plantillas rápidas de 1 clic para CRM o Slack.
  - **Filtros Avanzados:** Filtra por tipo de mensaje (texto, multimedia, documentos), descarta automáticamente mensajes de grupos o filtra por palabras clave.
  - **Resiliencia:** Configura timeout por petición (default: 5000 ms), reintentos máximos (default: 3) y retraso base para backoff exponencial.
  - **Firma HMAC-SHA256:** Permite definir un secreto para firmar el cuerpo en la cabecera `X-Hub-Signature-256`.
- **⚡ Probar en Vivo:** Envía una petición de prueba simulada inmediata al receptor y muestra en pantalla el código HTTP devuelto, tiempo de respuesta en ms y cuerpo devuelto.
- **📋 Entregas y Cola Outbox:** Inspecciona el historial de entregas de cada disparador, visualiza causas de error y reintenta mensajes individuales o utiliza el botón **`↻ Reintentar Todos los Fallidos`**.

### 2.5 Gestión de Agentes de IA (Vinculación 1:1 y Debounce Buffer)
- **Vincular Agente:** Asocia directamente una línea telefónica con un servidor de IA (FastAPI, LangGraph, Dify, etc.):
  - **Regla 1:1 Estricta:** Solo se permite un único agente por línea telefónica para evitar respuestas cruzadas o contradictorias.
  - **Modos de Recepción:** Soporta **Síncrono (JSON /chat)** y **Streaming SSE (/chat/stream)**.
  - **Acumulador Debounce:** Parámetro configurable (por defecto `1500 ms`) para esperar silencio tras el último mensaje antes de llamar a la IA, consolidando mensajes en ráfaga.
  - **Simulación de Presencia:** Activa el estado "escribiendo..." en WhatsApp mientras la IA procesa.
  - **Mensaje de Contingencia:** Mensaje de respaldo entregado a WhatsApp si el servidor de IA falla o agota el tiempo de espera.
  - **Prueba en Vivo:** Botón `⚡ Probar` para validar la conectividad y medir la latencia antes o después de guardar.
  - Para más detalles, consulta la [Guía Completa de Conexión de Agentes de IA](file:///c:/Users/jvelez/Documents/projects/mcp-whatsapp/docs/ai-agents-connection.md).

---

## 3. Documentación Interactiva OpenAPI / Swagger UI

El servidor expone la especificación OpenAPI 3.1 completa e interactiva:
- **Swagger UI:** `http://localhost:3000/docs` — Explora, prueba y ejecuta todas las rutas REST (`/api/*` y `/api/admin/*`) interactivamente desde el navegador.
- **Especificación OpenAPI (JSON):** `http://localhost:3000/openapi.json` — Archivo JSON para importar en Postman, Insomnia o generadores de clientes.
- **Acceso directo desde el Panel:** La barra lateral del panel web incluye un enlace directo con icono `📖 API Docs (Swagger)`.

---

## 3. Endpoints de Sesión y Emparejamiento (Baileys)

| Método | Endpoint | Descripción |
| :--- | :--- | :--- |
| `POST` | `/api/admin/channels/:id/session/start` | Inicia el socket Baileys para el canal si no está corriendo. |
| `GET` | `/api/admin/channels/:id/session/qr` | Obtiene el estado actual de la sesión y el Data URL del código QR (`image/png`). |
| `GET` | `/api/admin/channels/:id/session/status` | Consulta el estado (`idle`, `connecting`, `qr_ready`, `connected`, `disconnected`). |
| `POST` | `/api/admin/channels/:id/session/logout` | Cierra la sesión activa y elimina las credenciales del almacenamiento persistente. |

---

## 4. Arquitectura de Sesión y Persistencia
- La autenticación en el panel web utiliza un token JWT firmado mediante HMAC-SHA256 (`node:crypto`) emitido por `/api/admin/auth/login`.
- El token se conserva en el almacenamiento local del navegador (`localStorage`) durante 7 días.
- Todas las operaciones de creación, edición o borrado en la base de datos SQLite se ejecutan bajo transacciones seguras con modo WAL (`./data/mcp-whatsapp.db`).
- Las credenciales de WhatsApp Web se persisten en `./data/sessions/<channel_id>/creds.json`, sobreviviendo a reinicios del servidor o contenedor Docker.
