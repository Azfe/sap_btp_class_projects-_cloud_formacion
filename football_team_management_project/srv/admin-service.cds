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
