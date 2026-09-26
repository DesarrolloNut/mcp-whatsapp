# MCP WhatsApp Gateway

Gateway multicanal de WhatsApp para agentes de Inteligencia Artificial (Claude Desktop, Cursor, Claude Code) basado en el protocolo [MCP](https://modelcontextprotocol.io) (Model Context Protocol).

Permite conectar agentes IA a WhatsApp mediante **conexión directa a WhatsApp Web (Baileys embebido con código QR)** o a través de múltiples proveedores externos (**Evolution API v2**, **Meta Cloud API**, **Twilio**), gestionando dinámicamente múltiples líneas telefónicas (**canales**) desde un panel de administración web, con almacenamiento persistente local en disco.

---

## Características Principales

- **Conexión Directa a WhatsApp Web (Baileys Embebido):** Conecta tu WhatsApp escaneando un código QR en el panel web. ¡Sin necesidad de servidores externos como Evolution API!
- **Abstracción Agnóstica de Proveedores:** Conecta tu infraestructura a WhatsApp Web directo, Evolution API v2, Meta Cloud API o Twilio bajo una interfaz unificada.
- **Gestión Multicanal:** Configura múltiples números o líneas telefónicas (ej. *trabajo*, *personal*, *soporte*, *ventas*) y designa una **línea por defecto** global.
- **REST API Directa (`/api`):** Endpoints HTTP estándar para enviar mensajes, consultar chats y verificar números sin necesidad de usar el protocolo MCP.
- **Panel Web de Administración (`/panel`):** Interfaz SPA moderna (tema oscuro inspirado en WhatsApp) para registrar proveedores, vincular WhatsApp Web vía QR en vivo, gestionar líneas y monitorear el estado en tiempo real.
- **Servidor MCP HTTP/SSE:** Transporte moderno `Streamable HTTP / SSE` con autenticación mediante Bearer token (`MCP_API_TOKEN`).
- **Persistencia Montada en Disco (SQLite + Sesiones):** Configuración resguardada en `./data/mcp-whatsapp.db` con modo WAL y credenciales de sesión en `./data/sessions/<channel_id>/`, garantizando **cero pérdida de datos o desvinculaciones** tras reinicios o despliegues Docker.
- **Copias de Seguridad en Caliente:** Script integrado `npm run db:backup` para generar snapshots sin detener el servicio.
- **Disparadores Asíncronos (Webhooks Salientes con Cola Outbox):** Reacciona automáticamente a mensajes entrantes de WhatsApp despachando peticiones HTTP personalizadas hacia CRMs, ERPs, Slack o n8n. Incluye transformación dinámica de datos (`{{sender.phoneNumber}}`), reintentos con *exponential backoff*, firma HMAC-SHA256 y reintento masivo de fallos desde el panel web (Ver [docs/webhooks-and-triggers.md](docs/webhooks-and-triggers.md)).
- **Retrocompatibilidad Total:** Mantiene compatibilidad con clientes existentes mediante alias automáticos `evolution_*` y modo legacy `stdio`.

---

## Inicio Rápido

### Opción A — Docker Compose (Recomendada para Producción)

El repositorio incluye un archivo [docker-compose.yml](docker-compose.yml) listo para producción con volumen montado para la base de datos:

```bash
# 1. Clona el repositorio
git clone https://github.com/DesarrolloNut/mcp-whatsapp.git
cd mcp-whatsapp

# 2. Configura las variables en tu entorno o en un archivo .env
cp .env.example .env

# 3. Inicia el gateway
docker compose up -d
```

El servicio estará disponible en:
- **Panel de Administración:** `http://localhost:3000/panel` (Usuario: `admin`, Clave: `admin` por defecto)
- **Documentación Swagger UI Interactiva:** `http://localhost:3000/docs` (o `/openapi.json`)
- **Endpoint MCP para Agentes IA:** `http://localhost:3000/mcp`
- **REST API Directa:** `http://localhost:3000/api` (Ver [docs/rest-api-reference.md](docs/rest-api-reference.md))

---

### Opción B — Docker CLI Directo

```bash
docker run -d \
  --name mcp-whatsapp \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -e MCP_API_TOKEN=tu-token-agentes-secreto \
  -e ADMIN_PASSWORD=tu-clave-admin-segura \
  ghcr.io/desarrollonut/mcp-whatsapp:latest
```

> ⚠️ **Importante sobre el volumen persistente:**  
> El flag `-v $(pwd)/data:/app/data` es indispensable. La imagen de Docker corre bajo el usuario no-privilegiado `node` y escribe la base de datos en `/app/data/mcp-whatsapp.db`. Montar este volumen evita perder la configuración al reiniciar el contenedor.

---

### Opción C — Ejecución Local (Node.js 18+)

```bash
# 1. Instalar dependencias y compilar
npm install
npm run build

# 2. Iniciar el servidor
npm start
```

---

## Configuración (.env)

| Variable | Por Defecto | Descripción |
|:---|:---:|:---|
| `WHATSAPP_MODE` | `server` | `server` para servidor HTTP/SSE con panel web; `stdio` para modo CLI clásico. |
| `HTTP_PORT` | `3000` | Puerto HTTP del gateway. |
| `HTTP_HOST` | `0.0.0.0` | Host de enlace de red. |
| `MCP_API_TOKEN` | *(vacío)* | Token Bearer requerido por los clientes MCP (`Authorization: Bearer <token>`). Vacío deshabilita auth en desarrollo. |
| `ADMIN_USERNAME` | `admin` | Usuario del panel de administración web. |
| `ADMIN_PASSWORD` | `admin` | Contraseña del panel de administración web. |
| `ADMIN_JWT_SECRET` | *(auto)* | Clave secreta HMAC-SHA256 para firmar tokens JWT de sesión. |
| `ENCRYPTION_KEY` | *(auto)* | Clave de 32 bytes para cifrar las API keys de proveedores en SQLite (AES-256-GCM). |
| `SQLITE_PATH` | `./data/mcp-whatsapp.db` | Ruta del archivo de base de datos SQLite montado en disco. |

---

## Conexión de Clientes MCP

### Cursor (`.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "whatsapp": {
      "url": "http://localhost:3000/mcp",
      "headers": {
        "Authorization": "Bearer tu-token-agentes-secreto"
      }
    }
  }
}
```

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "whatsapp": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/inspector",
        "--sse",
        "http://localhost:3000/mcp"
      ],
      "headers": {
        "Authorization": "Bearer tu-token-agentes-secreto"
      }
    }
  }
}
```

