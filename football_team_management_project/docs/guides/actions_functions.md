# Guía de actions y functions

Cómo implementar en CAP las operaciones del [enunciado](enunciado.md) que no son un simple alta, lectura o modificación de datos: el generador de jornadas, la gestión de partidos y actas, las sanciones, el alta de jugadores y las consultas de clasificación y goleadores. Corresponde a los pasos 6 a 8 de la [guía de desarrollo](project_development.md) y parte del modelo de [db/schema.cds](../../db/schema.cds).

Todo el código de esta guía se probó con un servidor CAP y datos de prueba: 45 comprobaciones de los casos correctos y de los errores esperados, incluidos los permisos de cada rol.

## 1. Conceptos

| | Action | Function |
|---|---|---|
| **Para qué** | Cambia datos | Solo lee y calcula |
| **Petición OData** | `POST` | `GET` |
| **Ejemplo** | `finalizar` un partido | `clasificacion` de una liga |

Cada una puede ser:
- **Bound (ligada):** se ejecuta sobre un registro concreto. Se declara dentro de la entidad con `actions { ... }`. En el handler, `req.subject` apunta a ese registro.
  - `POST /odata/v4/admin/Partidos(<id>)/finalizar`
- **Unbound (libre):** no depende de ningún registro. Se declara directamente en el servicio.
  - `GET /odata/v4/consulta/clasificacion(liga=<id>)`

Cada servicio tiene dos ficheros con el mismo nombre en `srv/`: el `.cds` declara las operaciones y el `.js` las implementa. CAP los asocia automáticamente.

Reglas que se repiten en todo el código:
- **Errores:** `req.reject(código, mensaje)` corta la ejecución y devuelve el error al cliente. Se usa 400 para datos incorrectos, 403 para falta de permisos, 404 si no existe el registro y 409 si la operación choca con el estado actual.
- **Transacciones:** cada petición se ejecuta en una única transacción. Si algo falla a mitad, CAP deshace todos los cambios, por ejemplo las jornadas ya creadas por el generador.
- **Entidades de base de datos:** los handlers escriben en `cds.entities('football')`, no en las proyecciones del servicio, para que las restricciones de solo lectura del servicio no les afecten.
- **Parámetros obligatorios:** `@mandatory` en un parámetro hace que CAP rechace la petición si falta.

## 2. Decisiones de diseño

Decisiones tomadas:

| Pregunta | Decisión |
|---|---|
| **¿Cómo asigna el generador la sede y la hora?** | Cada franja tiene horas de inicio fijas y los partidos se reparten entre las sedes sin que coincidan dos en la misma sede y hora. |
| **¿Las tarjetas generan sanciones?** | Al finalizar un partido, cada tarjeta roja crea una sanción de 1 partido en esa liga. El administrador puede ampliarla. |
| **¿Cómo se reparte la liga Diario?** | Cada jornada dura una semana y sus partidos se reparten de lunes a viernes. |

Criterios adoptados sin pregunta previa, fáciles de cambiar:
- **Clasificación:** 3 puntos por victoria y 1 por empate. Desempate por diferencia de goles, goles a favor y nombre.
- **Acta:** se rellena mediante actions mientras el partido está `programado` o `en_juego`, y queda cerrada al finalizarlo.
- **Estado del partido:** solo cambia mediante actions (`aplazar`, `reprogramar`, `finalizar`), no editando el campo.
- **Minuto:** entre 0 y 130, para admitir prórroga y añadido.

## 3. Resumen de operaciones

| Servicio | Operación | Tipo | Requisito del enunciado |
|---|---|---|---|
| `AdminService` | `Ligas.generarCalendario` | Action bound | Generador de jornadas |
| `AdminService` | `Partidos.reprogramar`, `Partidos.aplazar` | Actions bound | Modificación de partidos |
| `AdminService` | `Partidos.registrarParticipacion` | Action bound | Jugadores que han participado |
| `AdminService` | `Partidos.registrarGol` | Action bound | Añadir goleadores a partidos |
| `AdminService` | `Partidos.registrarAmonestacion` | Action bound | Amonestados |
| `AdminService` | `Partidos.finalizar` | Action bound | Sanciones automáticas por roja |
| `AdminService` | `Partidos.jugadoresDisponibles` | Function bound | Jugadores que pueden entrar en el acta |
| `EquipoService` | `Inscripciones.altaJugador` | Action bound | El admin de equipo da de alta jugadores |
| `EquipoService` | `Plantillas.darDeBaja` | Action bound | Bajas sin liberar la liga |
| `ConsultaService` | `Partidos.marcador` | Function bound | Resultado del partido |
| `ConsultaService` | `clasificacion` | Function unbound | Consulta para jugadores |
| `ConsultaService` | `goleadores` | Function unbound | Consulta de goleadores |

La creación de partidos y de sanciones manuales no necesita actions: se hace con un `POST` normal sobre `Partidos` y `Sanciones`, y las validaciones van en un handler `before`.

## 4. Estructura de ficheros

```
srv/
├── admin-service.cds
├── admin-service.js
├── equipo-service.cds
├── equipo-service.js
├── consulta-service.cds
├── consulta-service.js
└── lib/
    ├── calendario.js   # franjas, algoritmo de emparejamiento y fechas
    └── partidos.js     # sede ocupada, marcadores y sanciones vigentes
```

