using football as db from '../db/schema';

service EquipoService @(requires: 'admin_equipo') {

  @readonly
  @restrict: [{ grant: '*', where: 'exists equipo.admins[usuario.email = $user]' }]
  entity Inscripciones as projection on db.Inscripciones {
      *,
      equipo.nombre  as equipoNombre,
      liga.nombre    as ligaNombre,
      liga.temporada as temporada
    } actions {
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
