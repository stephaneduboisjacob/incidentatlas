# Manual de administración

Esta guía cubre el despliegue Compose actual y el colector de host en Rust. Adapte los comandos a su entorno y lea `docs/deployment.md`, `docs/collector.md` y `docs/retention.md` antes de usarlo en producción. El producto sigue en desarrollo; no lo use como único registro de incidentes.

## Desplegar el servidor

La compilación requiere Node.js 24 y npm; el servidor usa Docker Engine con Compose. Si va a exponer el servicio, necesita un proxy inverso. La pila Compose suministrada incluye la aplicación/API, un worker y PostgreSQL 18 en una red privada. PostgreSQL no publica un puerto en el host; la API escucha en el puerto local 3080 para Nginx.

1. Clone el repositorio y revise la configuración de despliegue incluida.
2. Copie `.env.example` como `.env`. Genere un valor aleatorio distinto para cada secreto requerido, por ejemplo con `openssl rand -hex 32`. Proteja el archivo y no lo incluya en el control de versiones.
3. Configure `INCIDENTATLAS_PUBLIC_ORIGIN` con el origen HTTPS exacto que visitarán los usuarios.
4. Ejecute `docker compose up -d --build` y compruebe `docker compose ps` y los endpoints de salud live/ready.
5. Para iniciar ACME HTTP-01, cree un nuevo sitio Nginx a partir de `deploy/nginx/incidentatlas.http.conf`. Valide con `nginx -t`, obtenga el certificado, instale `deploy/nginx/incidentatlas.conf`, vuelva a validar y recargue Nginx. No reemplace la configuración de otro sitio. Mantenga activo el temporizador de renovación de Certbot e instale el hook incluido.
6. Cree la primera cuenta propietaria con `INCIDENTATLAS_SETUP_TOKEN` de `.env`. Consulte el valor localmente en el servidor; no lo envíe por chat ni lo escriba en registros. La configuración inicial queda desactivada permanentemente después de crear la primera cuenta.

La guía de despliegue del repositorio contiene ejemplos exactos de dominio, rutas de certificados y comandos de copia de seguridad. Sustituya los dominios de ejemplo. El modo conectado del colector requiere HTTPS con certificado válido.

## Proteger la instalación

Use valores diferentes para cada secreto y rótelos si sospecha una exposición. Limite el acceso a `.env`, copias, datos de PostgreSQL, artefactos y registros. No publique el puerto de la base de datos. Mantenga la API ligada a loopback detrás de HTTPS. Use contraseñas robustas para administradores y los controles habituales de acceso al host.

El MVP ofrece configuración inicial de propietario de un solo uso, inicio de sesión local y separación por organización; aún no tiene una consola completa para invitar usuarios o gestionar roles. No comparta cuentas ni credenciales de configuración inicial sin necesidad. Consulte [Seguridad y privacidad](security-and-privacy.md) y `SECURITY.md`.

## Inscribir y operar un colector

Instale el binario Rust y la unidad systemd incluidos. Ejecútelos como el usuario de servicio dedicado `incidentatlas`, no como root. Empiece con `dry-run`, examine los eventos normalizados propuestos y los nombres de las reglas de redacción; luego use `local` para verificar la cola SQLite limitada. Cambie a `connected` solo tras revisar el alcance de las fuentes, comprobar HTTPS y establecer una copia de seguridad probada en otro host.

En hosts compartidos, limite las unidades systemd con `sources.systemd_units`. La fuente systemd utiliza campos estructurados de ciclo de vida y no envía el texto del diario. Docker está desactivado de forma predeterminada: el socket Docker y el grupo `docker` equivalen a acceso root. Habilitarlo requiere aceptar y documentar ese privilegio. El observador Nginx actual consulta solo archivos regulares exactos configurados, rechaza enlaces simbólicos y emite la ruta y los hashes anterior/posterior; no envía contenido ni recorre directorios de forma recursiva. La recopilación operativa de PostgreSQL, GitHub y otros conectores previstos aún no están implementados.

Guarde el token de inscripción y las credenciales del colector en archivos protegidos separados. El token es de un solo uso; el servidor guarda un hash de las credenciales y permite revocarlas. Nunca incluya credenciales en TOML, argumentos de comandos, tickets ni historial del shell. `incidentatlas-agent doctor` revisa el estado local sin revelar valores secretos.

Comandos útiles: `status`, `doctor`, `test-redaction`, `test-source systemd`, `test-source docker` y `print-config`. La cola es durable y limitada; supervise su estado, los contadores de pérdidas y el espacio disponible. Que el proceso siga activo no garantiza que los eventos se hayan entregado.

## Copias de seguridad, retención y bloqueo legal

Haga copias conjuntas de PostgreSQL y del volumen de artefactos. Use `deploy/scripts/backup.sh <directorio-privado>` y valide cada copia con `deploy/scripts/verify-backup.sh <directorio-de-copia>`. Estos comandos pausan brevemente la API y el worker; los colectores almacenan eventos mientras tanto. La verificación comprueba hashes de artefactos y restaura la base en una base temporal para comparar recuentos de tablas. Los scripts no programan copias, no las trasladan a otro host ni sustituyen un simulacro completo de recuperación. Cifre las copias, guárdelas en otro lugar y pruebe la restauración.

En **Retention & holds**, propietarios y administradores configuran por separado los periodos de eventos, artefactos, auditoría y generaciones de IA reservadas. Acortar un periodo requiere confirmación y pone en cola la limpieza asíncrona; los bloqueos legales preservan la evidencia cubierta. Un bloqueo global cubre toda la organización; uno de incidente cubre la ventana configurada. Especifique un motivo al crear o liberar un bloqueo. Al vencer, se elimina el contenido del artefacto, pero quedan sus metadatos; la descarga ya no está disponible. La retención no elimina automáticamente incidentes, hipótesis, bloqueos ni cuentas. La retención de generaciones de IA está reservada porque el almacenamiento de IA no está implementado.

## Operación diaria y respuesta a incidentes

Revise `docker compose ps`, endpoints de salud, registros de servicios, espacio en disco, volúmenes de base de datos y artefactos, colas de colectores y antigüedad de las copias. Los registros de la aplicación omiten intencionadamente cuerpos de solicitud y credenciales. Si falla la ingesta, los colectores deben guardar eventos localmente; vigile las señales de desbordamiento y resuelva el problema antes de alcanzar el límite de la cola.

Ante una posible filtración de credenciales: revoque el colector o el acceso afectado cuando sea posible, rote los secretos, preserve los registros y copias relevantes, revise la auditoría e investigue desde un host confiable. Antes de actualizar, lea las notas de versión, cree y verifique una copia, aplique las migraciones documentadas y compruebe la salud y la capacidad de recuperación.

---

Contact: Stephane Jacob <jacobstephane@outlook.com>