La lógica que usan varios servicios va en `srv/lib/`. Las funciones de `calendario.js` no acceden a la base de datos, así que se pueden probar por separado.

## 5. Lógica compartida

### 5.1 `srv/lib/calendario.js`

- **`FRANJAS`:** días y horas de inicio de cada franja. Para añadir horarios basta con cambiar esta tabla.
- **`emparejamientos`:** aplica el algoritmo del círculo. Con N equipos salen N-1 jornadas en las que todos juegan contra todos. Si N es impar, se añade un hueco vacío y el equipo emparejado con él descansa esa jornada. Con `idaYVuelta`, la segunda vuelta repite los cruces con los papeles de local y visitante cambiados.
- **`huecosDeJornada`:** genera las combinaciones de sede y hora de una semana, ordenadas para repartir los partidos entre los días. En la liga Diario, el primer partido va el lunes, el segundo el martes, etc.

```js
// Horas de inicio y días de cada franja. Lunes = 1 ... sábado = 6, domingo = 0.
export const FRANJAS = {
  diario:         { dias: [1, 2, 3, 4, 5], horas: ['20:00'] },
  sabado_manana:  { dias: [6],             horas: ['10:00', '12:00'] },
  sabado_tarde:   { dias: [6],             horas: ['16:00', '18:00'] },
  domingo_manana: { dias: [0],             horas: ['10:00', '12:00'] },
  domingo_tarde:  { dias: [0],             horas: ['16:00', '18:00'] },
}

// Días que hay que sumar al lunes para llegar a cada día de la semana
const DESDE_LUNES = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 0: 6 }

export function barajar(lista) {
  const copia = [...lista]
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copia[i], copia[j]] = [copia[j], copia[i]]
  }
  return copia
}

// Algoritmo del círculo: devuelve una lista de rondas; cada ronda es una lista de [local, visitante]
export function emparejamientos(equipos, idaYVuelta) {
  const lista = barajar(equipos)
  if (lista.length % 2) lista.push(null)           // null = descanso
  const n = lista.length
  const rondas = []
  for (let r = 0; r < n - 1; r++) {
    const ronda = []
    for (let i = 0; i < n / 2; i++) {
      const a = lista[i], b = lista[n - 1 - i]
      if (!a || !b) continue                         // el equipo emparejado con null descansa
      ronda.push((r + i) % 2 === 0 ? [a, b] : [b, a]) // alterna quién juega en casa
    }
    rondas.push(ronda)
    lista.splice(1, 0, lista.pop())                  // rota todos menos el primero
  }
  if (idaYVuelta) rondas.push(...rondas.map(ronda => ronda.map(([l, v]) => [v, l])))
  return rondas
}

export function sumarDias(fecha, dias) {
  const d = new Date(fecha)
  d.setDate(d.getDate() + dias)
  return d
}

export function lunesDe(fecha) {
  const d = new Date(`${fecha}T00:00:00`)
  return sumarDias(d, -DESDE_LUNES[d.getDay()])
}

const dosCifras = n => String(n).padStart(2, '0')

export function fechaLocal(valor) {
  const d = new Date(valor)
  return `${d.getFullYear()}-${dosCifras(d.getMonth() + 1)}-${dosCifras(d.getDate())}`
}

// Formato con el que se guardan los DateTime: 2026-11-14T10:00:00Z
export const isoSegundos = valor => new Date(valor).toISOString().slice(0, 19) + 'Z'

// Huecos (sede + fecha y hora) de una semana, ordenados para repartir los partidos entre los días
export function huecosDeJornada(franja, lunes, sedes, desde) {
  const huecos = []
  for (const hora of franja.horas)
    for (const sede of sedes)
      for (const dia of franja.dias) {
        const d = sumarDias(lunes, DESDE_LUNES[dia])
        const [h, m] = hora.split(':')
        d.setHours(Number(h), Number(m), 0, 0)
        if (d >= desde) huecos.push({ sede, fecha_hora: isoSegundos(d) })
      }
  return huecos
}
```

### 5.2 `srv/lib/partidos.js`

- **`sedeOcupada`:** comprueba si una sede ya tiene un partido a esa hora.
- **`marcadores`:** calcula el resultado a partir de la tabla de goles. Un gol en propia meta suma al rival.
- **`sancionVigente`:** devuelve la sanción que impide jugar a un jugador en una liga. Una sanción sigue vigente mientras su equipo no haya finalizado, desde `fecha_inicio`, tantos partidos como indica `partidos_suspension`. No cuenta el partido en que se cometió ni los aplazados o cancelados.

