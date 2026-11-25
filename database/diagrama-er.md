# Diagrama entidad-relación · Orígenes SV

Esquema completo en [`init/01_schema.sql`](init/01_schema.sql). GitHub dibuja los diagramas Mermaid de abajo directamente. Para no saturar un solo dibujo, el modelo se divide en cinco áreas. Una tabla que aparece en dos áreas es la misma tabla.

**Notación:** `PK` llave primaria · `FK` llave foránea · `UK` valor único. `||--o{` = uno a muchos · `||--o|` = uno a cero o uno.

## 1. Organización y personal

```mermaid
erDiagram
    roles ||--o{ usuarios : "tiene"
    roles ||--o{ plantilla_minima : "define"
    roles ||--o| roles : "atiende_reset"
    tamanos_sucursal ||--o{ plantilla_minima : "exige"
    tamanos_sucursal ||--o{ sucursales : "clasifica"
    zonas ||--o{ sucursales : "ubica"
    sucursales ||--o{ usuarios : "emplea"
    sucursales ||--o{ sucursal_plantilla : "objetivo"
    sucursales ||--o{ sucursal_historial : "registra"
    sucursales ||--o{ vacantes : "abre"
    roles ||--o{ vacantes : "para"
    usuarios ||--o{ usuario_historial : "registra"
    usuarios ||--o{ turnos : "trabaja"
    usuarios ||--o{ aumentos : "recibe"

    roles {
        varchar id PK
        varchar nombre UK
        smallint nivel
        varchar alcance
        varchar pantalla_inicio
        numeric salario
        varchar atiende_reset FK
    }
    zonas {
        varchar nombre PK
        numeric costo_min
        numeric costo_max
    }
    tamanos_sucursal {
        varchar id PK
        varchar nombre
        numeric factor_costo
        smallint mesas_base
    }
    plantilla_minima {
        varchar tamano PK,FK
        varchar rol_id PK,FK
        smallint cantidad
    }
    sucursales {
        int id PK
        varchar nombre UK
        varchar zona FK
        varchar tamano FK
        varchar estado
        smallint mesas
        numeric costo
    }
    sucursal_plantilla {
        int sucursal_id PK,FK
        varchar rol_id PK,FK
        smallint cantidad
    }
    sucursal_historial {
        int id PK
        int sucursal_id FK
        timestamptz fecha
        varchar tipo
    }
    usuarios {
        int id PK
        varchar usuario UK
        varchar nombre
        varchar rol_id FK
        int sucursal_id FK
        text pass_hash
        text clave_hash
        text pin_hash
        varchar estado
        timestamptz ingreso
        boolean cambiar_pass
    }
    usuario_historial {
        int id PK
        int usuario_id FK
        timestamptz fecha
        varchar tipo
        text detalle
    }
    turnos {
        int id PK
        int usuario_id FK
        date semana "NULL = base"
        varchar_arr dias
    }
    aumentos {
        int id PK
        int usuario_id FK
        numeric antes
        numeric despues
    }
    vacantes {
        int id PK
        int sucursal_id FK
        varchar rol_id FK
        smallint cantidad
        varchar estado
        int solicitud_id FK
    }
```

## 2. Inventario y proveedores

