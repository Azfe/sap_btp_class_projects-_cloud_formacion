# Guía de pruebas

Pasos para probar a mano los servicios, las actions y las functions descritos en la [guía de actions y functions](actions_functions.md), con los datos de prueba de `db/data/`.

La secuencia completa se ejecutó contra un servidor real y todas las peticiones dieron el resultado esperado.

## 1. Arrancar el servidor

```bash
npm install
cds watch
```

En la salida deben aparecer los 9 ficheros `init from db/data/...` y los servicios `/odata/v4/admin`, `/odata/v4/equipo` y `/odata/v4/consulta`.

En desarrollo la base de datos está en memoria: cada reinicio de `cds watch` vuelve a los datos de los CSV.

## 2. Datos de prueba

Los IDs son fijos y el primer bloque indica la entidad:

| Entidad | IDs | Contenido |
|---|---|---|
| `Ligas` | `11111111-0000-4000-8000-000000000001` a `…005` | Diario, Sábado Mañana, Sábado Tarde, Domingo Mañana y Domingo Tarde |
| `Sedes` | `22222222-…` | 3 sedes |
| `Equipos` | `33333333-…` | 12 equipos |
| `Inscripciones` | `44444444-…` | 23 inscripciones: Diario con 6 equipos (par), Sábado Mañana con 5 (impar) y el resto con 4 |
| `Jugadores` | `55555555-…` | 161 jugadores |
| `Plantillas` | `66666666-…` | 7 fichas por inscripción, dorsales 1 a 7, más una ficha extra |
| `Usuarios` | `77777777-…` | Los 3 usuarios simulados de `package.json` |
| `Sanciones` | `88888888-…` | Una sanción manual de 2 partidos en Liga Diario |

Registros que conviene conocer:

- **`44444444-…001`:** Atlético Robledal en Liga Diario. Sus fichas van de `66666666-…001` a `…007`.
- **`44444444-…003`:** Racing Vallehermoso en Liga Diario, también del delegado.
- **`66666666-…002`:** dorsal 2 de Atlético Robledal, sancionado en Liga Diario.
- **Jugador `55555555-…001`:** es el usuario `jugador@liga.es`. Tiene ficha en Atlético Robledal (Liga Diario) y en Juventud Arroyo (Sábado Mañana), lo que está permitido porque son ligas distintas.
- **Delegado:** administra Atlético Robledal y Racing Vallehermoso, que suman 4 inscripciones.

No hay jornadas ni partidos: se crean con `generarCalendario`.

## 3. Comprobar los permisos en el navegador

BAS ofrece abrir el puerto 4004. El navegador pide usuario y contraseña:

| Usuario / contraseña | URL | Resultado esperado |
|---|---|---|
| `admin@liga.es` / `admin` | `/odata/v4/admin/Ligas` | Las 5 ligas |
| `delegado@liga.es` / `delegado` | `/odata/v4/equipo/Inscripciones` | Solo sus 4 inscripciones |
| `delegado@liga.es` / `delegado` | `/odata/v4/admin/Ligas` | 403 |
| `jugador@liga.es` / `jugador` | `/odata/v4/consulta/Equipos` | Los 12 equipos |

El navegador recuerda el usuario. Para cambiar de usuario hay que abrir una ventana de incógnito.

## 4. Probar las actions con REST Client

Crear `test/acciones.http` con el contenido siguiente y ejecutar las peticiones **en orden** con el enlace "Send Request" que aparece encima de cada una. La petición 3 guarda los IDs de dos partidos en `p1` y `p2`, y las siguientes los reutilizan.

Las variables `p1` y `p2` se declaran al principio del fichero. Si se escriben justo debajo de una petición, REST Client las envía como cuerpo o como cabeceras, y el servidor responde con un error.