```js
import cds from '@sap/cds'
import { fechaLocal, isoSegundos } from './calendario.js'

export async function sedeOcupada(sede, fechaHora, excluirPartido) {
  const { Partidos } = cds.entities('football')
  const consulta = SELECT.one.from(Partidos).columns('ID')
    .where({ sede_ID: sede, fecha_hora: isoSegundos(fechaHora) })
  if (excluirPartido) consulta.where({ ID: { '!=': excluirPartido } })
  return !!(await consulta)
}

// Goles de cada equipo en los partidos indicados. Un gol en propia meta suma al rival.
export async function marcadores(partidos) {
  const resultado = new Map(partidos.map(p => [p.ID, { local: 0, visitante: 0 }]))
  if (!partidos.length) return resultado
  const { Goles } = cds.entities('football')
  const goles = await SELECT.from(Goles)
    .columns('tipo', 'participacion.partido.ID as partido', 'participacion.plantilla.inscripcion.ID as inscripcion')
    .where({ 'participacion.partido.ID': { in: partidos.map(p => p.ID) } })
  const porID = new Map(partidos.map(p => [p.ID, p]))
  for (const gol of goles) {
    const partido = porID.get(gol.partido)
    const marcaLocal = gol.inscripcion === partido.local_ID
    const sumaLocal = gol.tipo === 'propia_meta' ? !marcaLocal : marcaLocal
    resultado.get(partido.ID)[sumaLocal ? 'local' : 'visitante']++
  }
  return resultado
}

// Sanción que impide jugar al jugador en esa liga en la fecha indicada, o null si puede jugar
export async function sancionVigente(jugador, liga, fechaPartido) {
  const { Sanciones, Plantillas, Partidos } = cds.entities('football')
  const sanciones = await SELECT.from(Sanciones).where({ jugador_ID: jugador, liga_ID: liga })
  if (!sanciones.length) return null

  const ficha = await SELECT.one.from(Plantillas).columns('inscripcion_ID').where({ jugador_ID: jugador, liga_ID: liga })
  if (!ficha) return null
  const equipo = ficha.inscripcion_ID
  const jugados = await SELECT.from(Partidos).columns('ID', 'fecha_hora')
    .where`estado = 'finalizado' and (local_ID = ${equipo} or visitante_ID = ${equipo})`

  const limite = fechaPartido ? new Date(fechaPartido) : null
  return sanciones.find(s => {
    const cumplidos = jugados.filter(p =>
      p.ID !== s.partido_origen_ID &&
      fechaLocal(p.fecha_hora) >= s.fecha_inicio &&
      (!limite || new Date(p.fecha_hora) < limite)
    ).length
    return cumplidos < s.partidos_suspension
  }) ?? null
}
```

## 6. `AdminService`

Lo usa el rol `admin`. Las tablas del acta (`Participaciones`, `Goles` y `Amonestaciones`) se exponen como `@readonly` para que solo se puedan escribir con las actions, que son las que validan. Por el mismo motivo, `estado` es de solo lectura: si se envía en un `PATCH`, CAP lo ignora.

```cds
using football as db from '../db/schema';

service AdminService @(requires: 'admin') {

  entity Equipos       as projection on db.Equipos;
  entity Jugadores     as projection on db.Jugadores;
  entity Sedes         as projection on db.Sedes;
  entity Usuarios      as projection on db.Usuarios;
  entity AdminsEquipo  as projection on db.AdminsEquipo;
  entity Inscripciones as projection on db.Inscripciones;
  entity Plantillas    as projection on db.Plantillas;
  entity Jornadas      as projection on db.Jornadas;
  entity Sanciones     as projection on db.Sanciones;

  @readonly entity Participaciones as projection on db.Participaciones;
  @readonly entity Goles           as projection on db.Goles;
  @readonly entity Amonestaciones  as projection on db.Amonestaciones;

  entity Ligas as projection on db.Ligas actions {
    action generarCalendario(fechaInicio : Date @mandatory, idaYVuelta : Boolean) returns Integer;
  };

  entity Partidos as projection on db.Partidos actions {
    action   registrarParticipacion(plantilla : UUID @mandatory, titular : Boolean, minutos : Integer) returns Partidos;
    action   registrarGol(plantilla : UUID @mandatory, minuto : Integer, tipo : db.TipoGol)            returns Partidos;
    action   registrarAmonestacion(plantilla : UUID @mandatory, minuto : Integer,
                                   tipo : db.TipoAmonestacion @mandatory)                             returns Partidos;
    action   reprogramar(fecha_hora : DateTime @mandatory, sede : UUID @mandatory)                    returns Partidos;
    action   aplazar()                                                                                returns Partidos;
    action   finalizar()                                                                              returns Partidos;
    function jugadoresDisponibles()                                                                   returns many Plantillas;
  };
}

annotate AdminService.Partidos with {
  estado @readonly;
};
```

Puntos clave de la implementación:
- **`generarCalendario`:**
  1. Comprueba que haya al menos dos equipos inscritos y alguna sede.
  2. Borra el calendario anterior, salvo que algún partido ya no esté `programado` o tenga acta. En ese caso responde 409.
  3. Genera los cruces y busca huecos libres semana a semana, descartando los que ya ocupan partidos de otras ligas.
  4. Si una jornada no cabe en las sedes disponibles, responde 409 y no guarda nada.
  5. Devuelve el número de partidos creados.
