# Orígenes SV

Sistema de gestión para la franquicia de pupuserías **Orígenes SV** («¡Puchica, qué buen sabor!»): pedidos, cocina, cobro, inventario, compras, personal y finanzas, con 8 roles (mesero, cocinero, jefe de cocina, encargado de bodega, gerente de sucursal, Recursos Humanos, gerente general y director).

## Arquitectura

```
Origenessv/
├── frontend/        React 19 + Vite · Tailwind CSS 4 (prefijo tw:) · React-Bootstrap (modales, panel lateral, toasts, menús, tablas)
├── backend/         Node 22 + Express 5 · API REST · pg (SQL) · JWT en cookie httpOnly · bcrypt
├── database/
│   ├── init/        01_schema.sql (esquema) · 02_seed.sql (datos demo); Docker los carga al crear la BD
│   └── diagrama-er.md   Diagrama entidad-relación (Mermaid)
├── Documentation/   (vacía por ahora)
└── docker-compose.yml   db (PostgreSQL 16) · backend · frontend (Nginx)
```

### Frontend (`frontend/src`)

- `roles.js`: menú de cada rol y sus pestañas. `pages/index.js` asocia cada entrada del menú con su pantalla; las pantallas se cargan por separado (`React.lazy`), así cada rol descarga solo su código.
- `pages/<rol>/`: una pantalla por entrada del menú (`mesero`, `cocinero`, `jefe`, `bodega`, `gerente`, `rrhh`, `gg`, `director`), más `Login` y `Perfil` (con «Mis pagos»).
- `components/`: piezas reutilizables: `Layout` (barra lateral, campana de pendientes, reloj), `ui` (botones, chips, tablas, panel lateral, KPIs…), `Selectores`, `Pedido`, `Compras`, `Personal` (cambiar rol, despedir), `Franquicia` (proveedores, facturas, contraseñas, credenciales) y `Graficas` (línea, barras y dona en SVG).
- `context/`: sesión y recarga de datos (`useDatos`), reloj simulado y diálogos globales (confirmar, motivo, clave de aprobaciones, avisos).
- `lib/`: cliente de la API, formatos, reglas de pedidos, Excel (`.xlsx` sin librerías) e impresión, lectura de fotos.

### Backend (`backend/src`)

- `app.js` monta las rutas; cada rol solo entra a las suyas (`soloRoles`). Con contraseña temporal solo se permite Perfil.
- `routes/`: `auth`, `sistema` (reloj, pendientes, restablecer datos), `perfil`, `catalogo`, `mesero`, `cocina`, `propuestas`, `bodega`, `gerente`, `rrhh`, `gg`, `director` y `franquicia` (lo que comparten RR. HH., gerente general y director: proveedores, facturas, contraseñas).
- `lib/`: reglas del negocio (`negocio` existencias, costos, tiempos, turnos; `compras`; `personal` niveles, despidos, indemnización y quincena; `nomina`; `proveedores`; `sucursales`; `panel` tableros), `procesos` (lo que mueve el reloj: precios semanales, llegadas de compras, lotes vencidos, ofertas, aumentos por antigüedad, avisos de stock, «precio por revisar», cierres ordenados), `permisos`, `clave` (clave de aprobaciones con 3 intentos) y `registro` (bitácora y avisos).
- `migraciones.js`: cambios de esquema idempotentes que se aplican al arrancar, para que una BD creada con una versión anterior quede igual a `01_schema.sql` sin perder datos.

### Base de datos

PostgreSQL con ~50 tablas para los 8 roles (ver `database/diagrama-er.md`). El **reloj simulado** vive en la tabla `sistema`: corre mientras alguien usa la app, se pausa tras 2 minutos sin actividad y se puede adelantar (+1 hora, +1 día, +7 días, +30 días) desde la barra superior. Toda acción queda en la **bitácora** (sin guardar contraseñas, claves ni PIN).

## Cómo ejecutar

Requisitos: Docker Desktop. Para desarrollo local también Node 22+.

### Opción A: todo con Docker

```bash
docker compose up -d --build
```

- App: http://localhost:8080 · API: http://localhost:4000/api/salud · PostgreSQL: `localhost:5433` (usuario/clave/BD: `origenes`)

### Opción B: base de datos en Docker y la app en modo desarrollo

```bash
docker compose up -d db
cd backend  && cp .env.example .env && npm install && npm run dev   # http://localhost:4000
cd frontend && npm install && npm run dev                           # http://localhost:5173
```

Para volver a los datos iniciales: botón **Restablecer datos** en la entrada, o `docker compose down -v` y volver a levantar.

### Variables de entorno (backend)

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | Conexión a PostgreSQL |
| `JWT_SECRET` | Firma de la sesión (cámbiala fuera de la demo) |
| `CORS_ORIGIN` | Dirección del frontend |
| `DEMO` | `true` permite adelantar el reloj y restablecer los datos |
| `COOKIE_SECURE` | `true` solo si la app se sirve por HTTPS |
| `SQL_DIR` | Carpeta con los `.sql` (para «Restablecer datos») |

## Usuarios de prueba

Contraseña de todos: `demo`. Clave de aprobaciones (gerentes y gerente general): `1234`. PIN de directores: `2468`.

| Rol | Usuarios |
|---|---|
| Mesero | ana, luis (Centro) · marta (Escalón) |
| Cocinero | carlos, rosa (Centro) · pedro (Escalón) |
| Jefe de cocina | julia (Centro) · mario (Escalón) |
| Encargado de bodega | sofia · daniel |
| Gerente de sucursal | elena · ricardo |
| Recursos Humanos | patricia |
| Gerente general | hector |
| Director | isabel · fernando |
