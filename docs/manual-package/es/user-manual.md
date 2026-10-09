# Manual de usuario

## Qué hace IncidentAtlas

IncidentAtlas registra cambios operativos compactos y los organiza alrededor de un incidente para que una persona investigue qué cambió, cuándo y qué evidencias respaldan una posible explicación. Las sugerencias actuales usan puntuación determinista. Una sugerencia es una hipótesis, nunca una atribución automática de causa.

## Inicio de sesión y espacio de trabajo

Abra la dirección HTTPS de IncidentAtlas de su organización e inicie sesión con la cuenta creada durante la configuración inicial. Si no tiene una cuenta, contacte con una persona propietaria o administradora; la versión actual no incluye invitaciones de autoservicio ni una pantalla de gestión de usuarios. Use **Sign out** al terminar, sobre todo en un equipo compartido.

La vista general muestra incidentes abiertos, cambios recientes, hosts presentes en la vista y el estado básico de la ingesta. Pulse **Refresh** para actualizar. Un host aparece cuando el servidor acepta un evento de su colector.

## Revisar la cronología de cambios

Elija **All recent events** para consultar los eventos recientes o seleccione un incidente para cargar su ventana temporal. De forma predeterminada, incluye 60 minutos antes y 30 minutos después del inicio del incidente. Seleccione un host y una categoría para reducir la lista. Las horas se muestran en la zona horaria del navegador; se almacenan en UTC.

Seleccione una fila para abrir **Evidence detail**. Revise la fuente, el recurso, el tipo de cambio, la gravedad, el estado anterior y posterior, los factores de correlación y el resumen SHA-256 del evento. El resumen sirve como comprobación de integridad, pero no demuestra que el host de origen fuera confiable. Algunos tipos de evento contienen solo metadatos o hashes, no una copia de configuración.

## Declarar un incidente

Use **Declare incident** e indique un título claro, la hora de inicio, la gravedad y los nombres de los servicios afectados. Elija cuándo comenzaron los síntomas, no cuándo alguien abrió IncidentAtlas. Los nombres de servicios ayudan al motor a detectar recursos coincidentes. Cree la ventana del incidente y examine los eventos cercanos.

El MVP aún no ofrece un editor completo del ciclo de vida del incidente. Registre el contexto de la investigación con notas y comentarios sobre hipótesis; el flujo de estados operativos sigue siendo limitado.

## Evaluar posibles contribuciones

Pulse **Analyze incident window**. IncidentAtlas ordena las evidencias mediante factores visibles, como proximidad temporal, coincidencia con un servicio afectado, relevancia del tipo de evento y términos relacionados con síntomas. El motor actual es determinista y no usa un LLM. La puntuación sirve para priorizar, no es una probabilidad.

Abra el evento relacionado antes de decidir. Marque **Investigate**, **Reject** o **Confirm** solo cuando las evidencias respalden esa decisión. **Confirm** registra `confirmed_by_human`; es la única acción que marca una causa como confirmada por una persona. Añada una nota al evento para conservar su interpretación. Una puntuación baja o la ausencia de hipótesis no demuestra que no exista una causa.

## Crear un borrador de postmortem

Dentro de un incidente, elija **Download deterministic postmortem draft**. El archivo Markdown resume el incidente y vincula sus afirmaciones con identificadores de eventos y resúmenes de evidencia. Es un punto de partida: revise cada afirmación, añada el impacto en clientes y las acciones correctivas, y diferencie los hallazgos confirmados de las preguntas abiertas antes de compartirlo.

## Disponibilidad de evidencias

Los eventos y los artefactos tienen periodos de conservación independientes. Un artefacto vencido puede seguir apareciendo como metadatos, pero no se puede descargar. Si la investigación exige conservar evidencias, pida a una persona propietaria o administradora que active una retención legal antes de que venza el plazo. No copie artefactos sensibles en ubicaciones no aprobadas.

## Buenas prácticas de investigación

Empiece por la hora de los síntomas y el servicio afectado. Compare los cambios anteriores y posteriores, inspeccione las evidencias de origen y busque también indicios contradictorios. Anote la incertidumbre. Las marcas de tiempo, la identidad del host y los eventos pueden estar incompletos o verse afectados si el host fue comprometido.

---

Contact: Stephane Jacob <jacobstephane@outlook.com>
