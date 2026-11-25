# Reglas de negocio · Orígenes SV

Resumen de cómo se comporta el sistema en los puntos donde las reglas no son obvias. Los parámetros marcados con `configuracion` se guardan en la fila única de esa tabla; el resto está en el código (`backend/src/lib`).

## Pedidos, cocina y cobro

- **Cocina:** cada cocinero prepara a la vez un máximo de pedidos (`configuracion.cocina_simultaneos`, 3 por defecto). La capacidad de la cocina depende de cuántos cocineros hay activos.
- **Delivery:** el pedido lleva dirección y teléfono del cliente y un cargo de envío fijo con IVA incluido (`configuracion.envio_delivery`, $2.00 por defecto). El envío forma parte del total.
- **Pedido de mesa:** cuando el cliente se retira, el mesero pide la cuenta (`pedidos.cuenta_pedida`); desde ese momento se puede cobrar.
- **Cancelación ya en cocina:** si el pedido se cancela después de que el cocinero lo inició, los insumos ya se usaron: se registran como merma y **el cliente paga su costo con IVA** (`pedidos.cargo_cancel`). El mesero lo cobra como cualquier venta, con una sola línea «Insumos ya usados (pedido cancelado)». Si se cancela por demora (culpa del restaurante) no se cobra nada.
- **Mesa de un pedido cancelado o rechazado:** la mesa **sigue ocupada**, porque el cliente sigue sentado. El mesero la libera cuando se va (después de cobrar los insumos, si los hay) o le toma otro pedido en esa misma mesa.
- **Reposición:** solo se pide sobre un pedido entregado y todavía sin cobrar. Una vez cobrado ya no se repone el platillo, y no se pide reposición de una reposición.
- **Documento de venta:** el ticket o factura solo existe cuando el pedido está pagado. Cada venta guarda su código de generación y su sello (simulados, estilo DTE).
- **Valoración:** justo después del pago el cliente puede dar de 1 a 5 estrellas, una sola vez por venta. Las valoraciones se promedian por sucursal y se muestran en las tarjetas de sucursales.
- **Precios:** no se aprueba un precio con una ganancia menor al mínimo sobre el costo (`configuracion.ganancia_min_pct`, 30 % por defecto, sobre el precio sin IVA).
- **Menú de la sucursal:** agregar un producto y quitarlo son solicitudes del gerente de sucursal que aprueba el gerente general. Mientras no se aprueba, el producto sigue a la venta.
- **Pedidos pendientes:** un producto no se puede quitar del menú ni eliminar del catálogo mientras haya pedidos sin cerrar (ni cobrados, cancelados o rechazados) que lo lleven. Se valida al pedirlo y otra vez al aprobarlo.
- **Caja:** se abre dentro del turno del mesero. Abrir tarde, abrir fuera de turno (con autorización del gerente) y seguir con la caja abierta después del turno generan avisos en rojo al mesero y al gerente.

## Compras

- **Reclamo al proveedor:** si la mercancía llega con problemas, el gerente de sucursal reclama un monto (hasta lo recibido más el transporte). **No pasa por el gerente general:** el proveedor compensa según su política (`proveedores.politica_tipo`): descuento o reembolso. Si la factura aún no se paga, baja su monto; si ya se pagó, queda saldo a favor con el proveedor.
- **Devoluciones y cancelaciones de compras** siguen pasando por el gerente general.

## Fotos

- Productos, materias primas, proveedores, sucursales y personas pueden tener foto. Las que se suben desde la app se guardan en `backend/uploads/` (no va a Git).
- Las fotos de la demo (15 productos y 2 sucursales) viajan con el proyecto en `frontend/public/fotos/`. Se asignan en `02_seed.sql` y, para bases ya creadas, `migraciones.js` las asigna **una sola vez** y solo a lo que no tiene foto (la columna `sistema.fotos_demo` marca que ya se hizo), de modo que quitar una foto no hace que reaparezca.
- Un producto o sucursal sin foto muestra un ícono. Las imágenes se reducen en el navegador antes de subirse (máximo 1.5 MB).

## Sucursales