```mermaid
erDiagram
    mp_unidades ||--o{ materias_primas : "mide"
    mp_categorias ||--o{ materias_primas : "agrupa"
    proveedores ||--o{ proveedor_materias : "vende"
    materias_primas ||--o{ proveedor_materias : "ofrecida"
    proveedores ||--o{ proveedor_precios_hist : "historial"
    proveedores ||--o{ proveedor_sucursales : "entrega en"
    sucursales ||--o{ proveedor_sucursales : "recibe de"
    proveedores ||--o{ proveedor_transporte_hist : "historial"
    proveedores ||--o{ proveedor_creditos : "debe"
    materias_primas ||--o{ lotes : "existencias"
    sucursales ||--o{ lotes : "guarda"
    proveedores ||--o{ lotes : "surtió"
    sucursales ||--o{ conteos : "cuenta"
    usuarios ||--o{ conteos : "bodega"
    conteos ||--o{ conteo_filas : "contiene"
    materias_primas ||--o{ conteo_filas : "contada"
    sucursales ||--o{ avisos_stock : "aviso"
    materias_primas ||--o{ materia_categorias : "tiene"
    mp_categorias ||--o{ materia_categorias : "clasifica"
    sucursales ||--o{ sucursal_mp_inhabilitada : "no usa"
    materias_primas ||--o{ sucursal_mp_inhabilitada : "inhabilitada"
    proveedores ||--o{ proveedor_cambios : "cambios"
    usuarios ||--o{ proveedores : "registra / edita"

    mp_unidades {
        varchar nombre PK
    }
    mp_categorias {
        varchar nombre PK
    }
    materias_primas {
        int id PK
        varchar nombre UK
        varchar unidad FK
        varchar categoria FK
        smallint vida_dias
        varchar estado
    }
    proveedores {
        int id PK
        varchar nombre UK
        varchar condicion_pago
        varchar politica_tipo
        smallint politica_tolerancia_h
        varchar estado "Activo, Inhabilitado, Eliminado"
        numeric saldo_favor
        int creado_por FK
        int editado_por FK
    }
    proveedor_cambios {
        int id PK
        int proveedor_id FK
        timestamptz fecha
        text detalle
    }
    materia_categorias {
        int mp_id PK,FK
        varchar categoria PK,FK
    }
    sucursal_mp_inhabilitada {
        int sucursal_id PK,FK
        int mp_id PK,FK
        int solicitud_id FK
    }
    proveedor_materias {
        int proveedor_id PK,FK
        int mp_id PK,FK
        numeric precio_base
        numeric precio_actual
    }
    proveedor_precios_hist {
        int id PK
        int proveedor_id FK
        int mp_id FK
        numeric precio
        timestamptz desde
        timestamptz hasta
    }
    proveedor_sucursales {
        int proveedor_id PK,FK
        int sucursal_id PK,FK
        smallint entrega_h
        numeric transporte
    }
    proveedor_transporte_hist {
        int id PK
        int proveedor_id FK
        int sucursal_id FK
        numeric costo
    }
    proveedor_creditos {
        int id PK
        int proveedor_id FK
        int factura_id FK
        numeric monto
    }
    lotes {
        int id PK
        varchar sku UK
        int mp_id FK
        int sucursal_id FK
        int proveedor_id FK
        int compra_id FK
        timestamptz vence
        numeric cantidad
        numeric precio
        varchar estado
    }
    conteos {
        int id PK
        int sucursal_id FK
        int bodega_id FK
        varchar estado
        int decidio_id FK
    }
    conteo_filas {
        int conteo_id PK,FK
        int mp_id PK,FK
        numeric sistema
        numeric contado
    }
    avisos_stock {
        int sucursal_id PK,FK
        int mp_id PK,FK
    }
```

## 3. Catálogo de venta

```mermaid
erDiagram
    categorias ||--o{ producto_categorias : "agrupa"
    productos ||--o{ producto_categorias : "pertenece"
    productos ||--o{ recetas : "lleva"
    materias_primas ||--o{ recetas : "ingrediente"
    productos ||--o{ extra_productos : "extra"
    productos ||--o{ extra_productos : "se ofrece en"
    productos ||--o{ producto_versiones : "versiones"
    productos ||--o{ precios_historial : "precios"
    sucursales ||--o{ sucursal_menu : "vende"
    productos ||--o{ sucursal_menu : "en menú"
    sucursales ||--o{ sucursal_revisar : "revisar"
    productos ||--o{ sucursal_revisar : "precio por revisar"
    sucursales ||--o{ menu_historial : "altas y bajas"
    productos ||--o{ menu_historial : "en menú"

    categorias {
        int id PK
        varchar nombre UK
        varchar icono
    }
    productos {
        int id PK
        varchar nombre UK
        numeric precio
        smallint tiempo_min
        varchar estado
        boolean es_extra
        boolean es_reventa
        smallint version
    }
    producto_categorias {
        int producto_id PK,FK
        int categoria_id PK,FK
    }
    recetas {
        int producto_id PK,FK
        int mp_id PK,FK
        numeric cantidad
    }
    extra_productos {
        int extra_id PK,FK
        int producto_id PK,FK
    }
    producto_versiones {
        int id PK
        int producto_id FK
        smallint version
        jsonb receta
    }
    precios_historial {
        int id PK
        int producto_id FK
        numeric precio
        timestamptz desde
        timestamptz hasta
        int solicitud_id FK
    }
    sucursal_menu {
        int sucursal_id PK,FK
        int producto_id PK,FK
    }
    sucursal_revisar {
        int sucursal_id PK,FK
        int producto_id PK,FK
    }
    menu_historial {
        int id PK
        int sucursal_id FK
        int producto_id FK
        varchar estado
        timestamptz fecha
        text razon
    }
```