```http
@base = http://localhost:4004/odata/v4
@ligaDiario = 11111111-0000-4000-8000-000000000001
@robledalDiario = 44444444-0000-4000-8000-000000000001
@p1 = {{partidos.response.body.$.value[0].ID}}
@p2 = {{partidos.response.body.$.value[1].ID}}

### 1. Generar el calendario (esperado: 30)
POST {{base}}/admin/Ligas({{ligaDiario}})/generarCalendario
Authorization: Basic admin@liga.es:admin
Content-Type: application/json

{ "fechaInicio": "2026-11-16", "idaYVuelta": true }

### 2. Regenerar sin partidos jugados (esperado: 30 otra vez)
POST {{base}}/admin/Ligas({{ligaDiario}})/generarCalendario
Authorization: Basic admin@liga.es:admin
Content-Type: application/json

{ "fechaInicio": "2026-11-16", "idaYVuelta": true }

### 3. Partidos de Atlético Robledal en casa, por fecha
# @name partidos
GET {{base}}/admin/Partidos?$filter=local_ID%20eq%20{{robledalDiario}}&$orderby=fecha_hora&$top=2
Authorization: Basic admin@liga.es:admin

### 4. Jugadores disponibles: no debe aparecer la ficha …002, que está sancionada
GET {{base}}/admin/Partidos({{p1}})/jugadoresDisponibles()
Authorization: Basic admin@liga.es:admin

### 5. Sancionado en el acta (esperado: 409)
POST {{base}}/admin/Partidos({{p1}})/registrarParticipacion
Authorization: Basic admin@liga.es:admin
Content-Type: application/json

{ "plantilla": "66666666-0000-4000-8000-000000000002", "titular": true }

### 6a. Jugador en el acta (esperado: 200)
POST {{base}}/admin/Partidos({{p1}})/registrarParticipacion
Authorization: Basic admin@liga.es:admin
Content-Type: application/json

{ "plantilla": "66666666-0000-4000-8000-000000000001", "titular": true, "minutos": 90 }

### 6b. Otro jugador en el acta (esperado: 200)
POST {{base}}/admin/Partidos({{p1}})/registrarParticipacion
Authorization: Basic admin@liga.es:admin
Content-Type: application/json

{ "plantilla": "66666666-0000-4000-8000-000000000003", "titular": true, "minutos": 70 }

### 7a. Gol de penalti
POST {{base}}/admin/Partidos({{p1}})/registrarGol
Authorization: Basic admin@liga.es:admin
Content-Type: application/json

{ "plantilla": "66666666-0000-4000-8000-000000000001", "minuto": 23, "tipo": "penalti" }

### 7b. Gol en propia meta (suma al rival)
POST {{base}}/admin/Partidos({{p1}})/registrarGol
Authorization: Basic admin@liga.es:admin
Content-Type: application/json

{ "plantilla": "66666666-0000-4000-8000-000000000003", "minuto": 60, "tipo": "propia_meta" }

### 8. Gol de alguien que no está en el acta (esperado: 409)
POST {{base}}/admin/Partidos({{p1}})/registrarGol
Authorization: Basic admin@liga.es:admin
Content-Type: application/json

{ "plantilla": "66666666-0000-4000-8000-000000000004", "minuto": 80 }

### 9. Tarjeta roja
POST {{base}}/admin/Partidos({{p1}})/registrarAmonestacion
Authorization: Basic admin@liga.es:admin
Content-Type: application/json

{ "plantilla": "66666666-0000-4000-8000-000000000003", "minuto": 70, "tipo": "roja" }

### 10. Finalizar: crea la sanción automática por la roja
POST {{base}}/admin/Partidos({{p1}})/finalizar
Authorization: Basic admin@liga.es:admin
Content-Type: application/json

{}

### 11. Acta cerrada (esperado: 409)
POST {{base}}/admin/Partidos({{p1}})/registrarGol
Authorization: Basic admin@liga.es:admin
Content-Type: application/json

{ "plantilla": "66666666-0000-4000-8000-000000000001", "minuto": 85 }

### 12. Regenerar con partidos jugados (esperado: 409)
POST {{base}}/admin/Ligas({{ligaDiario}})/generarCalendario
Authorization: Basic admin@liga.es:admin
Content-Type: application/json

{ "fechaInicio": "2026-11-16", "idaYVuelta": true }

### 13. Sanciones: debe haber 2, la de los CSV y la de la roja
GET {{base}}/admin/Sanciones
Authorization: Basic admin@liga.es:admin

### 14. El expulsado no entra en el siguiente partido (esperado: 409)
POST {{base}}/admin/Partidos({{p2}})/registrarParticipacion
Authorization: Basic admin@liga.es:admin
Content-Type: application/json

{ "plantilla": "66666666-0000-4000-8000-000000000003" }

### 15. Aplazar el segundo partido (no descuenta sanción)
POST {{base}}/admin/Partidos({{p2}})/aplazar
Authorization: Basic admin@liga.es:admin
Content-Type: application/json

{}

### 16a. Marcador como jugador (esperado: 1-1)
GET {{base}}/consulta/Partidos({{p1}})/marcador()
Authorization: Basic jugador@liga.es:jugador

### 16b. Clasificación
GET {{base}}/consulta/clasificacion(liga={{ligaDiario}})
Authorization: Basic jugador@liga.es:jugador

### 16c. Máximos goleadores
GET {{base}}/consulta/goleadores(liga={{ligaDiario}},top=5)
Authorization: Basic jugador@liga.es:jugador

### 17. El jugador intenta usar AdminService (esperado: 403)
GET {{base}}/admin/Ligas
Authorization: Basic jugador@liga.es:jugador

### 18. Delegado: alta de un jugador nuevo en su equipo (esperado: 200)
POST {{base}}/equipo/Inscripciones({{robledalDiario}})/altaJugador
Authorization: Basic delegado@liga.es:delegado
Content-Type: application/json

{ "documento_identidad": "99999999A", "nombre": "Prueba", "apellidos": "Nueva Ficha", "dorsal": 30 }

### 19. Delegado: alta en un equipo ajeno (esperado: 403)
POST {{base}}/equipo/Inscripciones(44444444-0000-4000-8000-000000000002)/altaJugador
Authorization: Basic delegado@liga.es:delegado
Content-Type: application/json

{ "documento_identidad": "99999998B", "nombre": "Otro", "apellidos": "Jugador" }

### 20a. Delegado: baja de una ficha de Atlético Robledal (esperado: 200)
POST {{base}}/equipo/Plantillas(66666666-0000-4000-8000-000000000004)/darDeBaja
Authorization: Basic delegado@liga.es:delegado
Content-Type: application/json

{ "fecha": "2026-11-20" }

### 20b. El mismo jugador intenta fichar por Racing en la misma liga (esperado: 409)
POST {{base}}/equipo/Inscripciones(44444444-0000-4000-8000-000000000003)/altaJugador
Authorization: Basic delegado@liga.es:delegado
Content-Type: application/json

{ "documento_identidad": "10000003T", "nombre": "Daniel", "apellidos": "x" }
```

