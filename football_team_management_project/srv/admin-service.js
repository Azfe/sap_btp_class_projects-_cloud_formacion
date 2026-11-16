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
      const fichas = await SELECT.from(Plantillas, f => {
        f`*`, f.jugador(j => { j.nombre, j.apellidos }), f.inscripcion(i => { i.ID, i.equipo(e => { e.nombre }) })
      }).where({ inscripcion_ID: { in: [partido.local_ID, partido.visitante_ID] } }).orderBy('dorsal')
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
