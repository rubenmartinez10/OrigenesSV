-- =====================================================================
--  Orígenes SV · Datos iniciales (demo)
--  Mismos datos que el borrador: 2 sucursales, 16 usuarios, 22 materias
--  primas, 15 productos, 6 extras, 4 proveedores, lotes, facturas y
--  15 días de ventas históricas. El reloj simulado arranca el
--  22 nov 2026 a las 09:20 (hora de El Salvador).
--  Contraseña de todos: demo · clave de gerentes y gerente general: 1234
--  · PIN de directores: 2468
-- =====================================================================
SET timezone TO 'America/El_Salvador';

-- ---------- sistema y configuración ----------
INSERT INTO sistema (id, reloj_base, real_base, semana_aplicada)
VALUES (1, '2026-11-22 09:20:00-06', now(),
        floor(extract(epoch FROM timestamptz '2026-11-22 09:20:00-06') * 1000 / 604800000)::int);

INSERT INTO configuracion (id) VALUES (1);

-- ---------- roles ----------
INSERT INTO roles (id, nombre, nivel, alcance, pantalla_inicio, salario, salario_desde, atiende_reset) VALUES
 ('director','Director',             6,'franquicia','ingresos',  3500,'2026-05-06 09:20:00-06','director'),
 ('gg',      'Gerente general',      5,'franquicia','panel',     2200,'2026-05-06 09:20:00-06','director'),
 ('rrhh',    'Recursos Humanos',     4,'franquicia','personal',  1000,'2026-05-06 09:20:00-06','gg'),
 ('gerente', 'Gerente de sucursal',  3,'sucursal',  'resumen',   1100,'2026-05-06 09:20:00-06','rrhh'),
 ('jefe',    'Jefe de cocina',       2,'sucursal',  'cola',       620,'2026-05-06 09:20:00-06','rrhh'),
 ('bodega',  'Encargado de bodega',  2,'sucursal',  'inventario', 540,'2026-05-06 09:20:00-06','rrhh'),
 ('mesero',  'Mesero',               1,'sucursal',  'nuevo',      420,'2026-05-06 09:20:00-06','rrhh'),
 ('cocinero','Cocinero',             1,'sucursal',  'mipedido',   450,'2026-05-06 09:20:00-06','rrhh');

-- ---------- zonas y tamaños ----------
INSERT INTO zonas (nombre, costo_min, costo_max) VALUES
 ('San Salvador',250,400),('Escalón',300,450),('Santa Tecla',180,280),('Antiguo Cuscatlán',220,320),
 ('Santa Ana',120,220),('San Miguel',110,200),('La Libertad',130,230),('Soyapango',100,170);

INSERT INTO tamanos_sucursal (id, nombre, factor_costo, mesas_min, mesas_max, mesas_base) VALUES
 ('pequena','Pequeña',0.7, 6,10, 8),
 ('mediana','Mediana',1.0,11,18,14),
 ('grande', 'Grande', 1.5,19,30,24);

INSERT INTO plantilla_minima (tamano, rol_id, cantidad) VALUES
 ('pequena','mesero',1),('pequena','cocinero',2),('pequena','jefe',1),('pequena','bodega',1),('pequena','gerente',1),
 ('mediana','mesero',2),('mediana','cocinero',3),('mediana','jefe',1),('mediana','bodega',1),('mediana','gerente',1),
 ('grande','mesero',4), ('grande','cocinero',5), ('grande','jefe',1), ('grande','bodega',2), ('grande','gerente',1);

-- ---------- sucursales ----------
INSERT INTO sucursales (id, nombre, zona, tamano, estado, mesas, direccion, costo, abierta_en) VALUES
 (1,'Centro', 'San Salvador','mediana','Operando',14,'Calle Rubén Darío #214, San Salvador',      310000,'2016-03-07 08:00:00-06'),
 (2,'Escalón','Escalón',     'pequena','Operando', 8,'Col. Escalón, Paseo General Escalón #3810',215000,'2020-08-24 08:00:00-06');

INSERT INTO sucursal_plantilla (sucursal_id, rol_id, cantidad)
SELECT s.id, pm.rol_id, pm.cantidad FROM sucursales s JOIN plantilla_minima pm ON pm.tamano = s.tamano;