## 5. Resultados esperados

| Petición | Resultado |
|---|---|
| 1 y 2 | `30`: 6 equipos con ida y vuelta. Mientras no haya partidos jugados, el calendario se puede regenerar. |
| 4 | 13 fichas de los dos equipos, sin la `…002` |
| 5 y 14 | 409 "El jugador tiene una sanción vigente en esta liga" |
| 8 | 409 "El jugador no figura en el acta de este partido" |
| 11 | 409 "No se puede modificar el acta de un partido finalizado" |
| 12 | 409 "La liga ya tiene partidos jugados o con acta: no se puede regenerar el calendario" |
| 13 | 2 sanciones |
| 16a | `{ "local": 1, "visitante": 1 }`, porque el gol en propia meta cuenta para el rival |
| 16b | Atlético Robledal con 1 partido jugado y 1 empate |
| 17 | 403 "User 'jugador@liga.es' is lacking required roles: [admin]" |
| 19 | 403 "Forbidden" |
| 20b | 409 "El jugador ya tiene ficha en un equipo de esta liga": la baja no libera la liga |

Las horas de los partidos salen en UTC (por ejemplo `20:00Z`). Es lo esperado y está explicado en el apartado 10 de la [guía de actions y functions](actions_functions.md).

## 6. Si algo falla

- **401 o 403 inesperado:** revisar el usuario en la cabecera `Authorization` y el bloque `cds.requires.auth` de `package.json`.
- **"Key ID is missing":** la petición 3 no se ejecutó, así que `p1` y `p2` están vacíos.
- **Datos ya modificados:** si se repite la secuencia sin reiniciar, fallan las peticiones que dependen del estado inicial. Basta con reiniciar `cds watch`.
- **Cualquier otro error:** el terminal de `cds watch` muestra la traza completa.
