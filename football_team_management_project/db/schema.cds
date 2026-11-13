namespace football;

using {cuid} from '@sap/cds/common';

// Definición Enums

type Rol              : String(20) enum {
    admin;
    admin_equipo;
    jugador;
}

type Franja           : String(20) enum {
    diario;
    sabado_manana;
    sabado_tarde;
    domingo_manana;
    domingo_tarde;
}

type EstadoPartido    : String(20) enum {
    programado;
    en_juego;
    finalizado;
    aplazado;
    cancelado;
}

type TipoGol          : String(20) enum {
    normal;
    penalti;
    propia_meta;
}

type TipoAmonestacion : String(20) enum {
    amarilla;
    roja;
}

// Entidades

@assert.unique: {nombre: [nombre]}
entity Equipos : cuid {
    nombre          : String(100) not null;
    escudo_url      : String(255);
    color_principal : String(30);
    fecha_alta      : Date;
    inscripciones   : Composition of many Inscripciones
                          on inscripciones.equipo = $self;
    admins          : Composition of many AdminsEquipo
                          on admins.equipo = $self;
}

@assert.unique: {documento: [documento_identidad]}
entity Jugadores : cuid {
    nombre              : String(100) not null;
    apellidos           : String(150) not null;
    fecha_nacimiento    : Date;
    documento_identidad : String(20) not null;
    foto_url            : String(255);
    fichas              : Composition of many Plantillas
                              on fichas.jugador = $self;
    sanciones           : Composition of many Sanciones
                              on sanciones.jugador = $self;
}

entity Ligas : cuid {
    nombre        : String(100) not null;
    temporada     : String(9) not null;
    franja        : Franja not null @assert.range;
    inscripciones : Composition of many Inscripciones
                        on inscripciones.liga = $self;
    jornadas      : Composition of many Jornadas
                        on jornadas.liga = $self;
}

entity Sedes : cuid {
    nombre    : String(100) not null;
    direccion : String(255);
    ciudad    : String(100);
}

@assert.unique: {
    email  : [email],
    jugador: [jugador]
}
entity Usuarios : cuid {
    email         : String(255) not null;
    password_hash : String(255);
    nombre        : String(100);
    rol           : Rol not null @assert.range;
    jugador       : Association to Jugadores;
}

entity AdminsEquipo {
    key usuario : Association to Usuarios;
    key equipo  : Association to Equipos;
}

@assert.unique: {ligaEquipo: [
    liga,
    equipo
]}
entity Inscripciones : cuid {
    liga              : Association to Ligas not null;
    equipo            : Association to Equipos not null;
    fecha_inscripcion : Date;
    plantilla         : Composition of many Plantillas
                            on plantilla.inscripcion = $self;
}

@assert.unique: {
    jugadorLiga      : [
        jugador,
        liga
    ],
    dorsalInscripcion: [
        inscripcion,
        dorsal
    ]
}
entity Plantillas : cuid {
    jugador     : Association to Jugadores not null;
    inscripcion : Association to Inscripciones not null;
    liga        : Association to Ligas not null;
    dorsal      : Integer;
    fecha_alta  : Date;
    fecha_baja  : Date;
}

@assert.unique: {ligaNumero: [
    liga,
    numero
]}
entity Jornadas : cuid {
    liga         : Association to Ligas not null;
    numero       : Integer not null;
    fecha_inicio : Date;
    fecha_fin    : Date;
    partidos     : Composition of many Partidos
                       on partidos.jornada = $self;
}

entity Partidos : cuid {
    jornada         : Association to Jornadas not null;
    local           : Association to Inscripciones not null;
    visitante       : Association to Inscripciones not null;
    sede            : Association to Sedes not null;
    fecha_hora      : DateTime;
    estado          : EstadoPartido default 'programado' @assert.range;
    participaciones : Composition of many Participaciones
                          on participaciones.partido = $self;
}

@assert.unique: {partidoPlantilla: [
    partido,
    plantilla
]}
entity Participaciones {
    key partido         : Association to Partidos not null;
    key plantilla       : Association to Plantillas not null;
    titular         : Boolean default false;
    minutos_jugados : Integer;
    goles           : Composition of many Goles
                          on goles.participacion = $self;
    amonestaciones  : Composition of many Amonestaciones
                          on amonestaciones.participacion = $self;
}

entity Goles : cuid {
    participacion : Association to Participaciones not null;
    minuto        : Integer;
    tipo          : TipoGol default 'normal' @assert.range;
}

entity Amonestaciones : cuid {
    participacion : Association to Participaciones not null;
    minuto        : Integer;
    tipo          : TipoAmonestacion not null @assert.range;
}

entity Sanciones : cuid {
    jugador             : Association to Jugadores not null;
    liga                : Association to Ligas not null;
    partido_origen      : Association to Partidos;
    motivo              : String(255);
    partidos_suspension : Integer not null;
    fecha_inicio        : Date not null;
}