-- ---------- usuarios ----------
INSERT INTO usuarios (id, usuario, nombre, rol_id, sucursal_id, pass_hash, clave_hash, pin_hash, documento, ingreso) VALUES
 ( 1,'ana',     'Ana Martínez',       'mesero',  1, crypt('demo', gen_salt('bf',10)), NULL, NULL, '04128355-7','2023-03-10 08:00:00-06'),
 ( 2,'luis',    'Luis Hernández',     'mesero',  1, crypt('demo', gen_salt('bf',10)), NULL, NULL, '05263419-2','2024-06-01 08:00:00-06'),
 ( 3,'marta',   'Marta Rivas',        'mesero',  2, crypt('demo', gen_salt('bf',10)), NULL, NULL, '03987124-5','2022-09-15 08:00:00-06'),
 ( 4,'carlos',  'Carlos Pineda',      'cocinero',1, crypt('demo', gen_salt('bf',10)), NULL, NULL, '02765431-8','2021-02-01 08:00:00-06'),
 ( 5,'rosa',    'Rosa Menjívar',      'cocinero',1, crypt('demo', gen_salt('bf',10)), NULL, NULL, '06123987-1','2025-01-20 08:00:00-06'),
 ( 6,'pedro',   'Pedro Alas',         'cocinero',2, crypt('demo', gen_salt('bf',10)), NULL, NULL, '04876512-3','2023-08-07 08:00:00-06'),
 ( 7,'julia',   'Julia Cruz',         'jefe',    1, crypt('demo', gen_salt('bf',10)), NULL, NULL, '01654329-6','2019-05-13 08:00:00-06'),
 ( 8,'mario',   'Mario Flores',       'jefe',    2, crypt('demo', gen_salt('bf',10)), NULL, NULL, '02345876-4','2020-10-05 08:00:00-06'),
 ( 9,'sofia',   'Sofía Ortiz',        'bodega',  1, crypt('demo', gen_salt('bf',10)), NULL, NULL, '03456712-9','2022-04-18 08:00:00-06'),
 (10,'daniel',  'Daniel Rosales',     'bodega',  2, crypt('demo', gen_salt('bf',10)), NULL, NULL, '05678123-0','2024-02-26 08:00:00-06'),
 (11,'elena',   'Elena Guzmán',       'gerente', 1, crypt('demo', gen_salt('bf',10)), crypt('1234', gen_salt('bf',10)), NULL, '00987654-2','2018-07-02 08:00:00-06'),
 (12,'ricardo', 'Ricardo Vega',       'gerente', 2, crypt('demo', gen_salt('bf',10)), crypt('1234', gen_salt('bf',10)), NULL, '02198765-1','2021-11-08 08:00:00-06'),
 (13,'patricia','Patricia Lara',      'rrhh',    NULL, crypt('demo', gen_salt('bf',10)), NULL, NULL, '01876543-7','2019-01-14 08:00:00-06'),
 (14,'hector',  'Héctor Molina',      'gg',      NULL, crypt('demo', gen_salt('bf',10)), crypt('1234', gen_salt('bf',10)), NULL, '00765432-5','2017-06-19 08:00:00-06'),
 (15,'isabel',  'Isabel Quintanilla', 'director',NULL, crypt('demo', gen_salt('bf',10)), NULL, crypt('2468', gen_salt('bf',10)), '00543219-8','2016-03-07 08:00:00-06'),
 (16,'fernando','Fernando Ayala',     'director',NULL, crypt('demo', gen_salt('bf',10)), NULL, crypt('2468', gen_salt('bf',10)), '01432198-3','2020-08-24 08:00:00-06');

-- años de antigüedad ya reconocidos al arrancar la demo
UPDATE usuarios SET antig_aplicada = floor(extract(epoch FROM (timestamptz '2026-11-22 09:20:00-06' - ingreso)) / (365.25 * 86400))::int;

INSERT INTO usuario_historial (usuario_id, fecha, tipo, detalle, por)
SELECT u.id, u.ingreso, 'Contratación', r.nombre || COALESCE(' · ' || s.nombre, ''), 'Carga inicial'
FROM usuarios u JOIN roles r ON r.id = u.rol_id LEFT JOIN sucursales s ON s.id = u.sucursal_id;