- **Creación y modificación de partidos:** el handler `before` comprueba que local y visitante sean distintos, que ambos estén inscritos en la liga de la jornada y que la sede esté libre.
- **Acta:**
  - `registrarParticipacion` comprueba que el jugador pertenezca a uno de los dos equipos, que no esté dado de baja, que no tenga una sanción vigente en esa liga y que no esté ya en el acta.
  - Los goles y amonestaciones solo se aceptan para jugadores que ya figuran en el acta.
  - `Participaciones` tiene clave compuesta (`partido` + `plantilla`), así que los goles y tarjetas guardan las dos columnas: `participacion_partido_ID` y `participacion_plantilla_ID`.
- **`finalizar`:** cierra el acta y crea una sanción de 1 partido por cada tarjeta roja, con `partido_origen` relleno y la fecha del partido como `fecha_inicio`.
- **Respuesta de las actions:** las que cambian un partido devuelven el partido actualizado. Así una interfaz Fiori puede refrescarlo sin pedirlo otra vez.

```js
import cds from '@sap/cds'
import { FRANJAS, emparejamientos, huecosDeJornada, lunesDe, sumarDias, fechaLocal, isoSegundos } from './lib/calendario.js'
import { sedeOcupada, sancionVigente } from './lib/partidos.js'

const ACTA_ABIERTA = ['programado', 'en_juego']

export default class AdminService extends cds.ApplicationService {
  async init() {
    const db = cds.entities('football')
    const { Ligas, Partidos, Plantillas } = this.entities
    const valoresDe = tipo => Object.keys(cds.model.definitions[`football.${tipo}`].enum)
    const TIPOS_GOL = valoresDe('TipoGol')

    // ---------- Generador de jornadas ----------
    this.on('generarCalendario', Ligas, async req => {
      const liga = await SELECT.one.from(req.subject)
      if (!liga) return req.reject(404, 'La liga no existe')
      const { fechaInicio, idaYVuelta = false } = req.data

      const inscripciones = await SELECT.from(db.Inscripciones).columns('ID').where({ liga_ID: liga.ID })
      if (inscripciones.length < 2) return req.reject(400, 'La liga necesita al menos dos equipos inscritos')
      const sedes = (await SELECT.from(db.Sedes).columns('ID')).map(s => s.ID)
      if (!sedes.length) return req.reject(400, 'No hay sedes registradas')

      await borrarCalendario(req, liga.ID)

      const rondas = emparejamientos(inscripciones.map(i => i.ID), idaYVuelta)
      const desde = new Date(`${fechaInicio}T00:00:00`)
      const lunes = lunesDe(fechaInicio)
      const hasta = sumarDias(lunes, 7 * rondas.length)
      const ocupadas = await SELECT.from(db.Partidos).columns('sede_ID', 'fecha_hora')
        .where`fecha_hora >= ${isoSegundos(desde)} and fecha_hora < ${isoSegundos(hasta)}`
      const ocupado = new Set(ocupadas.map(p => `${p.sede_ID}|${isoSegundos(p.fecha_hora)}`))

      let total = 0
      for (const [i, ronda] of rondas.entries()) {
        const huecos = huecosDeJornada(FRANJAS[liga.franja], sumarDias(lunes, 7 * i), sedes, desde)
          .filter(h => !ocupado.has(`${h.sede}|${h.fecha_hora}`))
        if (huecos.length < ronda.length)
          return req.reject(409, `No hay sedes libres suficientes para la jornada ${i + 1}`)

        const jornada = { ID: cds.utils.uuid(), liga_ID: liga.ID, numero: i + 1 }
        const partidos = ronda.map(([local, visitante], j) => ({
          jornada_ID: jornada.ID, local_ID: local, visitante_ID: visitante,
          sede_ID: huecos[j].sede, fecha_hora: huecos[j].fecha_hora,
        }))
        const fechas = partidos.map(p => fechaLocal(p.fecha_hora)).sort()
        jornada.fecha_inicio = fechas[0]
        jornada.fecha_fin = fechas.at(-1)

        await INSERT.into(db.Jornadas).entries(jornada)
        await INSERT.into(db.Partidos).entries(partidos)
        total += partidos.length
      }
      return total
    })

    async function borrarCalendario(req, ligaID) {
      const jornadas = (await SELECT.from(db.Jornadas).columns('ID').where({ liga_ID: ligaID })).map(j => j.ID)
      if (!jornadas.length) return
      const partidos = await SELECT.from(db.Partidos).columns('ID', 'estado').where({ jornada_ID: { in: jornadas } })
      const conActa = partidos.length &&
        await SELECT.one.from(db.Participaciones).where({ partido_ID: { in: partidos.map(p => p.ID) } })
      if (conActa || partidos.some(p => p.estado !== 'programado'))
        return req.reject(409, 'La liga ya tiene partidos jugados o con acta: no se puede regenerar el calendario')
      await DELETE.from(db.Partidos).where({ jornada_ID: { in: jornadas } })
      await DELETE.from(db.Jornadas).where({ liga_ID: ligaID })
    }

    // ---------- Creación y modificación de partidos ----------
    this.before(['CREATE', 'UPDATE'], Partidos, async req => {
      const actual = req.event === 'UPDATE' ? await SELECT.one.from(req.subject) : {}
      const p = { ...actual, ...req.data }
      if (p.local_ID === p.visitante_ID) return req.reject(400, 'Un equipo no puede jugar contra sí mismo')

      const jornada = await SELECT.one.from(db.Jornadas).columns('liga_ID').where({ ID: p.jornada_ID })
      if (!jornada) return req.reject(400, 'La jornada no existe')
      const equipos = await SELECT.from(db.Inscripciones).columns('ID')
        .where({ ID: { in: [p.local_ID, p.visitante_ID] }, liga_ID: jornada.liga_ID })
      if (equipos.length !== 2) return req.reject(400, 'Los dos equipos deben estar inscritos en la liga de la jornada')

      if (p.fecha_hora && await sedeOcupada(p.sede_ID, p.fecha_hora, p.ID))
        return req.reject(409, 'La sede ya tiene un partido a esa hora')
    })

    this.on('reprogramar', Partidos, async req => {
      const partido = await SELECT.one.from(req.subject)
      if (!['programado', 'aplazado'].includes(partido.estado))
        return req.reject(409, `No se puede reprogramar un partido ${partido.estado}`)
      const { fecha_hora, sede } = req.data
      if (!await SELECT.one.from(db.Sedes).where({ ID: sede })) return req.reject(400, 'La sede no existe')
      if (await sedeOcupada(sede, fecha_hora, partido.ID)) return req.reject(409, 'La sede ya tiene un partido a esa hora')
      await UPDATE(db.Partidos, partido.ID).with({ fecha_hora: isoSegundos(fecha_hora), sede_ID: sede, estado: 'programado' })
      return SELECT.one.from(req.subject)
    })

    this.on('aplazar', Partidos, async req => {
      const partido = await SELECT.one.from(req.subject)
      if (partido.estado !== 'programado') return req.reject(409, `No se puede aplazar un partido ${partido.estado}`)
      await UPDATE(db.Partidos, partido.ID).with({ estado: 'aplazado' })
      return SELECT.one.from(req.subject)
    })

    // ---------- Acta ----------
    async function partidoConActaAbierta(req) {
      const partido = await SELECT.one.from(req.subject)
      if (!partido) return req.reject(404, 'El partido no existe')
      if (!ACTA_ABIERTA.includes(partido.estado))
        return req.reject(409, `No se puede modificar el acta de un partido ${partido.estado}`)
      return partido
    }

    function comprobarMinuto(req, minuto) {
      if (minuto != null && (minuto < 0 || minuto > 130)) req.reject(400, 'El minuto debe estar entre 0 y 130')
    }

    async function participacionEnActa(req, partido, plantilla) {
      const participacion = await SELECT.one.from(db.Participaciones)
        .where({ partido_ID: partido.ID, plantilla_ID: plantilla })
      if (!participacion) return req.reject(409, 'El jugador no figura en el acta de este partido')
      // Participaciones tiene clave compuesta: los goles y tarjetas guardan las dos columnas
      return { participacion_partido_ID: partido.ID, participacion_plantilla_ID: plantilla }
    }

    this.on('registrarParticipacion', Partidos, async req => {
      const partido = await partidoConActaAbierta(req)
      const { plantilla, titular = false, minutos } = req.data
      const ficha = await SELECT.one.from(db.Plantillas).where({ ID: plantilla })
      if (!ficha) return req.reject(404, 'La ficha no existe')
      if (![partido.local_ID, partido.visitante_ID].includes(ficha.inscripcion_ID))
        return req.reject(400, 'El jugador no pertenece a ninguno de los dos equipos')
      if (ficha.fecha_baja && ficha.fecha_baja <= fechaLocal(partido.fecha_hora))
        return req.reject(409, 'El jugador está dado de baja')
      if (await sancionVigente(ficha.jugador_ID, ficha.liga_ID, partido.fecha_hora))
        return req.reject(409, 'El jugador tiene una sanción vigente en esta liga')
      if (await SELECT.one.from(db.Participaciones).where({ partido_ID: partido.ID, plantilla_ID: plantilla }))
        return req.reject(409, 'El jugador ya figura en el acta')

      await INSERT.into(db.Participaciones).entries({
        partido_ID: partido.ID, plantilla_ID: plantilla, titular, minutos_jugados: minutos,
      })
      return SELECT.one.from(req.subject)
    })

    this.on('registrarGol', Partidos, async req => {
      const partido = await partidoConActaAbierta(req)
      const { plantilla, minuto, tipo = 'normal' } = req.data
      if (!TIPOS_GOL.includes(tipo)) return req.reject(400, `Tipo de gol no válido: ${tipo}`)
      comprobarMinuto(req, minuto)
      const participacion = await participacionEnActa(req, partido, plantilla)
      await INSERT.into(db.Goles).entries({ ...participacion, minuto, tipo })
      return SELECT.one.from(req.subject)
    })

    this.on('registrarAmonestacion', Partidos, async req => {
      const partido = await partidoConActaAbierta(req)
      const { plantilla, minuto, tipo } = req.data
      comprobarMinuto(req, minuto)
      const participacion = await participacionEnActa(req, partido, plantilla)
      await INSERT.into(db.Amonestaciones).entries({ ...participacion, minuto, tipo })
      return SELECT.one.from(req.subject)
    })

    this.on('finalizar', Partidos, async req => {
      const partido = await partidoConActaAbierta(req)
      await UPDATE(db.Partidos, partido.ID).with({ estado: 'finalizado' })

      // Cada tarjeta roja genera automáticamente una sanción de un partido en la misma liga
      const rojas = await SELECT.from(db.Amonestaciones)
        .columns('participacion.plantilla.jugador.ID as jugador', 'participacion.plantilla.liga.ID as liga')
        .where({ tipo: 'roja', 'participacion.partido.ID': partido.ID })
      if (rojas.length) await INSERT.into(db.Sanciones).entries(rojas.map(r => ({
        jugador_ID: r.jugador, liga_ID: r.liga, partido_origen_ID: partido.ID,
        motivo: 'Tarjeta roja', partidos_suspension: 1, fecha_inicio: fechaLocal(partido.fecha_hora),
      })))
      return SELECT.one.from(req.subject)
    })

    this.on('jugadoresDisponibles', Partidos, async req => {
      const partido = await SELECT.one.from(req.subject)
      const fichas = await SELECT.from(Plantillas).where({ inscripcion_ID: { in: [partido.local_ID, partido.visitante_ID] } })
      const disponibles = []
      for (const ficha of fichas) {
        if (ficha.fecha_baja && ficha.fecha_baja <= fechaLocal(partido.fecha_hora)) continue
        if (await sancionVigente(ficha.jugador_ID, ficha.liga_ID, partido.fecha_hora)) continue
        disponibles.push(ficha)
      }
      return disponibles
    })

    return super.init()
  }
}
```

