# Portal-Cargo-Training
1. Contexto General del Proyecto
Nombre: LATAM CARGO - Portal de Seguimiento de Capacitaciones (CGO - GRH CAO Y RAMPA).

Propósito: Sistema de gestión, control de cumplimiento y planificación de capacitaciones operativas.

Stack Tecnológico: Backend en Google Apps Script (GAS V8) usando .gs y Frontend nativo en HTML/CSS/Vanilla JS (Single Page Application - SPA) servido mediante HtmlService.

Base de Datos: Múltiples hojas de cálculo de Google Sheets conectadas (ej. hojas maestras de cursos, BIBLIOTECA, USUARIOS, SALAS, SOLICITUDES).

2. Arquitectura de Flujo de Datos y Rendimiento
Conexión asíncrona: Toda la comunicación entre cliente y servidor se hace mediante llamadas google.script.run con callbacks asíncronos (withSuccessHandler).

Optimización extrema: El backend extrae datos (ej. leerHoja(), getRegionalData(), getDashboardStats()), los pasa por adaptadores/minificación y usa Caché comprimida GZIP/Base64 (caché por hoja y por ejecución) para evitar lecturas repetidas a Sheets y maximizar la velocidad.

Vistas "Delgadas": Las vistas finales (LATAM, NAM, RAMPA, etc.) son contenedores HTML vacíos. Solo declaran la estructura (KPIs, filtros, tablas); el pintado real queda delegado a la lógica del cliente en JavaScript una vez que llegan los datos del servidor.

3. Seguridad y Control de Acceso
Control por Roles: El sistema lee el currentUser y ajusta dinámicamente la navegación, pestañas y permisos de lectura/escritura basándose en 4 roles principales: ADMIN, CAPACITY, JEFE, COLABORADOR.

Existen whitelists específicas para módulos delicados como el de Planificación.

4. Estructura de Interfaz (UI/UX)
SPA (Single Page Application): La navegación se gestiona ocultando y mostrando contenedores (divs) mediante clases CSS (ej. d-none), sin recargar la página.

Barra Lateral (Sidebar): Contiene el menú principal. Recientemente implementamos una función colapsable (toggle) con un botón reubicado a la derecha del logo/título de la app para ganar espacio de trabajo.

Modales Propios: Prohibido usar alert() o prompt() nativos. Todo el sistema opera con modales HTML/CSS/JS personalizados inyectados en el DOM (para detalles de cursos, envío de correos, confirmaciones).

Librerías externas: Uso de Flatpickr para forzar selectores de hora en formato estricto de 24h (HH:mm) en los formularios.

5. Módulos y Funciones Clave Recientes
Módulo de Planificación (CRUD de Cursos):

Formularios modales en formato Grid (2 columnas) para Crear, Modificar y Cancelar cursos.

Los selectores de Sigla, Instructor y Sala se alimentan dinámicamente desde el backend.

Autocompletado inteligente: Al seleccionar una Sigla, el Frontend busca en un array local y auto-completa el Título del curso.

Flujo de Aprobación Cross-App (Planificación ↔ Calendario):

Regla de Negocio Crítica: El módulo de Planificación NO escribe directamente en la base de datos maestra. Todo cambio (Crear/Modificar/Cancelar) empaqueta un payload y genera un registro en una hoja de SOLICITUDES con estado PENDIENTE.

Los Administradores usan una aplicación hermana ("Calendario") para aprobar estas solicitudes, lo que finalmente detona el cambio en la base maestra.

Gestión de Fechas de Colaboradores:

Existe lógica estricta en el JS del Frontend para forzar el formato de fechas a DD/MM/YYYY, mitigando bugs donde JS interpreta números bajos como Meses en lugar de Días.

6. Estado Actual y Primer Problema a Resolver (Bug de Ruteo)
El Problema: Actualmente, la aplicación sufre un fallo en el enrutador SPA. Al hacer clic en los botones del menú lateral para las vistas "Resumen Admin", "Configuración", "Guía de Usuario" y "Control Tower", el contenedor principal se queda completamente en blanco.

Sospecha principal: Al ser un fallo simultáneo en múltiples vistas, el error radica en la función general de navegación JS (que cambia las clases para mostrar/ocultar los IDs de las secciones) o en los atributos HTML de los botones del menú (ej. onclick o data-target desajustados respecto al ID del contenedor).

Instrucción para la IA:
Confirma que has leído, asimilado y comprendido esta arquitectura respondiendo "Arquitectura asimilada". Luego, indícame qué fragmentos de código del enrutador JS o del HTML del menú necesitas que te comparta para diagnosticar y solucionar el problema de las vistas en blanco. No asumas archivos ni me pidas reemplazar el código completo; trabajaremos de forma quirúrgica.
Confirma que has leído, asimilado y comprendido esta arquitectura respondiendo "Arquitectura asimilada". Luego, indícame qué fragmentos de código del enrutador JS o del HTML del menú necesitas que te comparta para diagnosticar y solucionar el problema de las vistas en blanco. No asumas archivos ni me pidas reemplazar el código completo; trabajaremos de forma quirúrgica.