-- Turnos base: cocineros de 7 a 22 todos los días; el resto, mañana o tarde de lunes a viernes
INSERT INTO turnos (usuario_id, semana, dias)
SELECT id, NULL,
       CASE WHEN rol_id = 'cocinero' THEN ARRAY['7-22','7-22','7-22','7-22','7-22','7-22','7-22']
            WHEN id % 2 = 0          THEN ARRAY['Tarde','Tarde','Tarde','Tarde','Tarde','','']
            ELSE                          ARRAY['Mañana','Mañana','Mañana','Mañana','Mañana','',''] END
FROM usuarios;

-- ---------- catálogos de materia prima ----------
INSERT INTO mp_unidades (nombre) VALUES ('kg'),('lb'),('g'),('l'),('ml'),('unidad'),('paquete');
INSERT INTO mp_categorias (nombre) VALUES ('Granos'),('Lácteos'),('Carnes'),('Verduras'),('Panadería'),('Bebidas'),('Abarrotes'),('Reventa'),('General');

INSERT INTO materias_primas (id, nombre, unidad, categoria, vida_dias) VALUES
 ( 1,'Harina de maíz',  'kg',    'Granos',   180),
 ( 2,'Queso',           'lb',    'Lácteos',   14),
 ( 3,'Chicharrón',      'lb',    'Carnes',    10),
 ( 4,'Frijol molido',   'lb',    'Granos',    30),
 ( 5,'Arroz',           'lb',    'Granos',   365),
 ( 6,'Pollo',           'lb',    'Carnes',     6),
 ( 7,'Pan francés',     'unidad','Panadería',  4),
 ( 8,'Café molido',     'lb',    'Bebidas',  180),
 ( 9,'Azúcar',          'lb',    'Abarrotes',365),
 (10,'Elote',           'unidad','Verduras',   7),
 (11,'Repollo',         'lb',    'Verduras',   8),
 (12,'Tomate',          'lb',    'Verduras',   7),
 (13,'Plátano',         'unidad','Verduras',   6),
 (14,'Crema',           'lb',    'Lácteos',   12),
 (15,'Yuca',            'lb',    'Verduras',   8),
 (16,'Aceite',          'l',     'Abarrotes',365),
 (17,'Huevo',           'unidad','Abarrotes', 20),
 (18,'Loroco',          'lb',    'Verduras',   5),
 (19,'Leche',           'l',     'Lácteos',    7),
 (20,'Cacao',           'lb',    'Abarrotes',240),
 (21,'Agua embotellada','unidad','Reventa',  365),
 (22,'Gaseosa',         'unidad','Reventa',  200);

-- precio de referencia de cada materia prima (base para proveedores y lotes)
CREATE TEMP TABLE base_mp (mp_id INT PRIMARY KEY, precio NUMERIC(10,2));
INSERT INTO base_mp VALUES (1,.85),(2,2.6),(3,3.2),(4,1.1),(5,.55),(6,1.6),(7,.12),(8,3.8),(9,.55),(10,.18),(11,.35),(12,.6),
 (13,.15),(14,2.2),(15,.45),(16,3.1),(17,.16),(18,3),(19,1.05),(20,4.5),(21,.32),(22,.45);

-- ---------- proveedores ----------
INSERT INTO proveedores (id, nombre, condicion_pago, politica_tipo, politica_tolerancia_h, politica_escala, politica_tope) VALUES
 (1,'Distribuidora La Cosecha','Contado','Descuento',    12, 5,20),
 (2,'Agro Selecta',            '15 días','Indemnización',24,10,30),
 (3,'Mercado Mayor',           '30 días','Reembolso',    48,10,25),
 (4,'Lácteos y Más',           '15 días','Descuento',     6, 4,15);

CREATE TEMP TABLE ofrece (proveedor_id INT, mp_id INT, factor NUMERIC);
INSERT INTO ofrece SELECT 1, id, 1.00 FROM materias_primas WHERE id NOT IN (8,20);
INSERT INTO ofrece SELECT 2, id, 1.08 FROM materias_primas WHERE id NOT IN (7,16,21,22,14);
INSERT INTO ofrece SELECT 3, id, 0.95 FROM materias_primas WHERE id IN (1,4,5,7,8,9,12,16,17,20,21,22);
INSERT INTO ofrece SELECT 4, id, 1.03 FROM materias_primas WHERE id IN (2,14,19,17,6);