## 4. Servicio, compras y finanzas

```mermaid
erDiagram
    sucursales ||--o{ pedidos : "recibe"
    usuarios ||--o{ pedidos : "mesero / cocinero"
    pedidos ||--o| pedidos : "reposicion_de"
    pedidos ||--o{ pedido_lineas : "contiene"
    productos ||--o{ pedido_lineas : "vendido"
    pedido_lineas ||--o{ pedido_linea_extras : "con"
    productos ||--o{ pedido_linea_extras : "extra"
    pedidos ||--o{ pedido_reservas : "reserva"
    materias_primas ||--o{ pedido_reservas : "reservada"
    usuarios ||--o{ cajas : "abre"
    cajas ||--o{ ventas : "cobra"
    pedidos ||--o| ventas : "se cobra en"
    ventas ||--o{ venta_ajustes : "devoluciones"
    sucursales ||--o{ compras : "compra"
    proveedores ||--o{ compras : "surte"
    compras ||--o{ compra_lineas : "contiene"
    compras ||--o{ compra_recepcion : "recibe"
    compras ||--o| compras : "pendiente_de"
    compras ||--o{ lotes : "genera"
    compras ||--o| facturas : "factura"
    facturas ||--o{ factura_lineas : "detalle"
    facturas ||--o{ factura_creditos : "créditos"
    lotes ||--o| ofertas : "oferta"
    ofertas ||--o{ oferta_productos : "aplica a"
    sucursales ||--o{ mermas : "pierde"
    lotes ||--o{ mermas : "vencido"
    pedidos ||--o{ mermas : "pérdida"
    usuarios ||--o{ facturas : "archiva (RR. HH.)"

    pedidos {
        int id PK
        int num UK
        int sucursal_id FK
        int mesero_id FK
        int cocinero_id FK
        varchar tipo
        smallint mesa
        varchar estado
        numeric total
        int est_seg
        int reposicion_de FK
        timestamptz creado
    }
    pedido_lineas {
        int id PK
        int pedido_id FK
        int producto_id FK
        smallint cantidad
        numeric precio_unit
    }
    pedido_linea_extras {
        int linea_id PK,FK
        int extra_id PK,FK
        numeric precio
    }
    pedido_reservas {
        int pedido_id PK,FK
        int mp_id PK,FK
        numeric cantidad
    }
    cajas {
        int id PK
        int sucursal_id FK
        int mesero_id FK
        numeric fondo
        varchar estado
        numeric declarado
    }
    ventas {
        int id PK
        int pedido_id FK,UK
        int caja_id FK
        varchar metodo
        varchar tipo_doc
        int correlativo
        numeric total
        numeric propina
    }
    venta_ajustes {
        int id PK
        int venta_id FK
        numeric monto
        smallint pct
    }
    compras {
        int id PK
        int sucursal_id FK
        int proveedor_id FK
        varchar estado
        numeric total
        int factura_id FK
        int pendiente_de FK
    }
    compra_lineas {
        int id PK
        int compra_id FK
        int mp_id FK
        numeric cantidad
        numeric precio
    }
    compra_recepcion {
        int id PK
        int compra_id FK
        int mp_id FK
        varchar sku
        numeric cantidad
    }
    facturas {
        int id PK
        varchar num UK
        int compra_id FK
        int proveedor_id FK
        numeric monto
        varchar estado "Pendiente, Pagada, Anulada"
        numeric pagado_monto
        numeric saldo_usado
        timestamptz archivada
        int archivada_por FK
    }
    factura_lineas {
        int factura_id PK,FK
        int mp_id PK,FK
        numeric cantidad
    }
    factura_creditos {
        int id PK
        int factura_id FK
        numeric monto
    }
    ofertas {
        int id PK
        int lote_id FK,UK
        smallint pct
        varchar estado
    }
    oferta_productos {
        int oferta_id PK,FK
        int producto_id PK,FK
    }
    mermas {
        int id PK
        int sucursal_id FK
        varchar tipo
        int lote_id FK
        int pedido_id FK
        numeric costo
    }
```