## 7. `EquipoService`

Lo usa el rol `admin_equipo`. `@restrict` con `where` limita cada administrador a sus equipos, comparando el usuario conectado (`$user`) con el email de `Usuarios`. CAP aplica esta condición también a las actions bound: si un administrador llama a `altaJugador` sobre la inscripción de otro equipo, recibe 403 sin que el handler tenga que comprobarlo.

`Inscripciones` y `Plantillas` son `@readonly`, así que las fichas solo se crean con `altaJugador`. Esto garantiza que la liga de la ficha sea siempre la de la inscripción.

```cds
using football as db from '../db/schema';

service EquipoService @(requires: 'admin_equipo') {

  @readonly
  @restrict: [{ grant: '*', where: 'exists equipo.admins[usuario.email = $user]' }]
  entity Inscripciones as projection on db.Inscripciones actions {
    action altaJugador(documento_identidad : String @mandatory, nombre : String @mandatory,
                       apellidos : String @mandatory, fecha_nacimiento : Date, dorsal : Integer) returns Plantillas;
  };

  @readonly
  @restrict: [{ grant: '*', where: 'exists inscripcion.equipo.admins[usuario.email = $user]' }]
  entity Plantillas as projection on db.Plantillas actions {
    action darDeBaja(fecha : Date) returns Plantillas;
  };

  @readonly
  entity Jugadores as projection on db.Jugadores excluding { documento_identidad, fecha_nacimiento, sanciones };
}
```

