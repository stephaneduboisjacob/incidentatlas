# Preguntas frecuentes

## ¿Qué es IncidentAtlas?

Un registrador autoalojable de cambios operativos que ayuda a reconstruir la cronología de una interrupción o incidente de seguridad.

## ¿Es una plataforma de registros, APM, SIEM o métricas?

No. Se centra en cambios compactos y evidencias vinculadas, no en el envío arbitrario de registros, trazas, detección SIEM ni métricas generales.

## ¿Qué puede registrar el colector actual?

La versión actual admite eventos estructurados del ciclo de vida de unidades systemd, eventos de ciclo de vida de contenedores Docker si se habilitan y hashes de archivos Nginx configurados expresamente. Docker está desactivado de forma predeterminada. La recopilación operativa de PostgreSQL, despliegues de GitHub, metadatos de certificados y estados externos están previstos, pero no disponibles en esta versión.

## ¿Envía archivos de configuración, SQL o secretos de contenedores?

El observador Nginx envía rutas configuradas y hashes SHA-256 anterior/posterior, no el contenido. Systemd no envía texto de mensajes del diario. Se excluyen variables de entorno y registros de Docker. La versión actual no recopila texto de consultas ni parámetros de PostgreSQL.

## ¿IncidentAtlas identifica la causa raíz?

No. La puntuación determinista prioriza eventos con factores explicables. Son hipótesis, no probabilidades ni pruebas. Una persona debe revisar la evidencia y confirmar expresamente un hallazgo.

## ¿Necesita un servicio de IA o acceso a Internet?

No. La correlación y el borrador de postmortem actuales son deterministas y se ejecutan en la instalación. Los colectores conectados necesitan acceso HTTPS al servidor; el flujo principal autoalojado no requiere un proveedor de IA externo.

## ¿Dónde se guarda la evidencia?

Los registros normalizados y metadatos se almacenan en PostgreSQL. Las cargas de artefactos usan un sistema de archivos local direccionado por digest. El operador controla el servidor, el almacenamiento, los accesos y las copias.

## ¿Puedo activar Docker sin privilegios adicionales?

La recopilación de Docker está desactivada porque el socket Docker y el grupo `docker` equivalen a acceso root. Actívela solo después de evaluar y documentar ese privilegio.

## ¿Cómo funcionan la retención y los bloqueos legales?

Propietarios y administradores configuran periodos independientes. Acortarlos tras una confirmación inicia una limpieza en segundo plano. Un bloqueo global o de incidente protege la evidencia cubierta hasta que un administrador lo libere con un motivo.

## ¿Está listo para ser mi único sistema de evidencias de producción?

No. Esta versión sigue en desarrollo. Las copias las ejecuta el operador, deben guardarse fuera del host y requieren un plan de recuperación probado. Mantenga otros registros operativos hasta que la madurez del producto y su recuperación satisfagan sus necesidades.

## ¿Cuál es la licencia?

La licencia está pendiente. El repositorio reserva todos los derechos; no presuponga que se permite redistribuirlo. Revise el repositorio antes de usarlo más allá de la evaluación.

---

Contact: Stephane Jacob <jacobstephane@outlook.com>