## 5. Nómina y gobierno

```mermaid
erDiagram
    planillas ||--o{ planilla_filas : "incluye"
    usuarios ||--o{ planilla_filas : "cobra"
    planillas ||--o{ reportes_pago : "se reporta"
    sucursales ||--o{ reportes_pago : "por sucursal"
    planillas ||--o{ boletas : "emite"
    usuarios ||--o{ boletas : "recibe"
    usuarios ||--o{ solicitudes : "pide / afecta"
    sucursales ||--o{ solicitudes : "origen"
    pedidos ||--o{ solicitudes : "sobre"
    ventas ||--o{ solicitudes : "devolución"
    productos ||--o{ solicitudes : "sobre"
    roles ||--o{ solicitudes : "aprueba"
    solicitudes ||--o{ vacantes : "origina"
    usuarios ||--o{ propuestas_sucursal : "propone / decide"
    zonas ||--o{ propuestas_sucursal : "zona"
    roles ||--o{ notificaciones : "dirigida a"
    sucursales ||--o{ notificaciones : "de"
    usuarios ||--o{ bitacora : "realiza"

    planillas {
        int id PK
        varchar quincena UK
        timestamptz generada
    }
    planilla_filas {
        int planilla_id PK,FK
        int usuario_id PK,FK
        numeric bruto
        numeric isss
        numeric afp
        numeric renta
        numeric liquido
        numeric base
    }
    reportes_pago {
        int id PK
        int planilla_id FK
        int sucursal_id FK
        numeric total
        varchar estado
        timestamptz enviado
        int decidio_id FK
    }
    boletas {
        int id PK
        int planilla_id FK
        int usuario_id FK
    }
    solicitudes {
        int id PK
        varchar tipo
        varchar estado
        int sucursal_id FK
        int solicitante_id FK
        int usuario_id FK
        int pedido_id FK
        int venta_id FK
        int producto_id FK
        varchar aprueba_rol FK
        jsonb datos
        timestamptz fecha
    }
    propuestas_sucursal {
        int id PK
        varchar tipo
        varchar zona FK
        numeric costo
        int sucursal_id FK
        varchar estado
        int pide_id FK
    }
    notificaciones {
        int id PK
        varchar rol_id FK
        int sucursal_id FK
        varchar titulo
        boolean leida
    }
    bitacora {
        bigint id PK
        timestamptz fecha
        int usuario_id FK
        varchar accion
        varchar elemento
        text motivo
        boolean con_clave
    }
```

## Tablas de apoyo

| Tabla | Para qué sirve |
|---|---|
| `sistema` | Una sola fila con el reloj simulado: `hora = reloj_base + (ahora_real − real_base)`; con `pausado` el reloj se queda en `reloj_base` (nadie usa la app). Adelantar el tiempo suma a `reloj_base`. |
| `configuracion` | Una sola fila con los parámetros del negocio (IVA, márgenes, vigencia de cotizaciones, etc.). |
| `v_stock`, `v_reservado` | Vistas: existencias vigentes por sucursal y lo apartado por pedidos que aún no se preparan. |
| `ahora()` | Función SQL que devuelve la hora simulada. |
