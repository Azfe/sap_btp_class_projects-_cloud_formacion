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