INSERT INTO proveedor_materias (proveedor_id, mp_id, precio_base, precio_actual)
SELECT o.proveedor_id, o.mp_id, round(b.precio * o.factor, 2), round(b.precio * o.factor, 2)
FROM ofrece o JOIN base_mp b ON b.mp_id = o.mp_id;

INSERT INTO proveedor_precios_hist (proveedor_id, mp_id, precio, desde)
SELECT proveedor_id, mp_id, precio_actual, timestamptz '2026-11-22 09:20:00-06' - interval '14 days' FROM proveedor_materias;

INSERT INTO proveedor_sucursales (proveedor_id, sucursal_id, entrega_h, transporte, transporte_min, transporte_max) VALUES
 (1,1,24,2.5,1.88,3.13),(1,2,48,3.0,2.25,3.75),
 (2,1,48,3.0,2.25,3.75),(2,2,72,3.5,2.63,4.38),
 (3,1,72,2.0,1.50,2.50),
 (4,1,24,2.2,1.65,2.75),(4,2,24,2.6,1.95,3.25);

INSERT INTO proveedor_transporte_hist (proveedor_id, sucursal_id, costo, desde)
SELECT proveedor_id, sucursal_id, transporte, timestamptz '2026-11-22 09:20:00-06' - interval '14 days' FROM proveedor_sucursales;

-- ---------- lotes en bodega ----------
-- Materias 1 a 12: 20 unidades por sucursal, compradas hace 5 días
INSERT INTO lotes (sku, mp_id, sucursal_id, proveedor_id, fecha_compra, vence, cantidad, precio)
SELECT 'L' || m.id || 'S' || s.id, m.id, s.id,
       CASE WHEN m.id IN (8,20) THEN 2 ELSE 1 END,
       timestamptz '2026-11-22 09:20:00-06' - interval '5 days',
       timestamptz '2026-11-22 09:20:00-06' + ((6 + (m.id - 1) * 3 + (s.id - 1) * 2) || ' days')::interval,
       20, b.precio
FROM materias_primas m JOIN base_mp b ON b.mp_id = m.id CROSS JOIN sucursales s
WHERE m.id <= 12;

-- Materias 13 a 22: compradas hace 3 días (40 en Centro, 25 en Escalón)
INSERT INTO lotes (sku, mp_id, sucursal_id, proveedor_id, fecha_compra, vence, cantidad, precio)
SELECT 'L' || m.id || 'S' || s.id, m.id, s.id,
       CASE WHEN m.id IN (8,20) THEN 2 ELSE 1 END,
       timestamptz '2026-11-22 09:20:00-06' - interval '3 days',
       timestamptz '2026-11-22 09:20:00-06' + (LEAST(m.vida_dias * 0.7, 40) + (s.id - 1)) * interval '1 day',
       CASE WHEN s.id = 1 THEN 40 ELSE 25 END, b.precio
FROM materias_primas m JOIN base_mp b ON b.mp_id = m.id CROSS JOIN sucursales s
WHERE m.id >= 13;

-- algunos lotes por vencer para la demostración
UPDATE lotes SET vence = timestamptz '2026-11-22 09:20:00-06' + interval '2 days 4 hours' WHERE sku = 'L6S1';
UPDATE lotes SET vence = timestamptz '2026-11-22 09:20:00-06' + interval '4 days'         WHERE sku = 'L12S2';
UPDATE lotes SET vence = timestamptz '2026-11-22 09:20:00-06' + interval '3 days'         WHERE sku = 'L7S1';
UPDATE lotes SET estado = 'Por vencer'
WHERE vence - timestamptz '2026-11-22 09:20:00-06' <= interval '5 days';

-- ---------- categorías, productos y extras ----------
INSERT INTO categorias (id, nombre, icono) VALUES (1,'Pupusas','🫓'),(2,'Bebidas','🥤'),(3,'Platos','🍽️');

