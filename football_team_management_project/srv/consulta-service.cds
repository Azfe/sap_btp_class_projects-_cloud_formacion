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