- **Compra:** el gerente general propone comprar una sucursal (zona y tamaño; el costo cae dentro de un intervalo calculado por el sistema), el director la aprueba y el gerente general la **abre**. Al abrirla se le pone un **nombre** (opcional, único sin importar mayúsculas, de 3 a 60 caracteres) y una **dirección** (de 8 a 160 caracteres). Si no se escribe nombre se usa el de la zona, con número cuando ya hay otra sucursal ahí («Escalón 2»). El director también puede crear una sucursal directamente con los mismos datos.
- **Qué se genera al abrir:** menú con todo el catálogo, plantilla mínima según el tamaño, condiciones de cada proveedor (transporte y tiempo de entrega) y vacantes de **máxima prioridad** para Recursos Humanos.
- **Edición:** el gerente general y el director pueden cambiar el nombre y la dirección desde la ficha de la sucursal (la zona y el tamaño no cambian). Cada cambio queda en la bitácora y en el historial de la sucursal con los valores anteriores.
- **Venta y cierre:** al aprobarse una venta la sucursal pasa a «Cierre ordenado»; cuando ya no tiene pedidos ni cajas abiertos pasa a «Cerrada». Su personal queda **pendiente de reubicación**: Recursos Humanos lo reubica en una sucursal con vacantes o, si no las hay, solicita su despido desde el mismo panel.

## Personal

- **Despido (el mismo proceso para todos):** lo solicita el gerente de sucursal (solo de su personal) o Recursos Humanos, siempre con la **razón** y la **indemnización estimada** (art. 58). Si lo pide el gerente, primero lo **acepta Recursos Humanos**; después lo **aprueba el gerente general**, y solo entonces se aplica. El gerente de sucursal ya no despide directamente. Al aplicarse, la persona queda sin acceso (no puede iniciar sesión ni mantener la sesión abierta) y el historial se conserva. El director, como máxima autoridad, puede aplicar un despido directamente.
- **Reingreso:** si se contrata de nuevo a una persona con el mismo DUI, se reactiva su cuenta anterior en lugar de crear otra. El correo y el DUI son únicos.
- **Plantilla mínima:** cada sucursal tiene un mínimo de personas por rol según su tamaño. Una baja que la deja por debajo abre una vacante para Recursos Humanos.

### Renuncia

Cualquier usuario, excepto el director, puede presentar su renuncia desde **Perfil**. **Nadie la aprueba ni la rechaza.**

1. Al pulsar «Presentar renuncia» se muestra primero un aviso con lo que debe hacer según su rol (cerrar caja, terminar pedidos, entregar pendientes) y luego se pide un motivo (mínimo 10 caracteres).
2. Ese día es su **último día de trabajo**. La vacante se abre de inmediato para Recursos Humanos, aunque sea la única persona con su rol en la sucursal. Sigue trabajando con normalidad y ve un aviso fijo.
3. La persona sale cuando pulsa **«Terminar mi jornada»** (no se permite mientras tenga caja o pedidos abiertos) o, si cambia el día, cuando el sistema cierra su acceso automáticamente al no estar ocupada. Su estado pasa a «Renunció»: no puede entrar, pero su historial se conserva. Si se vuelve a contratar con el mismo DUI se reactiva la cuenta.
4. Durante ese último día puede **pedir retirar su renuncia** (una sola solicitud, con motivo). Recursos Humanos decide: si **acepta**, la renuncia se cancela, la persona se queda y la vacante abierta por esa renuncia se cancela; si **rechaza** (con motivo de al menos 10 caracteres), hoy sigue siendo su último día. Mientras la solicitud está pendiente no puede terminar su jornada.
5. Si quien renuncia es de Recursos Humanos, el retiro lo decide el gerente general.
6. El **único gerente general** y la **única persona de Recursos Humanos** no pueden renunciar: son roles centrales sin mecanismo de vacantes.
7. Una renuncia vigente cancela las solicitudes de despido pendientes de esa persona, y un despido aplicado cancela su renuncia pendiente.

## Bitácora y avisos

- **Pendientes:** la campana y el número rojo de cada entrada del menú lateral usan la misma cuenta (la suma de los pendientes de sus pestañas), así nunca difieren.

Toda acción importante queda en la bitácora (sin guardar contraseñas, claves ni PIN) y se puede filtrar por sucursal, rol y mesero. Los avisos urgentes se muestran en rojo.
