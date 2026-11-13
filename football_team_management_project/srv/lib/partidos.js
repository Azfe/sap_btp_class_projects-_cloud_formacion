import cds from '@sap/cds'
import { fechaLocal, isoSegundos } from './calendario.js'

// Comprueba si una sede ya tiene un partido a esa hora
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