- **`altaJugador`:**
  - Busca al jugador por `documento_identidad` y lo reutiliza si ya está en el directorio.
  - Rechaza la ficha si el jugador ya tiene otra en esa liga, aunque esté dada de baja, o si el dorsal está ocupado.
  - La restricción única de la base de datos impide el duplicado igualmente, pero comprobarlo antes permite devolver un mensaje claro.
- **`darDeBaja`:** registra la fecha de baja, que por defecto es hoy. La ficha se conserva, así que el jugador sigue sin poder fichar por otro equipo de la misma liga.

```js
import cds from '@sap/cds'
import { fechaLocal } from './lib/calendario.js'

export default class EquipoService extends cds.ApplicationService {
  async init() {
    const db = cds.entities('football')
    const { Inscripciones, Plantillas } = this.entities

    this.on('altaJugador', Inscripciones, async req => {
      const inscripcion = await SELECT.one.from(req.subject)
      if (!inscripcion) return req.reject(404, 'La inscripción no existe')
      const { documento_identidad, nombre, apellidos, fecha_nacimiento, dorsal } = req.data

      // Reutiliza al jugador si ya está en el directorio
      let jugador = await SELECT.one.from(db.Jugadores).columns('ID').where({ documento_identidad })
      if (!jugador) {
        jugador = { ID: cds.utils.uuid() }
        await INSERT.into(db.Jugadores).entries({ ...jugador, documento_identidad, nombre, apellidos, fecha_nacimiento })
      }

      // Regla principal: una sola ficha por liga, aunque se haya dado de baja
      if (await SELECT.one.from(db.Plantillas).where({ jugador_ID: jugador.ID, liga_ID: inscripcion.liga_ID }))
        return req.reject(409, 'El jugador ya tiene ficha en un equipo de esta liga')
      if (dorsal != null && await SELECT.one.from(db.Plantillas).where({ inscripcion_ID: inscripcion.ID, dorsal }))
        return req.reject(409, `El dorsal ${dorsal} ya está asignado en este equipo`)

      const ficha = {
        ID: cds.utils.uuid(), jugador_ID: jugador.ID, inscripcion_ID: inscripcion.ID,
        liga_ID: inscripcion.liga_ID, dorsal, fecha_alta: fechaLocal(new Date()),
      }
      await INSERT.into(db.Plantillas).entries(ficha)
      return SELECT.one.from(Plantillas, ficha.ID)
    })

    this.on('darDeBaja', Plantillas, async req => {
      const ficha = await SELECT.one.from(req.subject)
      if (!ficha) return req.reject(404, 'La ficha no existe')
      if (ficha.fecha_baja) return req.reject(409, 'El jugador ya está dado de baja')
      const fecha = req.data.fecha ?? fechaLocal(new Date())
      if (ficha.fecha_alta && fecha < ficha.fecha_alta) return req.reject(400, 'La baja no puede ser anterior al alta')
      await UPDATE(db.Plantillas, ficha.ID).with({ fecha_baja: fecha })
      return SELECT.one.from(req.subject)
    })

    return super.init()
  }
}
```

