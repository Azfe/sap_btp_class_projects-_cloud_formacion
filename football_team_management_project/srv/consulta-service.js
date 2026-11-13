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