INSERT INTO productos (id, nombre, descripcion, precio, tiempo_min, es_extra, es_reventa, creado) VALUES
 ( 1,'Pupusa revuelta','Pupusa de maíz rellena de chicharrón, frijol y queso. Se sirve con curtido y salsa roja.',1.25, 8,false,false,'2026-09-23 09:20:00-06'),
 ( 2,'Pupusa de queso','Pupusa de maíz rellena de queso que se derrite. Se sirve con curtido y salsa roja.',1.10, 7,false,false,'2026-09-23 09:20:00-06'),
 ( 3,'Horchata','Bebida fría de morro y arroz, con canela y un toque dulce.',1.50, 3,false,false,'2026-09-23 09:20:00-06'),
 ( 4,'Café','Café molido recién colado, caliente.',1.00, 4,false,false,'2026-09-23 09:20:00-06'),
 ( 5,'Panes con pollo','Pan francés relleno de pollo guisado, con tomate y repollo.',3.50,12,false,false,'2026-09-23 09:20:00-06'),
 ( 6,'Tamal de elote','Tamal de elote tierno, suave y dulce.',1.20, 6,false,false,'2026-09-23 09:20:00-06'),
 ( 7,'Pupusa de frijol con queso','',1.10, 7,false,false,'2026-09-23 09:20:00-06'),
 ( 8,'Pupusa de loroco','',1.25, 8,false,false,'2026-09-23 09:20:00-06'),
 ( 9,'Yuca frita con chicharrón','',3.25,12,false,false,'2026-09-23 09:20:00-06'),
 (10,'Plátanos fritos con crema','',2.50, 8,false,false,'2026-09-23 09:20:00-06'),
 (11,'Desayuno típico','',3.75,12,false,false,'2026-09-23 09:20:00-06'),
 (12,'Atol de elote','',1.25, 6,false,false,'2026-09-23 09:20:00-06'),
 (13,'Chocolate caliente','',1.50, 5,false,false,'2026-09-23 09:20:00-06'),
 (14,'Agua embotellada','',1.00, 1,false,true, '2026-09-23 09:20:00-06'),
 (15,'Gaseosa','',1.00, 1,false,true, '2026-09-23 09:20:00-06'),
 (16,'Curtido','Repollo encurtido con zanahoria y orégano, el acompañante clásico.',0.25,1,true,false,'2026-09-23 09:20:00-06'),
 (17,'Salsa roja','Salsa de tomate cocida, suave y sin picante.',0.15,1,true,false,'2026-09-23 09:20:00-06'),
 (18,'Queso extra','Ración extra de queso fresco.',0.50,1,true,false,'2026-09-23 09:20:00-06'),
 (19,'Azúcar extra','Una cucharada extra de azúcar.',0.10,0,true,false,'2026-09-23 09:20:00-06'),
 (20,'Frijol molido extra','Porción extra de frijol molido.',0.40,1,true,false,'2026-09-23 09:20:00-06'),
 (21,'Pollo extra','Porción extra de pollo guisado.',1.00,2,true,false,'2026-09-23 09:20:00-06');

INSERT INTO producto_categorias (producto_id, categoria_id) VALUES
 (1,1),(2,1),(3,2),(4,2),(5,3),(6,3),(7,1),(8,1),(9,3),(10,3),(11,3),(12,2),(13,2),(14,2),(15,2);

INSERT INTO recetas (producto_id, mp_id, cantidad) VALUES
 (1,1,.1),(1,2,.04),(1,3,.05),(1,4,.03),
 (2,1,.1),(2,2,.06),
 (3,5,.1),(3,9,.02),
 (4,8,.03),(4,9,.02),
 (5,7,1),(5,6,.25),
 (6,10,2),(6,9,.02),
 (7,1,.1),(7,4,.04),(7,2,.05),
 (8,1,.1),(8,2,.05),(8,18,.02),
 (9,15,.5),(9,3,.25),(9,11,.05),(9,16,.05),
 (10,13,2),(10,14,.1),(10,16,.03),(10,4,.05),
 (11,17,2),(11,4,.1),(11,13,1),(11,14,.05),
 (12,10,1),(12,19,.2),(12,9,.03),
 (13,19,.25),(13,20,.03),(13,9,.03),
 (14,21,1),
 (15,22,1),
 (16,11,.05),(17,12,.03),(18,2,.04),(19,9,.02),(20,4,.05),(21,6,.1);

INSERT INTO extra_productos (extra_id, producto_id) VALUES
 (16,1),(16,2),
 (17,1),(17,2),(17,6),
 (18,1),(18,2),(18,5),
 (19,3),(19,4),
 (20,5),(20,6),
 (21,5),(21,6);

INSERT INTO precios_historial (producto_id, precio, desde, aprobo)
SELECT id, precio, timestamptz '2026-11-22 09:20:00-06' - interval '60 days', 'Carga inicial' FROM productos;

