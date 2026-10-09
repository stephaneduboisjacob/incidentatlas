# Guía de seguridad y privacidad

## Compromiso de recopilación

IncidentAtlas busca conservar cambios de estado compactos que permitan reconstruir incidentes. El colector redacta los datos antes del envío conectado. Las fuentes actuales son eventos estructurados del ciclo de vida de systemd, metadatos de ciclos de vida de contenedores Docker si se habilitan, y hashes de archivos Nginx configurados expresamente. El colector no envía texto de mensajes del diario, variables de entorno de Docker, registros de contenedores, contenido de archivos Nginx, texto ni parámetros SQL, cargas útiles de aplicaciones, claves privadas ni código fuente de repositorios.

Este es un objetivo de diseño, no una garantía de que cada host o fuente personalizada carezca de riesgos. Revise la salida de `dry-run`, limite las fuentes y añada patrones de redacción para identificadores locales cuando haga falta.

## Clasificación de datos

| Clase | Ejemplos | Tratamiento |
| --- | --- | --- |
| PUBLIC | Versión de software publicada | Se puede compartir |
| OPERATIONAL | Estado del servicio, hash de imagen, caducidad de certificado | Registro operativo controlado por el cliente |
| SENSITIVE | Nombres de hosts, rutas, identificadores de usuario | Minimizar, restringir el acceso y aplicar retención |
| SECRET | Contraseñas, tokens, claves privadas, cookies | Redactar localmente; no persistir intencionadamente |
| PROHIBITED | Datos de clientes, filas de tablas, contenido de claves privadas | No recopilar |

## Medidas para operadores

- Use `dry-run`, después `local` y finalmente `connected`.
- Ejecute el agente con la cuenta dedicada sin privilegios y conceda acceso mínimo. Mantenga Docker desactivado salvo que acepte su privilegio equivalente a root.
- Use HTTPS con verificación de certificados; no desactive la validación TLS.
- Proteja tokens de configuración inicial, credenciales de colectores, `.env`, copias y almacenamiento de datos.
- Mantenga PostgreSQL privado y la API pública detrás de HTTPS.
- Revise los metadatos de eventos y las rutas observadas antes de habilitar la recopilación.
- Cifre las copias, guárdelas fuera del host y pruébelas. Espere a verificar las copias externas y los procedimientos de recuperación antes de activar colectores conectados en un host vigilado.
- Configure cuidadosamente la retención y los bloqueos legales. Una reducción confirmada puede borrar evidencia de forma asíncrona.

## Acceso, integridad y límites

Las consultas de API aplican separación por organización. Las credenciales del colector se almacenan como hashes y pueden revocarse. Los eventos tienen digest SHA-256; los artefactos usan nombres derivados del contenido y se verifican durante operaciones de limpieza y copia. Un digest permite detectar ciertos cambios en bytes almacenados, pero no demuestra que un evento fuera veraz si el host estaba comprometido. El reloj puede ser incorrecto, el colector puede estar desconectado y la ausencia de un evento no demuestra que no hubiera un cambio.

La analítica del producto está desactivada de forma predeterminada. El MVP actual no incluye una interfaz completa de gestión de cuentas, proveedor de identidad externo, fuente de eventos PostgreSQL, instantáneas completas de configuración, copias externas automatizadas ni análisis causal mediante IA. Consulte `docs/threat-model.md`, `docs/privacy.md` y `SECURITY.md` para conocer los supuestos detallados y el proceso de notificación de vulnerabilidades.

---

Contact: Stephane Jacob <jacobstephane@outlook.com>
