# Guía de desarrollo del proyecto

Pasos para desarrollar la aplicación de gestión de equipos de fútbol sobre **SAP CAP**, a partir del [diagrama E/R](https://www.figma.com/board/C0kyvlbqtiaDjY4z7bmeIP/Diagrama-E-R-Football-Team-Management?node-id=0-1&p=f&t=oZzn8I5cPiGZ4Whg-0), que tiene 14 entidades.

El proyecto parte de un esqueleto de CAP con `app/`, `db/` y `srv/` vacías y sin `package.json`. Se recomienda Node.js, salvo que la clase exija Java.

## 1. Decisiones tomadas

| Pregunta | Decisión | Consecuencia |
|---|---|---|
| **¿Se puede cambiar de equipo en plena liga?** | No. | `unique(jugador, liga)` en `Plantillas`. Una baja no libera al jugador: no puede volver a ficharse en esa liga. |
| **¿A qué ligas afecta una sanción?** | Solo a la liga donde se comete. | `SANCION` necesita `liga_id` obligatorio. El jugador puede seguir jugando en sus otras ligas. |
| **¿Quién registra las actas de los partidos?** | Solo el administrador. | Participantes, goles y amonestaciones solo se escriben desde `AdminService`. |
| **¿Qué marca la duración de una sanción?** | `partidos_suspension`. | Se elimina `fecha_fin`. La sanción se cumple al contar los partidos finalizados de su equipo en esa liga desde `fecha_inicio`. |

### Decisiones pendientes

| Pregunta | Por qué importa | Propuesta |
|---|---|---|
| **¿Cómo será el login?** | CAP delega la autenticación, así que `password_hash` puede sobrar. | Usuarios simulados (`mocked`) en desarrollo y XSUAA o IAS si se despliega. |

## 2. Ajustar el diagrama

- **`SANCION`:** añadir `liga_id` obligatorio. Si la sanción tiene `partido_origen_id`, la liga debe coincidir con la de ese partido.
- **Claves:** cambiar los `int` por UUID (`cuid`), que es lo habitual en CAP. CDS genera las FK a partir de las asociaciones, así que no se declaran a mano.
- **Enums:** `franja`, `GOL.tipo` y `AMONESTACION.tipo` deberían ser enums, no `string`.
- **Goles del partido:** `goles_local` y `goles_visitante` pueden contradecir la tabla `GOL`. Conviene calcularlos a partir de ella, teniendo en cuenta que un gol en propia meta suma al rival.
- **Sanciones:** quitar `fecha_fin`, porque la duración la marca `partidos_suspension` y ambos campos podrían contradecirse.
- **Restricciones únicas que faltan:**
  - `USUARIO.jugador_id`
  - `INSCRIPCION (liga, equipo)`
  - `JORNADA (liga, numero)`
  - `PARTICIPACION (partido, plantilla)`
  - dorsal por inscripción; si solo cuentan las fichas activas, hace falta un handler

## 3. Preparar el proyecto

```bash
git init
cds add nodejs
cds add sqlite,lint
npm install
cds watch
```

## 4. Crear el modelo en `db/schema.cds`

Empezar por las entidades sin dependencias y seguir este orden:

1. `Equipos`, `Jugadores`, `Ligas`, `Sedes`, `Usuarios`
2. `AdminsEquipo`, `Inscripciones`, `Plantillas`, `Jornadas`
3. `Partidos`, `Participaciones`, `Goles`, `Amonestaciones`, `Sanciones`

```cds
@assert.unique: { jugadorLiga: [jugador, liga] }
entity Plantillas : cuid {
  jugador     : Association to Jugadores not null;
  inscripcion : Association to Inscripciones not null;
  liga        : Association to Ligas not null;
  dorsal      : Integer;
  fecha_alta  : Date;
  fecha_baja  : Date;
}
```

Usar `Composition` de partido a participaciones, y de participación a goles y amonestaciones, para que se borren en cascada.

Con el modelo creado, añadir los tests. Si se ejecuta antes, `cds add test` se omite con el mensaje `skipping, no model found`:

```bash
cds add test
npm install
```

## 5. Cargar datos de prueba

Ejecutar `cds add data` cuando el modelo esté listo y rellenar los CSV en `db/data/`. Incluir las 5 ligas, unos 6 equipos por liga, jugadores y sedes. Añadir un jugador que esté en dos ligas distintas para probar la regla principal.

## 6. Definir los servicios en `srv/`

Separarlos por rol simplifica los permisos:

| Servicio | Rol | Puede hacer |
|---|---|---|
| `AdminService` | `admin` | Todo |
| `EquipoService` | `admin_equipo` | Gestionar jugadores y plantilla **solo de sus equipos**, sin registrar actas |
| `ConsultaService` | `jugador` | Solo lectura de equipos, partidos, clasificación y goleadores |

- **Permisos:** usar `@restrict` con condiciones `where` para limitar al admin de equipo a sus equipos. Comprobar también las altas en un handler.
- **Datos personales:** no exponer `documento_identidad` ni `fecha_nacimiento` en `ConsultaService`.
- **Altas de jugadores:** buscar primero por `documento_identidad`. Si el jugador ya existe, crear solo la ficha en `Plantillas` para no duplicarlo.

## 7. Programar las reglas de negocio

Empezar por la más importante:

1. **Regla de liga:** un jugador solo puede tener una ficha por liga, aunque se haya dado de baja, y `plantilla.liga` debe coincidir con `inscripcion.liga`.
2. **Partidos:** local y visitante deben ser distintos y pertenecer a la liga de la jornada. Tampoco debe haber dos partidos a la vez en la misma sede.
3. **Participaciones:** el jugador debe estar en la plantilla de uno de los dos equipos y no tener una sanción vigente en la liga del partido.
4. **Goles y amonestaciones:** el minuto debe ser válido.

## 8. Añadir las funcionalidades

1. **Partidos y actas:** creación y modificación de partidos, participantes, goleadores y amonestados.
2. **Sanciones:** alta manual indicando la liga y comprobación de si siguen vigentes en ella. Una sanción sigue vigente mientras el equipo del jugador no haya finalizado en esa liga, desde `fecha_inicio`, tantos partidos como indica `partidos_suspension`. Los partidos aplazados o cancelados no cuentan.
3. **Generador de jornadas:** una acción `generarCalendario(fechaInicio, idaYVuelta)` sobre `Ligas`:
   - Barajar los equipos al azar y aplicar el algoritmo de **todos contra todos**, con N-1 jornadas si N es par.
   - Si N es impar, añadir un descanso por jornada.
   - Calcular las fechas según la franja y guardarlo todo en una transacción.
   - Bloquear la regeneración si ya hay partidos jugados.
4. **Consultas:** vistas de clasificación y máximos goleadores. La clasificación no la pide el enunciado, pero sale casi directa de los datos.

## 9. Crear la interfaz en `app/`

Lo más rápido en CAP es **Fiori elements** con anotaciones `@UI`, ya que evita programar cada pantalla. Vistas necesarias:

- **Directorios:** equipos y jugadores.
- **Ligas:** jornadas de cada liga y botón para generar el calendario.
- **Partidos:** ficha del partido con su acta.
- **Consultas:** clasificación y goleadores.

## 10. Probar y entregar

- **Tests:** cubrir al menos estos casos:
  - rechazo de un jugador en dos equipos de la misma liga, también tras una baja
  - sanción que impide jugar en su liga, pero no en otra
  - sanción que se cumple al finalizar los partidos indicados, sin descontar los aplazados ni los cancelados
  - permisos de cada rol, incluido un admin de equipo intentando tocar otro equipo o registrar un acta
  - generador con número par e impar de equipos, sin repetir cruces
  - gol en propia meta
- **Entrega:** actualizar el `readme.md` con la instalación y los usuarios de prueba.
- **Despliegue (opcional):** añadir `hana` o `postgres`, la autenticación que se decida y `mta`.

## Alcance mínimo

Los pasos 1 a 7 y las actas del paso 8 forman el mínimo que cubre lo obligatorio. Lo demás, incluidos el generador y las sanciones, aparece en el enunciado como funcionalidad posible.