## 8. `ConsultaService`

Lo puede usar cualquier usuario autenticado: jugadores, administradores de equipo y administradores. Todo es de solo lectura, y `Jugadores` oculta `documento_identidad` y `fecha_nacimiento`.

```cds
using football as db from '../db/schema';

service ConsultaService @(requires: 'authenticated-user') {

  @readonly entity Equipos   as projection on db.Equipos;
  @readonly entity Ligas     as projection on db.Ligas;
  @readonly entity Jornadas  as projection on db.Jornadas;
  @readonly entity Sedes     as projection on db.Sedes;
  @readonly entity Jugadores as projection on db.Jugadores excluding { documento_identidad, fecha_nacimiento, sanciones };

  @readonly entity Partidos as projection on db.Partidos excluding { participaciones } actions {
    function marcador() returns Marcador;
  };

  type Marcador {
    local     : Integer;
    visitante : Integer;
  }

  type FilaClasificacion {
    posicion    : Integer;
    equipo      : String;
    jugados     : Integer;
    ganados     : Integer;
    empatados   : Integer;
    perdidos    : Integer;
    golesFavor  : Integer;
    golesContra : Integer;
    diferencia  : Integer;
    puntos      : Integer;
  }

  type FilaGoleador {
    jugador   : UUID;
    nombre    : String;
    apellidos : String;
    equipo    : String;
    goles     : Integer;
  }

  function clasificacion(liga : UUID @mandatory)              returns many FilaClasificacion;
  function goleadores(liga : UUID @mandatory, top : Integer)  returns many FilaGoleador;
}
```

- **`marcador`:** devuelve el resultado de un partido calculado desde la tabla de goles.
- **`clasificacion`:** recorre los partidos finalizados de la liga, suma resultados y ordena según los criterios del apartado 2.
- **`goleadores`:** agrupa con una sola consulta los goles de partidos finalizados, sin contar los de propia meta, y devuelve los `top` primeros (10 por defecto).

```js
import cds from '@sap/cds'
import { marcadores } from './lib/partidos.js'

export default class ConsultaService extends cds.ApplicationService {
  async init() {
    const db = cds.entities('football')
    const { Partidos } = this.entities

    this.on('marcador', Partidos, async req => {
      const partido = await SELECT.one.from(req.subject).columns('ID', 'local_ID', 'visitante_ID')
      if (!partido) return req.reject(404, 'El partido no existe')
      return (await marcadores([partido])).get(partido.ID)
    })

    this.on('clasificacion', async req => {
      const equipos = await SELECT.from(db.Inscripciones).columns('ID', 'equipo.nombre as equipo')
        .where({ liga_ID: req.data.liga })
      if (!equipos.length) return []
      const filas = new Map(equipos.map(e => [e.ID, {
        equipo: e.equipo, jugados: 0, ganados: 0, empatados: 0, perdidos: 0, golesFavor: 0, golesContra: 0,
      }]))

      const partidos = await SELECT.from(db.Partidos).columns('ID', 'local_ID', 'visitante_ID')
        .where({ estado: 'finalizado', local_ID: { in: [...filas.keys()] } })
      const resultados = await marcadores(partidos)
      for (const p of partidos) {
        const { local, visitante } = resultados.get(p.ID)
        sumar(filas.get(p.local_ID), local, visitante)
        sumar(filas.get(p.visitante_ID), visitante, local)
      }

      return [...filas.values()]
        .map(f => ({ ...f, diferencia: f.golesFavor - f.golesContra, puntos: 3 * f.ganados + f.empatados }))
        .sort((a, b) => b.puntos - a.puntos || b.diferencia - a.diferencia
          || b.golesFavor - a.golesFavor || a.equipo.localeCompare(b.equipo))
        .map((f, i) => ({ posicion: i + 1, ...f }))
    })

    this.on('goleadores', async req => {
      const { liga, top = 10 } = req.data
      return SELECT.from(db.Goles)
        .columns(
          'participacion.plantilla.jugador.ID as jugador',
          'participacion.plantilla.jugador.nombre as nombre',
          'participacion.plantilla.jugador.apellidos as apellidos',
          'participacion.plantilla.inscripcion.equipo.nombre as equipo',
          'count(*) as goles',
        )
        .where({
          'participacion.plantilla.liga.ID': liga,
          'participacion.partido.estado': 'finalizado',
          tipo: { '!=': 'propia_meta' },
        })
        .groupBy(
          'participacion.plantilla.jugador.ID', 'participacion.plantilla.jugador.nombre',
          'participacion.plantilla.jugador.apellidos', 'participacion.plantilla.inscripcion.equipo.nombre',
        )
        .orderBy('goles desc')
        .limit(top)
    })

    return super.init()
  }
}

function sumar(fila, favor, contra) {
  fila.jugados++
  fila.golesFavor += favor
  fila.golesContra += contra
  if (favor > contra) fila.ganados++
  else if (favor === contra) fila.empatados++
  else fila.perdidos++
}
```