-- menú: Centro vende todo; Escalón no vende atol ni chocolate
INSERT INTO sucursal_menu (sucursal_id, producto_id)
SELECT s.id, p.id FROM sucursales s CROSS JOIN productos p
WHERE NOT p.es_extra AND NOT (s.id = 2 AND p.id IN (12,13));

-- ---------- cuentas por pagar de ejemplo ----------
INSERT INTO facturas (num, sucursal_id, proveedor_id, monto, original, condicion, emitida, vence, estado, pagada)
SELECT 'FP-' || lpad(n::text, 4, '0'), suc, prov, monto, monto, cond,
       timestamptz '2026-11-22 09:20:00-06' + off * interval '1 day',
       timestamptz '2026-11-22 09:20:00-06' + (off + CASE cond WHEN 'Contado' THEN 0 WHEN '15 días' THEN 15 ELSE 30 END) * interval '1 day',
       est,
       CASE WHEN est = 'Pagada' THEN timestamptz '2026-11-22 09:20:00-06' + (off + 1) * interval '1 day' END
FROM (VALUES (1,1,1, -9,'Contado', 48.6,'Pagada'),
             (2,1,2, -4,'15 días',72.4,'Pendiente'),
             (3,1,3,-20,'30 días',95.1,'Pendiente'),
             (4,2,2,-18,'15 días',54.3,'Pendiente'),
             (5,2,4, -6,'15 días',38.9,'Pendiente')) AS f(n, suc, prov, off, cond, monto, est);

-- ---------- 15 días de ventas históricas (paneles, tendencias, historial) ----------
DO $$
DECLARE
  t0        CONSTANT timestamptz := '2026-11-22 09:20:00-06';
  dia0      timestamptz := date_trunc('day', t0);
  pesos     CONSTANT int[] := ARRAY[5,3,3,2,3,2,2,1,2,2,1,2,2];
  k int; s int; n int; i int; j int; nl int; cant int; idx int;
  base timestamptz; tm timestamptz;
  meseros int[]; cocineros int[]; mesero int; cocinero int;
  pool int[]; wsum int; r double precision;
  pid int; precio numeric; nombre text; tiempo int;
  caja int; ultima_caja int[] := ARRAY[NULL, NULL]::int[];
  efe numeric; tot numeric; sub numeric; est int; met text; corr int;
  ped int;
