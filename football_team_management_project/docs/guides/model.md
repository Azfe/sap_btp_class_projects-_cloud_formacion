# Guía de creación del modelo

Pasos para crear el modelo de datos en `db/schema.cds` a partir del [diagrama E/R](https://www.figma.com/board/C0kyvlbqtiaDjY4z7bmeIP/Diagrama-E-R-Football-Team-Management?node-id=0-1&p=f&t=oZzn8I5cPiGZ4Whg-0). Desarrolla el paso 4 de la [guía de desarrollo](project_development.md).

El modelo completo se probó en una copia aparte: compila, genera las 14 tablas y SQLite rechaza a un jugador en dos equipos de la misma liga.

## 1. Añadir la cabecera

Va en la primera línea del archivo. Sin el `using`, `cuid` no se reconoce:

```cds
namespace football;

using { cuid } from '@sap/cds/common';
```

## 2. Definir los enums

Los valores de `Franja` salen del enunciado. Los demás son una propuesta y se pueden ajustar:

```cds
type Rol : String(20) enum { admin; admin_equipo; jugador; }
type Franja : String(20) enum { diario; sabado_manana; sabado_tarde; domingo_manana; domingo_tarde; }
type EstadoPartido : String(20) enum { programado; en_juego; finalizado; aplazado; cancelado; }
type TipoGol : String(20) enum { normal; penalti; propia_meta; }
type TipoAmonestacion : String(20) enum { amarilla; roja; }
```

## 3. Crear las entidades sin dependencias

Las `Association to many` no crean columnas: solo permiten navegar entre entidades. Sus referencias se resuelven con las tablas de los pasos 4 y 5.

```cds
@assert.unique: { nombre: [nombre] }
entity Equipos : cuid {
  nombre          : String(100) not null;
  escudo_url      : String(255);
  color_principal : String(30);
  fecha_alta      : Date;
  inscripciones   : Association to many Inscripciones on inscripciones.equipo = $self;
  admins          : Association to many AdminsEquipo on admins.equipo = $self;
}

@assert.unique: { documento: [documento_identidad] }
entity Jugadores : cuid {
  nombre              : String(100) not null;
  apellidos           : String(150) not null;
  fecha_nacimiento    : Date;
  documento_identidad : String(20) not null;
  foto_url            : String(255);
  fichas              : Association to many Plantillas on fichas.jugador = $self;
  sanciones           : Association to many Sanciones on sanciones.jugador = $self;
}

entity Ligas : cuid {
  nombre        : String(100) not null;
  temporada     : String(9) not null;
  franja        : Franja not null @assert.range;
  inscripciones : Association to many Inscripciones on inscripciones.liga = $self;
  jornadas      : Association to many Jornadas on jornadas.liga = $self;
}

entity Sedes : cuid {
  nombre    : String(100) not null;
  direccion : String(255);
  ciudad    : String(100);
}

@assert.unique: { email: [email], jugador: [jugador] }
entity Usuarios : cuid {
  email         : String(255) not null;
  password_hash : String(255);
  nombre        : String(100);
  rol           : Rol not null @assert.range;
  jugador       : Association to Jugadores;
}
```

## 4. Añadir las tablas de relación

`Plantillas` lleva dos restricciones únicas: un jugador por liga y un dorsal por inscripción.

```cds
entity AdminsEquipo {
  key usuario : Association to Usuarios;
  key equipo  : Association to Equipos;
}

@assert.unique: { ligaEquipo: [liga, equipo] }
entity Inscripciones : cuid {
  liga              : Association to Ligas not null;
  equipo            : Association to Equipos not null;
  fecha_inscripcion : Date;
  plantilla         : Association to many Plantillas on plantilla.inscripcion = $self;
}

@assert.unique: {
  jugadorLiga      : [jugador, liga],
  dorsalInscripcion: [inscripcion, dorsal]
}
entity Plantillas : cuid {
  jugador     : Association to Jugadores not null;
  inscripcion : Association to Inscripciones not null;
  liga        : Association to Ligas not null;
  dorsal      : Integer;
  fecha_alta  : Date;
  fecha_baja  : Date;
}

@assert.unique: { ligaNumero: [liga, numero] }
entity Jornadas : cuid {
  liga         : Association to Ligas not null;
  numero       : Integer not null;
  fecha_inicio : Date;
  fecha_fin    : Date;
  partidos     : Association to many Partidos on partidos.jornada = $self;
}
```

## 5. Añadir los partidos, las actas y las sanciones

Las `Composition` hacen que, al borrar un partido, se borren sus participaciones, goles y amonestaciones:

```cds
entity Partidos : cuid {
  jornada         : Association to Jornadas not null;
  local           : Association to Inscripciones not null;
  visitante       : Association to Inscripciones not null;
  sede            : Association to Sedes not null;
  fecha_hora      : DateTime;
  estado          : EstadoPartido default 'programado' @assert.range;
  participaciones : Composition of many Participaciones on participaciones.partido = $self;
}

@assert.unique: { partidoPlantilla: [partido, plantilla] }
entity Participaciones : cuid {
  partido         : Association to Partidos not null;
  plantilla       : Association to Plantillas not null;
  titular         : Boolean default false;
  minutos_jugados : Integer;
  goles           : Composition of many Goles on goles.participacion = $self;
  amonestaciones  : Composition of many Amonestaciones on amonestaciones.participacion = $self;
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
```

## 6. Compilar y añadir los tests

```bash
cds compile db/schema.cds --to sql
cds add test
npm install
```

Si la compilación va bien, se muestran los `CREATE TABLE` de las 14 tablas. Aún no hay servicios ni pantallas, porque llegan en el paso 6 de la guía de desarrollo.

## Diferencias con el diagrama

- **Nombres de claves:** se escribe `jugador` y CAP genera `jugador_ID`. `id` pasa a ser `ID`.
- **Nombres más cortos:** `inscripcion_local_id` e `inscripcion_visitante_id` pasan a `local` y `visitante`, y las columnas son `local_ID` y `visitante_ID`.
- **Sede obligatoria:** como en el diagrama, cada partido necesita sede, así que el generador de jornadas tiene que asignarla al crearlo.

## Pendientes que afectan al modelo

- **Dorsal:** con esta restricción no se puede reutilizar el dorsal de un jugador dado de baja.
- **Login:** `password_hash` y `rol` se mantienen hasta elegir el sistema de login.

`@assert.range` solo valida los enums cuando los datos entran por un servicio, así que se comprueba a partir del paso 6 de la guía de desarrollo. La prueba del modelo no lo cubrió.