### Claude Code (CLI)

```bash
claude mcp add whatsapp http://localhost:3000/mcp --header "Authorization: Bearer tu-token-agentes-secreto"
```

---

## Herramientas Unificadas MCP

Los agentes pueden interactuar con WhatsApp utilizando las siguientes herramientas. Si se omite el argumento `channel`, la llamada se despacha automáticamente a través de la **línea predeterminada**:

| Herramienta Unificada | Alias Retrocompatible | Descripción |
|:---|:---|:---|
| `whatsapp_send_text` | `evolution_send_text` | Enviar mensaje de texto (con menciones, links o cita). |
| `whatsapp_send_media` | `evolution_send_media` | Enviar imágenes, videos, audios o documentos (vía URL o base64). |
| `whatsapp_send_location` | `evolution_send_location` | Enviar coordenadas GPS y nombre de ubicación. |
| `whatsapp_send_contact` | `evolution_send_contact` | Enviar tarjeta de contacto. |
| `whatsapp_send_reaction` | `evolution_send_reaction` | Reaccionar a un mensaje existente con un emoji. |
| `whatsapp_find_messages` | `evolution_find_messages` | Consultar historial de mensajes de un chat. |
| `whatsapp_find_chats` | `evolution_find_chats` | Listar conversaciones activas. |
| `whatsapp_check_number` | `evolution_check_number` | Comprobar si un número está registrado en WhatsApp. |
| `whatsapp_create_group` | `evolution_create_group` | Crear un nuevo grupo con participantes. |
| `whatsapp_get_group_info` | `evolution_get_group_info` | Obtener participantes y metadata de un grupo. |
| `whatsapp_update_group_participants` | `evolution_update_group_participants` | Añadir, eliminar, promover o degradar miembros en un grupo. |
| `whatsapp_leave_group` | `evolution_leave_group` | Abandonar un grupo de WhatsApp. |

---

## Copias de Seguridad (Backups)

Para realizar una instantánea de la base de datos en caliente sin detener el servidor:

```bash
npm run db:backup
```

Los respaldos se almacenan automáticamente con fecha y hora en `data/backups/`.

---

## Documentación Técnica Adicional

- [docs/rest-api-reference.md](docs/rest-api-reference.md): Referencia completa de la REST API HTTP directa para mensajería, chats y grupos.
- [docs/database-persistence.md](docs/database-persistence.md): Arquitectura de almacenamiento en disco, modo WAL y volúmenes Docker.
- [docs/providers-and-channels.md](docs/providers-and-channels.md): Modelo conceptual de proveedores, canales/líneas y resolución por defecto.
- [docs/admin-panel-guide.md](docs/admin-panel-guide.md): Guía de uso del panel web SPA y credenciales de acceso.
- [docs/mcp-connection-guide.md](docs/mcp-connection-guide.md): Configuración detallada para cada cliente MCP.

---

## Licencia

MIT © DesarrolloNut