## 9. Probar las operaciones

### 9.1 Usuarios de prueba

Hasta que se decida el login, CAP permite simular usuarios. Se definen en `package.json`, dentro de `cds.requires`:

```json
"auth": {
  "kind": "mocked",
  "users": {
    "admin@liga.es":    { "password": "admin",    "roles": ["admin"] },
    "delegado@liga.es": { "password": "delegado", "roles": ["admin_equipo"] },
    "jugador@liga.es":  { "password": "jugador",  "roles": ["jugador"] }
  }
}
```

El usuario del administrador de equipo debe existir también en los datos: una fila en `Usuarios` con ese email y otra en `AdminsEquipo` que lo relacione con su equipo. Sin ellas, `EquipoService` no le muestra nada.

### 9.2 Peticiones de ejemplo

La extensión REST Client, recomendada en `.vscode/extensions.json`, ejecuta peticiones desde un fichero `.http`. Por ejemplo, `test/acciones.http`, con `cds watch` en marcha y los IDs de tus datos de prueba:

```http
@base = http://localhost:4004/odata/v4
@liga = <ID de una liga>
@partido = <ID de un partido>
@ficha = <ID de una ficha de Plantillas>

### Generar el calendario
POST {{base}}/admin/Ligas({{liga}})/generarCalendario
Authorization: Basic admin@liga.es:admin
Content-Type: application/json

{ "fechaInicio": "2026-11-14", "idaYVuelta": true }

### Añadir un jugador al acta
POST {{base}}/admin/Partidos({{partido}})/registrarParticipacion
Authorization: Basic admin@liga.es:admin
Content-Type: application/json

{ "plantilla": "{{ficha}}", "titular": true, "minutos": 90 }

### Registrar un gol
POST {{base}}/admin/Partidos({{partido}})/registrarGol
Authorization: Basic admin@liga.es:admin
Content-Type: application/json

{ "plantilla": "{{ficha}}", "minuto": 23, "tipo": "penalti" }

### Finalizar el partido
POST {{base}}/admin/Partidos({{partido}})/finalizar
Authorization: Basic admin@liga.es:admin
Content-Type: application/json

{}

### Clasificación
GET {{base}}/consulta/clasificacion(liga={{liga}})
Authorization: Basic jugador@liga.es:jugador

### Máximos goleadores
GET {{base}}/consulta/goleadores(liga={{liga}},top=5)
Authorization: Basic jugador@liga.es:jugador
```

Los IDs van sin comillas en la URL (`Ligas(1234-...)`), pero entre comillas dentro del JSON.

### 9.3 Casos que conviene cubrir en los tests

- **Generador:** número par e impar de equipos, nadie juega dos veces en una jornada, cada cruce aparece una vez por vuelta, sin choques de sede y hora, y regeneración bloqueada con partidos jugados.
- **Acta:** gol de un jugador que no está en el acta, jugador repetido, minuto o tipo no válidos y acta cerrada tras finalizar.
- **Sanciones:** la roja genera la sanción, el sancionado no puede entrar en el siguiente partido de su liga, los aplazados no descuentan y tras cumplirla vuelve a poder jugar.
- **Fichas:** jugador en dos equipos de la misma liga, también tras una baja, y dorsal repetido.
- **Resultados:** gol en propia meta en el marcador, la clasificación y los goleadores.
- **Permisos:** un jugador intentando usar `AdminService` y un administrador de equipo actuando sobre otro equipo.

## 10. Limitaciones conocidas

- **Zona horaria:** las horas de `FRANJAS` se interpretan en la zona horaria del servidor. En el entorno de pruebas es UTC, así que un partido "a las 10:00" se guarda como `10:00Z` y en España se mostraría a las 11:00 o las 12:00. Para usar la hora española, arranca el servidor con la variable `TZ=Europe/Madrid`.
- **Rendimiento:** `jugadoresDisponibles` y `sancionVigente` hacen consultas por cada jugador. Es suficiente para el tamaño de una liga, pero no escalaría a miles de fichas.
- **Concurrencia:** dos peticiones simultáneas podrían reservar la misma sede y hora, porque esa comprobación se hace en código y no con una restricción de la base de datos. Las fichas duplicadas sí las impide la base de datos.
- **Interfaz:** para que las actions aparezcan como botones en Fiori hay que añadir anotaciones `@UI`, lo que corresponde al paso 9 de la guía de desarrollo.
- **Login:** sigue pendiente. Cuando se decida, solo cambia la configuración de `auth`; los roles `admin`, `admin_equipo` y `jugador` se mantienen.
