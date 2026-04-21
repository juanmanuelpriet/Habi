# HabiWallet — Diario de Desarrollo y Decisiones Técnicas

Este documento detalla mi proceso de pensamiento, las decisiones arquitectónicas que tomé al construir esta API de billetera digital y cómo utilicé herramientas de IA para potenciar mi flujo de trabajo.

---

## Mis Decisiones

### 1. El Ledger de Doble Entrada como Fuente de Verdad
Mi decisión más importante fue no confiar ciegamente en una columna de `balance` en la tabla de cuentas. Aunque existe, la trato como un **caché desnormalizado** para consultas rápidas. 
- **Por qué**: En sistemas financieros, el dinero no puede aparecer ni desaparecer. Al implementar un ledger (`ledger_entries`), cada movimiento genera dos registros (crédito y débito). Si alguna vez dudo de un balance, puedo reconstruirlo sumando el historial. Es el estándar de oro en Fintech.

### 2. Prevención de Deadlocks mediante Ordenamiento Determinístico
Cuando dos transferencias ocurren simultáneamente entre las mismas cuentas (A→B y B→A), es fácil caer en un abrazo mortal (*deadlock*).
- **Cómo lo solucioné**: Implementé una lógica donde, sin importar quién envía a quién, el sistema siempre adquiere los bloqueos de fila (`SELECT FOR UPDATE`) siguiendo un orden ascendente por el UUID de la cuenta. Esto garantiza que una transacción siempre espere a la otra de forma predecible.

### 3. Fail-Fast con `NOWAIT`
En la base de datos, preferí usar `with_for_update(nowait=True)`.
- **Por qué**: En lugar de que un request se quede colgado esperando un lock durante segundos (degradando la experiencia de todos los usuarios), prefiero que falle inmediatamente con un error 503 o 409. Esto permite que el cliente (frontend o app) implemente un reintento con *exponential backoff*, lo cual es mucho más saludable para el ecosistema.

### 4. Idempotencia Rigurosa
Las redes fallan. Si un cliente envía una transferencia y la conexión se corta, no sabe si el dinero salió o no.
- **Mi enfoque**: Obligo (o sugiero fuertemente) el uso de una `idempotency_key`. La guardo con una restricción `UNIQUE` en la base de datos. Si el cliente reintenta la misma operación, mi sistema detecta la clave y devuelve el resultado original en lugar de ejecutar un nuevo débito.

### 5. Tipos de Datos y Precisión (BIGINT)
Nunca consideré usar `float` para dinero. 
- **Decisión**: Guardo todo en **centavos** usando `BIGINT`. Esto evita los errores de redondeo de punto flotante de IEEE 754 (como que `0.1 + 0.2` no sea exactamente `0.3`). La conversión a pesos es puramente visual y ocurre solo en la capa de serialización.

---

## Qué dejé fuera (y por qué)

1. **Autenticación y JWT**: Aunque es crítico, decidí dejarlo fuera del scope de este reto técnico. En un escenario real, esto viviría en un microservicio de Identidad o en un API Gateway (como Kong o AWS API Gateway), separando la lógica de negocio de la de seguridad.
2. **Conversión de Divisas (FX)**: El sistema soporta el campo `currency`, pero actualmente solo opera si ambas cuentas tienen la misma moneda. Implementar un motor de FX requiere integraciones con proveedores de tasas en tiempo real (como Bloomberg o Reuters) y lógica de "spread" bancario, lo cual añadía una complejidad innecesaria para este MVP.
3. **Paginación Basada en Cursor**: Usé `offset/limit` por simplicidad de lectura para el revisor. Para producción, usaría cursores (basados en ID o timestamp) para evitar saltos de registros cuando se insertan nuevos datos mientras el usuario navega.

---

## Supuestos que hice

- **Entorno Confiable**: Asumo que el API está detrás de una red privada o un balanceador que maneja el cifrado SSL/TLS.
- **Hardware con Atomicidad**: Asumo que PostgreSQL corre sobre un sistema de archivos que garantiza escrituras atómicas de bloque (evitando corrupciones de página).
- **Volumen Inicial**: Diseñé para un throughput de ~1,000 a 5,000 transacciones por segundo (TPS). Por encima de eso, PostgreSQL empezaría a ser el cuello de botella por contención de locks, y requeriría una arquitectura de "sharding" o colas de mensajes.

---

## Qué no sé?

- **Regulación Colombiana Específica**: No soy experto en los detalles técnicos de la Circular Básica Jurídica de la Superfinanciera de Colombia. Desconozco si hay requisitos de retención de logs inmutables en hardware específico o auditorías de "Sarlaft" que deban ir embebidas en la base de datos.
- **Escalamiento masivo de PostgreSQL**: Aunque sé cómo optimizar queries, nunca he administrado una base de datos de pagos con petabytes de datos en producción real. Mi conocimiento es teórico y basado en mejores prácticas de la industria (Stripe, Uber Engineering).

---

## Cómo usé la IA en este proceso

La IA (Antigravity/Gemini) fue mi **compañera de pair programming**, no mi reemplazo. Así la integré:

1. **Abogado del Diablo**: Una vez diseñado el modelo de datos, le presenté el esquema a la IA y le pregunté: *"Intenta romper esta transacción. ¿Bajo qué condiciones de carrera podría perder dinero?"*. Esto me ayudó a validar la necesidad del bloqueo ordenado por UUID.
2. **Refactorización de Algoritmos**: Para la "Compresión de Deudas Grupales", implementé la lógica base y usé la IA para verificar si existían casos borde (como grupos con balances netos de cero pero deudas circulares) que mi algoritmo no estuviera cubriendo eficientemente.
3. **Generador de "Scaffolding"**: Todas las partes repetitivas —los modelos de Pydantic, los esquemas de SQLAlchemy y los mocks de los tests unitarios— fueron generados por IA siguiendo mis instrucciones de diseño. Esto me permitió concentrarme en la complejidad del `transfer_service.py`, que es el corazón del sistema.
4. **Documentación y "Rubber Ducking"**: Usé la IA para verbalizar mis decisiones. Explicarle a la IA por qué elegí `BIGINT` me ayudó a consolidar mis propios argumentos para este README.

---
*Desarrollado por Juan Manuel Prieto.*