BEGIN
  PERFORM setseed(0.2026);
  FOR k IN REVERSE 14..0 LOOP
    base := dia0 - k * interval '1 day';
    FOREACH s IN ARRAY ARRAY[1, 2] LOOP
      meseros   := ARRAY(SELECT id FROM usuarios WHERE rol_id = 'mesero'   AND sucursal_id = s ORDER BY id);
      cocineros := ARRAY(SELECT id FROM usuarios WHERE rol_id = 'cocinero' AND sucursal_id = s ORDER BY id);
      pool      := ARRAY(SELECT p.id FROM productos p JOIN sucursal_menu m ON m.producto_id = p.id AND m.sucursal_id = s
                         WHERE NOT p.es_extra AND NOT p.es_reventa ORDER BY p.id);
      mesero := meseros[1 + (k % array_length(meseros, 1))];
      n := CASE WHEN k = 0 THEN (CASE WHEN s = 1 THEN 3 ELSE 2 END)
                ELSE (CASE WHEN s = 1 THEN 10 + floor(random() * 7)::int ELSE 5 + floor(random() * 4)::int END) END;
      efe := 20;

      IF k > 0 THEN
        INSERT INTO cajas (sucursal_id, mesero_id, fondo, estado, abierta, cerrada)
        VALUES (s, mesero, 20, 'Aprobada', base + interval '7 hours', base + interval '22 hours')
        RETURNING id INTO caja;
        ultima_caja[s] := caja;
      ELSE
        caja := ultima_caja[s];
      END IF;

      FOR i IN 0..n - 1 LOOP
        tm := CASE WHEN k = 0 THEN base + (7 + i * 0.8) * interval '1 hour'
                   ELSE base + (8 + (i::numeric / n) * 13 + random()) * interval '1 hour' END;
        nl := 1 + floor(random() * 3)::int;
        cocinero := cocineros[1 + floor(random() * array_length(cocineros, 1))::int];
        met := (ARRAY['Efectivo','Efectivo','Tarjeta','Bitcoin'])[1 + floor(random() * 4)::int];

        INSERT INTO pedidos (sucursal_id, mesero_id, cocinero_id, tipo, mesa, estado, est_seg, consumido,
                             creado, aceptado, asignado, iniciado, terminado, entregado, mesa_liberada)
        VALUES (s, mesero, cocinero, 'Aquí', 1 + floor(random() * 8)::int, 'Cobrado', 0, true,
                tm, tm + interval '1 minute', tm + interval '1 minute', tm + interval '2 minutes',
                tm + (2 + nl * 3) * interval '1 minute', tm + (3 + nl * 3) * interval '1 minute',
                tm + (40 + nl * 3) * interval '1 minute')
        RETURNING id INTO ped;

        tot := 0; est := 0;
        FOR j IN 1..nl LOOP
          -- producto elegido según su peso de popularidad
          wsum := 0;
          FOR idx IN 1..array_length(pool, 1) LOOP wsum := wsum + COALESCE(pesos[idx], 1); END LOOP;
          r := random() * wsum;
          pid := pool[1];
          FOR idx IN 1..array_length(pool, 1) LOOP
            r := r - COALESCE(pesos[idx], 1);
            IF r <= 0 THEN pid := pool[idx]; EXIT; END IF;
          END LOOP;
          cant := 1 + floor(random() * 3)::int;
          SELECT p.precio, p.nombre, p.tiempo_min INTO precio, nombre, tiempo FROM productos p WHERE p.id = pid;
          INSERT INTO pedido_lineas (pedido_id, orden, producto_id, nombre, cantidad, precio_unit)
          VALUES (ped, j - 1, pid, nombre, cant, precio);
          tot := tot + precio * cant;
          est := est + round(tiempo * (1 + 0.35 * (cant - 1)) * 60);
        END LOOP;
        UPDATE pedidos SET total = tot, est_seg = est WHERE id = ped;

        sub := round(tot / 1.13, 2);
        SELECT COALESCE(max(v.correlativo), 0) + 1 INTO corr FROM ventas v WHERE v.sucursal_id = s AND v.tipo_doc = 'Ticket simple';
        INSERT INTO ventas (sucursal_id, pedido_id, mesero_id, caja_id, fecha, metodo, referencia, pago, tipo_doc, correlativo, total, subtotal, iva)
        VALUES (s, ped, mesero, caja, tm + (3 + nl * 3) * interval '1 minute', met,
                CASE WHEN met = 'Efectivo' THEN '' ELSE met END,
                CASE WHEN met = 'Efectivo' THEN jsonb_build_object('recibido', tot, 'cambio', 0) ELSE '{}'::jsonb END,
                'Ticket simple', corr, tot, sub, tot - sub);
        IF met = 'Efectivo' THEN efe := efe + tot; END IF;
      END LOOP;

      IF k > 0 THEN
        UPDATE cajas c SET
          esp_efectivo = efe,
          esp_tarjeta  = COALESCE((SELECT sum(v.total) FROM ventas v WHERE v.caja_id = c.id AND v.metodo = 'Tarjeta'), 0),
          esp_bitcoin  = COALESCE((SELECT sum(v.total) FROM ventas v WHERE v.caja_id = c.id AND v.metodo = 'Bitcoin'), 0),
          declarado    = CASE WHEN k = 1 AND s = 1 THEN efe - 2 ELSE efe END,
          estado       = CASE WHEN k = 1 THEN 'Pendiente de aprobación' ELSE 'Aprobada' END
        WHERE c.id = caja;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- ---------- ajustar los contadores de identidad tras insertar con id explícito ----------
SELECT setval(pg_get_serial_sequence('sucursales','id'),      (SELECT max(id) FROM sucursales));
SELECT setval(pg_get_serial_sequence('usuarios','id'),        (SELECT max(id) FROM usuarios));
SELECT setval(pg_get_serial_sequence('materias_primas','id'), (SELECT max(id) FROM materias_primas));
SELECT setval(pg_get_serial_sequence('proveedores','id'),     (SELECT max(id) FROM proveedores));
SELECT setval(pg_get_serial_sequence('categorias','id'),      (SELECT max(id) FROM categorias));
SELECT setval(pg_get_serial_sequence('productos','id'),       (SELECT max(id) FROM productos));
