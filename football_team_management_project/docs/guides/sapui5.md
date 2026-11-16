# Guía de la interfaz con SAPUI5

Pasos para crear la interfaz gráfica de la aplicación con **SAPUI5 freestyle**: vistas XML y controladores JavaScript escritos a mano, conectados a los servicios OData V4 de CAP. Desarrolla el paso 9 de la [guía de desarrollo](project_development.md).

Hay una app por rol, cada una contra su servicio:

| App | Rol | Servicio | Pantallas |
|---|---|---|---|
| `app/admin` | `admin` | `AdminService` | Ligas → calendario de la liga → acta del partido |
| `app/equipo` | `admin_equipo` | `EquipoService` | Plantilla de sus equipos, con alta y baja de jugadores |
| `app/consulta` | `jugador` (y cualquier usuario autenticado) | `ConsultaService` | Clasificación, goleadores y calendario de una liga |

**Cómo se ha comprobado:** el código se validó con el linter oficial (`@ui5/linter`), sin avisos, y todas las peticiones OData que generan las pantallas se ejecutaron contra el servidor con los datos de prueba. No se ha abierto en un navegador real, así que conviene seguir el apartado 9 al probarlo.

## 1. Conceptos

| Concepto | Qué es |
|---|---|
| **Component** | Punto de entrada de la app. Lee `manifest.json` y crea la vista raíz y el router. |
| **`manifest.json`** | Configuración: servicio OData, modelos, librerías, vista raíz y rutas. |
| **Vista XML** | Define los controles (`Table`, `Button`, `Dialog`…) y sus *bindings*. |
| **Controlador** | Código JavaScript de la vista: eventos, navegación y llamadas a actions. |
| **Modelo OData V4** | Conecta las vistas con el servicio. Con `autoExpandSelect` calcula solo los `$select` y `$expand` que necesitan los bindings. |
| **Binding absoluto** | Empieza por `/`, por ejemplo `{/Ligas}`. Lee una colección del servicio. |
| **Binding relativo** | Sin `/`, por ejemplo `{nombre}` o `{participaciones}`. Se resuelve contra el contexto del control padre. |
| **Element binding** | `bindElement("/Partidos(ID)")` da a una vista o control el contexto de una entidad, del que cuelgan los bindings relativos. |
| **Operation binding** | Llama a una action o function: `bindContext("AdminService.finalizar(...)", oContexto)`, después `setParameter` e `invoke()`. Los tres puntos indican que se ejecuta bajo demanda. |
| **JSONModel** | Modelo local en memoria. Aquí guarda los resultados de las functions que devuelven listas. |

### Cómo se llaman las actions y functions

Siempre con el mismo patrón:

```js
const oOperacion = oModelo.bindContext("AdminService.registrarGol(...)", oContextoDelPartido);
oOperacion.setParameter("plantilla", sFicha);
oOperacion.setParameter("minuto", 23);
await oOperacion.invoke();                    // POST .../Partidos(ID)/AdminService.registrarGol
const oResultado = oOperacion.getBoundContext();
```

- **Enlazadas a una entidad:** se pasa el contexto de esa entidad y el nombre lleva el del servicio: `AdminService.generarCalendario(...)`.
- **Sin entidad:** la ruta es absoluta y sin servicio: `/clasificacion(...)`.
- **Resultado primitivo** (por ejemplo, el número de partidos generados): `getProperty("value")`.
- **Errores:** si CAP responde con `req.reject`, `invoke()` lanza un error cuyo `message` es el texto del servidor, por ejemplo "El jugador tiene una sanción vigente en esta liga".

`invoke()` sustituye a `execute()`, que está obsoleto desde SAPUI5 1.123.

## 2. Estructura de ficheros

```
app/
├── admin/webapp/
│   ├── index.html
│   ├── Component.js
│   ├── manifest.json
│   ├── controller/
│   │   ├── BaseController.js
│   │   ├── Ligas.controller.js
│   │   ├── Liga.controller.js
│   │   └── Partido.controller.js
│   └── view/
│       ├── App.view.xml
│       ├── Ligas.view.xml
│       ├── Liga.view.xml
│       └── Partido.view.xml
├── equipo/webapp/
│   ├── index.html
│   ├── Component.js
│   ├── manifest.json
│   ├── controller/Plantilla.controller.js
│   └── view/Plantilla.view.xml
└── consulta/webapp/
    ├── index.html
    ├── Component.js
    ├── manifest.json
    ├── controller/Liga.controller.js
    └── view/Liga.view.xml
```

`cds watch` sirve la carpeta `app/` sin configuración extra, en la misma dirección que los servicios. Así no hay problemas de CORS y el login es el mismo.

No hace falta `npm install` ni herramientas de compilación: SAPUI5 se carga desde el CDN de SAP.

> **Alternativa con asistente:** en BAS, *View → Command Palette → Fiori: Open Application Generator → Basic* genera un esqueleto parecido con `ui5.yaml` y scripts de npm. Esta guía lo hace a mano para que se vea qué hace cada fichero.

## 3. Preparar los servicios

Las pantallas necesitan nombres (equipos, ligas, jugadores) donde los servicios solo devuelven IDs. Hay tres cambios pequeños.

### 3.1 `srv/equipo-service.cds`: nombres en las inscripciones

`EquipoService` no expone `Equipos` ni `Ligas`, así que el desplegable del delegado solo vería IDs. Se añaden campos calculados a la proyección:

```cds
  entity Inscripciones as projection on db.Inscripciones {
    *,
    equipo.nombre  as equipoNombre,
    liga.nombre    as ligaNombre,
    liga.temporada as temporada
  } actions {
```

El resto de la entidad, incluidos `@restrict` y `altaJugador`, no cambia.

### 3.2 `srv/consulta-service.cds`: nombres en los partidos

`ConsultaService` no expone las inscripciones, así que tampoco se llegaría al nombre de los equipos:

```cds
  @readonly entity Partidos as projection on db.Partidos {
    *,
    jornada.numero          as jornadaNumero,
    local.equipo.nombre     as localNombre,
    visitante.equipo.nombre as visitanteNombre,
    sede.nombre             as sedeNombre
  } excluding { participaciones } actions {
    function marcador() returns Marcador;
  };
```

### 3.3 `srv/admin-service.js`: nombres en los jugadores disponibles

`jugadoresDisponibles` devuelve fichas sin el nombre del jugador, y CAP ignora el `$expand` en las functions programadas a mano. En el handler se cambia la consulta de fichas para que traiga el jugador y su equipo:

```js
      const fichas = await SELECT.from(Plantillas, f => {
        f`*`, f.jugador(j => { j.nombre, j.apellidos }), f.inscripcion(i => { i.ID, i.equipo(e => { e.nombre }) })
      }).where({ inscripcion_ID: { in: [partido.local_ID, partido.visitante_ID] } }).orderBy('dorsal')
```

El filtro de bajas y sanciones que va a continuación no cambia.

## 4. Ficheros comunes

Las tres apps comparten la misma estructura. Estos son los ficheros de `admin`. En las otras dos solo cambian el nombre (`football.equipo`, `football.consulta`), el título, el servicio y la vista raíz.

### 4.1 `index.html`

Carga SAPUI5 y arranca el Component:

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Administración de la liga</title>
  <script id="sap-ui-bootstrap"
    src="https://ui5.sap.com/1.148.13/resources/sap-ui-core.js"
    data-sap-ui-theme="sap_horizon"
    data-sap-ui-language="es"
    data-sap-ui-async="true"
    data-sap-ui-compat-version="edge"
    data-sap-ui-resource-roots='{ "football.admin": "./" }'
    data-sap-ui-on-init="module:sap/ui/core/ComponentSupport">
  </script>
</head>
<body class="sapUiBody">
  <div data-sap-ui-component data-name="football.admin" data-id="container" data-height="100%"></div>
</body>
</html>
```

- **`src`:** versión fija 1.148.13, la LTS (mantenimiento largo) actual. Se puede consultar en [ui5.sap.com/versionoverview.html](https://ui5.sap.com/versionoverview.html).
- **`data-sap-ui-resource-roots`:** indica que el espacio de nombres `football.admin` está en la carpeta actual.
- **`data-sap-ui-on-init`:** `ComponentSupport` busca el `div` con `data-sap-ui-component` y crea ahí el Component `football.admin`.

### 4.2 `Component.js`

```js
sap.ui.define([
  "sap/ui/core/UIComponent"
], (UIComponent) => {
  "use strict";

  return UIComponent.extend("football.admin.Component", {
    metadata: {
      manifest: "json",
      interfaces: ["sap.ui.core.IAsyncContentCreation"]
    },

    init() {
      UIComponent.prototype.init.apply(this, arguments);
      this.getRouter().initialize();
    }
  });
});
```

En `equipo` y `consulta` no hay rutas, así que se omite el método `init`:

```js
sap.ui.define([
  "sap/ui/core/UIComponent"
], (UIComponent) => {
  "use strict";

  return UIComponent.extend("football.equipo.Component", {
    metadata: {
      manifest: "json",
      interfaces: ["sap.ui.core.IAsyncContentCreation"]
    }
  });
});
```

### 4.3 `manifest.json`

```json
{
  "_version": "2.0.0",
  "sap.app": {
    "id": "football.admin",
    "type": "application",
    "title": "Administración de la liga",
    "applicationVersion": { "version": "1.0.0" },
    "dataSources": {
      "mainService": {
        "uri": "/odata/v4/admin/",
        "type": "OData",
        "settings": { "odataVersion": "4.0" }
      }
    }
  },
  "sap.ui": {
    "technology": "UI5",
    "deviceTypes": { "desktop": true, "tablet": true, "phone": true }
  },
  "sap.ui5": {
    "dependencies": {
      "minUI5Version": "1.148.0",
      "libs": { "sap.m": {}, "sap.ui.core": {}, "sap.ui.layout": {} }
    },
    "models": {
      "": {
        "dataSource": "mainService",
        "preload": true,
        "settings": { "autoExpandSelect": true, "operationMode": "Server" }
      }
    },
    "rootView": {
      "viewName": "football.admin.view.App",
      "type": "XML",
      "id": "appView"
    },
    "routing": {
      "config": {
        "routerClass": "sap.m.routing.Router",
        "type": "View",
        "viewType": "XML",
        "path": "football.admin.view",
        "controlId": "app",
        "controlAggregation": "pages"
      },
      "routes": [
        { "pattern": "", "name": "ligas", "target": "ligas" },
        { "pattern": "ligas/{id}", "name": "liga", "target": "liga" },
        { "pattern": "partidos/{id}", "name": "partido", "target": "partido" }
      ],
      "targets": {
        "ligas": { "id": "ligas", "name": "Ligas" },
        "liga": { "id": "liga", "name": "Liga" },
        "partido": { "id": "partido", "name": "Partido" }
      }
    }
  }
}
```

- **`dataSources`:** la URL del servicio. Para `equipo` es `/odata/v4/equipo/` y para `consulta`, `/odata/v4/consulta/`.
- **`models`:** el modelo sin nombre (`""`) es el OData V4 que usan todas las vistas.
- **`routing`:** solo en `admin`. Cada ruta (`ligas/{id}`) carga una vista en el control `App` con id `app`.

En `equipo` y `consulta` se quita `routing` y la vista raíz es la pantalla única:

```json
    "rootView": {
      "viewName": "football.equipo.view.Plantilla",
      "type": "XML",
      "id": "plantilla"
    }
```

## 5. App del administrador

Tres pantallas con navegación: lista de ligas → partidos de la liga → acta del partido.

### 5.1 `view/App.view.xml`

Contenedor donde el router coloca cada pantalla:

```xml
<mvc:View
  xmlns:mvc="sap.ui.core.mvc"
  xmlns="sap.m"
  displayBlock="true">
  <App id="app"/>
</mvc:View>
```

### 5.2 `controller/BaseController.js`

Código compartido por las tres pantallas: router, botón de volver, cerrar diálogos y el método `ejecutar`, que llama a cualquier action o function y muestra el error del servidor:

```js
sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageBox",
  "sap/ui/core/routing/History"
], (Controller, MessageBox, History) => {
  "use strict";

  return Controller.extend("football.admin.controller.BaseController", {
    getRouter() {
      return this.getOwnerComponent().getRouter();
    },

    onVolver() {
      if (History.getInstance().getPreviousHash() !== undefined) {
        window.history.go(-1);
      } else {
        this.getRouter().navTo("ligas", {}, true);
      }
    },

    onCerrarDialogo(oEvent) {
      oEvent.getSource().getParent().close();
    },

    // Invoca una action o function enlazada a oContexto, p. ej. "AdminService.finalizar".
    // Devuelve el contexto con el resultado, o null si el servidor la rechaza.
    async ejecutar(sOperacion, oContexto, mParametros = {}) {
      const oOperacion = this.getView().getModel().bindContext(`${sOperacion}(...)`, oContexto);
      Object.entries(mParametros).forEach(([sNombre, vValor]) => oOperacion.setParameter(sNombre, vValor));
      try {
        await oOperacion.invoke();
        return oOperacion.getBoundContext();
      } catch (oError) {
        MessageBox.error(oError.message);
        return null;
      }
    }
  });
});
```

### 5.3 Lista de ligas

`view/Ligas.view.xml`:

```xml
<mvc:View
  controllerName="football.admin.controller.Ligas"
  xmlns:mvc="sap.ui.core.mvc"
  xmlns="sap.m">
  <Page title="Ligas">
    <Table items="{path: '/Ligas', sorter: {path: 'nombre'}}">
      <columns>
        <Column><Text text="Liga"/></Column>
        <Column><Text text="Temporada"/></Column>
        <Column><Text text="Franja"/></Column>
      </columns>
      <items>
        <ColumnListItem type="Navigation" press=".onAbrirLiga">
          <cells>
            <ObjectIdentifier title="{nombre}"/>
            <Text text="{temporada}"/>
            <Text text="{franja}"/>
          </cells>
        </ColumnListItem>
      </items>
    </Table>
  </Page>
</mvc:View>
```

`controller/Ligas.controller.js`:

```js
sap.ui.define([
  "./BaseController"
], (BaseController) => {
  "use strict";

  return BaseController.extend("football.admin.controller.Ligas", {
    onAbrirLiga(oEvent) {
      const sId = oEvent.getSource().getBindingContext().getProperty("ID");
      this.getRouter().navTo("liga", { id: sId });
    }
  });
});
```

### 5.4 Calendario de una liga

Muestra los partidos de la liga y el botón **Generar calendario**, que abre un diálogo con la fecha de inicio y si es a ida y vuelta.

`view/Liga.view.xml`:

```xml
<mvc:View
  controllerName="football.admin.controller.Liga"
  xmlns:mvc="sap.ui.core.mvc"
  xmlns="sap.m"
  xmlns:f="sap.ui.layout.form">
  <Page title="{nombre} ({temporada})" showNavButton="true" navButtonPress=".onVolver">
    <headerContent>
      <Button text="Generar calendario" type="Emphasized" press=".onAbrirGenerar"/>
    </headerContent>

    <Table id="partidos" growing="true" growingThreshold="50"
      noDataText="Sin partidos: genera el calendario"
      items="{path: '/Partidos', suspended: true,
              sorter: [{path: 'jornada/numero'}, {path: 'fecha_hora'}]}">
      <columns>
        <Column width="6rem"><Text text="Jornada"/></Column>
        <Column><Text text="Fecha y hora"/></Column>
        <Column><Text text="Local"/></Column>
        <Column><Text text="Visitante"/></Column>
        <Column minScreenWidth="Tablet" demandPopin="true"><Text text="Sede"/></Column>
        <Column><Text text="Estado"/></Column>
      </columns>
      <items>
        <ColumnListItem type="Navigation" press=".onAbrirPartido">
          <cells>
            <Text text="{jornada/numero}"/>
            <Text text="{fecha_hora}"/>
            <Text text="{local/equipo/nombre}"/>
            <Text text="{visitante/equipo/nombre}"/>
            <Text text="{sede/nombre}"/>
            <ObjectStatus text="{estado}"
              state="{= ${estado} === 'finalizado' ? 'Success' : ${estado} === 'aplazado' ? 'Warning' : 'None' }"/>
          </cells>
        </ColumnListItem>
      </items>
    </Table>

    <dependents>
      <Dialog id="dlgGenerar" title="Generar calendario">
        <f:SimpleForm editable="true" layout="ResponsiveGridLayout">
          <Label text="Fecha de inicio" required="true"/>
          <DatePicker id="fechaInicio" valueFormat="yyyy-MM-dd"/>
          <Label text="Ida y vuelta"/>
          <CheckBox id="idaYVuelta" selected="true"/>
        </f:SimpleForm>
        <beginButton>
          <Button text="Generar" type="Emphasized" press=".onGenerar"/>
        </beginButton>
        <endButton>
          <Button text="Cancelar" press=".onCerrarDialogo"/>
        </endButton>
      </Dialog>
    </dependents>
  </Page>
</mvc:View>
```

- **`suspended: true`:** la tabla no pide datos hasta que el controlador le pone el filtro de la liga y llama a `resume()`.
- **`{local/equipo/nombre}`:** con `autoExpandSelect`, el modelo genera solo el `$expand` necesario.
- **`{fecha_hora}`:** el modelo aplica el tipo del servicio y muestra la fecha en la zona horaria del navegador, no en UTC.

`controller/Liga.controller.js`:

```js
sap.ui.define([
  "./BaseController",
  "sap/m/MessageBox",
  "sap/m/MessageToast",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator"
], (BaseController, MessageBox, MessageToast, Filter, FilterOperator) => {
  "use strict";

  return BaseController.extend("football.admin.controller.Liga", {
    onInit() {
      this.getRouter().getRoute("liga").attachPatternMatched(this._onRuta, this);
    },

    _onRuta(oEvent) {
      const sId = oEvent.getParameter("arguments").id;
      this.getView().bindElement({ path: `/Ligas(${sId})` });

      // Solo los partidos de esta liga
      const oPartidos = this.byId("partidos").getBinding("items");
      oPartidos.filter(new Filter("jornada/liga_ID", FilterOperator.EQ, sId));
      if (oPartidos.isSuspended()) {
        oPartidos.resume();
      }
    },

    onAbrirPartido(oEvent) {
      const sId = oEvent.getSource().getBindingContext().getProperty("ID");
      this.getRouter().navTo("partido", { id: sId });
    },

    onAbrirGenerar() {
      this.byId("dlgGenerar").open();
    },

    async onGenerar() {
      const sFecha = this.byId("fechaInicio").getValue();
      if (!sFecha) {
        MessageBox.warning("Indica la fecha de inicio");
        return;
      }
      this.byId("dlgGenerar").close();

      const oResultado = await this.ejecutar("AdminService.generarCalendario",
        this.getView().getBindingContext(),
        { fechaInicio: sFecha, idaYVuelta: this.byId("idaYVuelta").getSelected() });
      if (oResultado) {
        MessageToast.show(`Calendario generado: ${oResultado.getProperty("value")} partidos`);
        this.byId("partidos").getBinding("items").refresh();
      }
    }
  });
});
```

### 5.5 Acta del partido

Cabecera con los equipos, la fecha y la sede, y tres tablas: jugadores, goles y tarjetas. Los botones abren diálogos que llaman a `registrarParticipacion`, `registrarGol` y `registrarAmonestacion`. **Aplazar** y **Finalizar** llaman a `aplazar` y `finalizar`.

`view/Partido.view.xml`:

```xml
<mvc:View
  controllerName="football.admin.controller.Partido"
  xmlns:mvc="sap.ui.core.mvc"
  xmlns="sap.m"
  xmlns:core="sap.ui.core"
  xmlns:f="sap.ui.layout.form">
  <Page title="Acta del partido" showNavButton="true" navButtonPress=".onVolver">
    <headerContent>
      <Button text="Aplazar" press=".onAplazar"
        enabled="{= ${estado} === 'programado' }"/>
      <Button text="Finalizar" type="Emphasized" press=".onFinalizar"
        enabled="{= ${estado} === 'programado' || ${estado} === 'en_juego' }"/>
    </headerContent>

    <ObjectHeader title="{local/equipo/nombre} - {visitante/equipo/nombre}">
      <statuses>
        <ObjectStatus text="{estado}"/>
      </statuses>
      <attributes>
        <ObjectAttribute title="Jornada" text="{jornada/numero}"/>
        <ObjectAttribute title="Fecha" text="{fecha_hora}"/>
        <ObjectAttribute title="Sede" text="{sede/nombre}"/>
      </attributes>
    </ObjectHeader>

    <!-- Jugadores que han participado -->
    <Table id="participaciones" items="{path: 'participaciones', sorter: {path: 'plantilla/dorsal'}}">
      <headerToolbar>
        <OverflowToolbar>
          <Title text="Jugadores"/>
          <ToolbarSpacer/>
          <Button text="Añadir jugador" icon="sap-icon://add" press=".onAbrirParticipacion"
            enabled="{= ${estado} === 'programado' || ${estado} === 'en_juego' }"/>
          <Button text="Gol" press=".onAbrirGol"
            enabled="{= ${estado} === 'programado' || ${estado} === 'en_juego' }"/>
          <Button text="Tarjeta" press=".onAbrirTarjeta"
            enabled="{= ${estado} === 'programado' || ${estado} === 'en_juego' }"/>
        </OverflowToolbar>
      </headerToolbar>
      <columns>
        <Column><Text text="Equipo"/></Column>
        <Column width="5rem"><Text text="Dorsal"/></Column>
        <Column><Text text="Jugador"/></Column>
        <Column width="6rem"><Text text="Titular"/></Column>
        <Column width="6rem"><Text text="Minutos"/></Column>
      </columns>
      <items>
        <ColumnListItem>
          <cells>
            <Text text="{plantilla/inscripcion/equipo/nombre}"/>
            <Text text="{plantilla/dorsal}"/>
            <Text text="{plantilla/jugador/nombre} {plantilla/jugador/apellidos}"/>
            <Text text="{= ${titular} ? 'Sí' : 'No' }"/>
            <Text text="{minutos_jugados}"/>
          </cells>
        </ColumnListItem>
      </items>
    </Table>

    <!-- Goleadores -->
    <Table id="goles" headerText="Goles"
      items="{path: '/Goles', suspended: true, sorter: {path: 'minuto'}}">
      <columns>
        <Column width="6rem"><Text text="Minuto"/></Column>
        <Column><Text text="Jugador"/></Column>
        <Column><Text text="Equipo"/></Column>
        <Column><Text text="Tipo"/></Column>
      </columns>
      <items>
        <ColumnListItem>
          <cells>
            <Text text="{minuto}'"/>
            <Text text="{participacion/plantilla/jugador/nombre} {participacion/plantilla/jugador/apellidos}"/>
            <Text text="{participacion/plantilla/inscripcion/equipo/nombre}"/>
            <Text text="{tipo}"/>
          </cells>
        </ColumnListItem>
      </items>
    </Table>

    <!-- Amonestados -->
    <Table id="amonestaciones" headerText="Tarjetas"
      items="{path: '/Amonestaciones', suspended: true, sorter: {path: 'minuto'}}">
      <columns>
        <Column width="6rem"><Text text="Minuto"/></Column>
        <Column><Text text="Jugador"/></Column>
        <Column><Text text="Equipo"/></Column>
        <Column><Text text="Tarjeta"/></Column>
      </columns>
      <items>
        <ColumnListItem>
          <cells>
            <Text text="{minuto}'"/>
            <Text text="{participacion/plantilla/jugador/nombre} {participacion/plantilla/jugador/apellidos}"/>
            <Text text="{participacion/plantilla/inscripcion/equipo/nombre}"/>
            <ObjectStatus text="{tipo}" state="{= ${tipo} === 'roja' ? 'Error' : 'Warning' }"/>
          </cells>
        </ColumnListItem>
      </items>
    </Table>

    <dependents>
      <!-- Añadir un jugador al acta: solo se ofrecen los disponibles -->
      <Dialog id="dlgParticipacion" title="Añadir jugador al acta">
        <f:SimpleForm editable="true" layout="ResponsiveGridLayout">
          <Label text="Jugador" required="true"/>
          <Select id="selDisponible" width="100%" items="{disponibles>/}">
            <core:Item key="{disponibles>ID}"
              text="{disponibles>inscripcion/equipo/nombre} · {disponibles>dorsal} · {disponibles>jugador/nombre} {disponibles>jugador/apellidos}"/>
          </Select>
          <Label text="Titular"/>
          <CheckBox id="chkTitular" selected="true"/>
          <Label text="Minutos jugados"/>
          <StepInput id="minutosJugados" min="0" max="130" value="90"/>
        </f:SimpleForm>
        <beginButton>
          <Button text="Añadir" type="Emphasized" press=".onRegistrarParticipacion"/>
        </beginButton>
        <endButton>
          <Button text="Cancelar" press=".onCerrarDialogo"/>
        </endButton>
      </Dialog>

      <!-- Gol: solo jugadores que ya están en el acta -->
      <Dialog id="dlgGol" title="Registrar gol">
        <f:SimpleForm editable="true" layout="ResponsiveGridLayout">
          <Label text="Jugador" required="true"/>
          <Select id="selGoleador" width="100%" items="{path: 'participaciones', templateShareable: false}">
            <core:Item key="{plantilla_ID}"
              text="{plantilla/inscripcion/equipo/nombre} · {plantilla/dorsal} · {plantilla/jugador/nombre} {plantilla/jugador/apellidos}"/>
          </Select>
          <Label text="Minuto"/>
          <StepInput id="minutoGol" min="0" max="130" value="1"/>
          <Label text="Tipo"/>
          <Select id="selTipoGol">
            <core:Item key="normal" text="Normal"/>
            <core:Item key="penalti" text="Penalti"/>
            <core:Item key="propia_meta" text="En propia meta"/>
          </Select>
        </f:SimpleForm>
        <beginButton>
          <Button text="Registrar" type="Emphasized" press=".onRegistrarGol"/>
        </beginButton>
        <endButton>
          <Button text="Cancelar" press=".onCerrarDialogo"/>
        </endButton>
      </Dialog>

      <!-- Tarjeta: solo jugadores que ya están en el acta -->
      <Dialog id="dlgTarjeta" title="Registrar tarjeta">
        <f:SimpleForm editable="true" layout="ResponsiveGridLayout">
          <Label text="Jugador" required="true"/>
          <Select id="selAmonestado" width="100%" items="{path: 'participaciones', templateShareable: false}">
            <core:Item key="{plantilla_ID}"
              text="{plantilla/inscripcion/equipo/nombre} · {plantilla/dorsal} · {plantilla/jugador/nombre} {plantilla/jugador/apellidos}"/>
          </Select>
          <Label text="Minuto"/>
          <StepInput id="minutoTarjeta" min="0" max="130" value="1"/>
          <Label text="Tarjeta"/>
          <Select id="selTipoTarjeta">
            <core:Item key="amarilla" text="Amarilla"/>
            <core:Item key="roja" text="Roja"/>
          </Select>
        </f:SimpleForm>
        <beginButton>
          <Button text="Registrar" type="Emphasized" press=".onRegistrarTarjeta"/>
        </beginButton>
        <endButton>
          <Button text="Cancelar" press=".onCerrarDialogo"/>
        </endButton>
      </Dialog>
    </dependents>
  </Page>
</mvc:View>
```

- **Botones desactivados:** las expresiones `{= ${estado} === 'programado' || ... }` reproducen en pantalla las reglas del servidor. El acta solo se edita con el partido `programado` o `en_juego`. El servidor lo comprueba igualmente.
- **Desplegable de "Añadir jugador":** usa el modelo `disponibles`, que se llena con `jugadoresDisponibles`. No aparecen los sancionados ni los dados de baja.
- **Desplegables de gol y tarjeta:** usan `{participaciones}`, así que solo ofrecen jugadores que ya están en el acta.

`controller/Partido.controller.js`:

```js
sap.ui.define([
  "./BaseController",
  "sap/m/MessageBox",
  "sap/m/MessageToast",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/ui/model/json/JSONModel"
], (BaseController, MessageBox, MessageToast, Filter, FilterOperator, JSONModel) => {
  "use strict";

  return BaseController.extend("football.admin.controller.Partido", {
    onInit() {
      // Modelo local para la lista de jugadores disponibles
      this.getView().setModel(new JSONModel([]), "disponibles");
      this.getRouter().getRoute("partido").attachPatternMatched(this._onRuta, this);
    },

    _onRuta(oEvent) {
      const sId = oEvent.getParameter("arguments").id;
      this.getView().bindElement({ path: `/Partidos(${sId})` });

      // Goles y tarjetas cuelgan de las participaciones: se filtran por partido
      const oFiltro = new Filter("participacion/partido_ID", FilterOperator.EQ, sId);
      ["goles", "amonestaciones"].forEach((sTabla) => {
        const oBinding = this.byId(sTabla).getBinding("items");
        oBinding.filter(oFiltro);
        if (oBinding.isSuspended()) {
          oBinding.resume();
        }
      });
    },

    // Vuelve a leer el partido, el acta, los goles y las tarjetas
    _refrescar() {
      this.getView().getElementBinding().refresh();
      this.byId("goles").getBinding("items").refresh();
      this.byId("amonestaciones").getBinding("items").refresh();
    },

    async _accionSobrePartido(sAccion, mParametros, sMensaje) {
      const oResultado = await this.ejecutar(`AdminService.${sAccion}`,
        this.getView().getBindingContext(), mParametros);
      if (oResultado) {
        MessageToast.show(sMensaje);
        this._refrescar();
      }
    },

    // ---------- Jugadores ----------
    async onAbrirParticipacion() {
      const oResultado = await this.ejecutar("AdminService.jugadoresDisponibles",
        this.getView().getBindingContext());
      if (!oResultado) {
        return;
      }
      const oDatos = await oResultado.requestObject();
      const aFichas = Array.isArray(oDatos) ? oDatos : (oDatos?.value ?? []);
      this.getView().getModel("disponibles").setData(aFichas);
      this.byId("dlgParticipacion").open();
    },

    async onRegistrarParticipacion() {
      const sFicha = this.byId("selDisponible").getSelectedKey();
      if (!sFicha) {
        MessageBox.warning("No hay jugadores disponibles");
        return;
      }
      this.byId("dlgParticipacion").close();
      await this._accionSobrePartido("registrarParticipacion", {
        plantilla: sFicha,
        titular: this.byId("chkTitular").getSelected(),
        minutos: this.byId("minutosJugados").getValue()
      }, "Jugador añadido al acta");
    },

    // ---------- Goles ----------
    onAbrirGol() {
      this.byId("dlgGol").open();
    },

    async onRegistrarGol() {
      const sFicha = this.byId("selGoleador").getSelectedKey();
      if (!sFicha) {
        MessageBox.warning("Primero añade jugadores al acta");
        return;
      }
      this.byId("dlgGol").close();
      await this._accionSobrePartido("registrarGol", {
        plantilla: sFicha,
        minuto: this.byId("minutoGol").getValue(),
        tipo: this.byId("selTipoGol").getSelectedKey()
      }, "Gol registrado");
    },

    // ---------- Tarjetas ----------
    onAbrirTarjeta() {
      this.byId("dlgTarjeta").open();
    },

    async onRegistrarTarjeta() {
      const sFicha = this.byId("selAmonestado").getSelectedKey();
      if (!sFicha) {
        MessageBox.warning("Primero añade jugadores al acta");
        return;
      }
      this.byId("dlgTarjeta").close();
      await this._accionSobrePartido("registrarAmonestacion", {
        plantilla: sFicha,
        minuto: this.byId("minutoTarjeta").getValue(),
        tipo: this.byId("selTipoTarjeta").getSelectedKey()
      }, "Tarjeta registrada");
    },

    // ---------- Estado del partido ----------
    onAplazar() {
      MessageBox.confirm("¿Aplazar el partido?", {
        onClose: (sAccion) => {
          if (sAccion === MessageBox.Action.OK) {
            this._accionSobrePartido("aplazar", {}, "Partido aplazado");
          }
        }
      });
    },

    onFinalizar() {
      MessageBox.confirm("Al finalizar se cierra el acta y las rojas generan sanción. ¿Continuar?", {
        onClose: (sAccion) => {
          if (sAccion === MessageBox.Action.OK) {
            this._accionSobrePartido("finalizar", {}, "Partido finalizado");
          }
        }
      });
    }
  });
});
```

Después de cada action, `_refrescar` vuelve a leer el partido y las tablas para mostrar el estado actualizado.

## 6. App del administrador de equipo

Una sola pantalla: el delegado elige uno de sus equipos en el desplegable y ve su plantilla. `@restrict` hace que `/Inscripciones` devuelva solo sus inscripciones, sin filtrar nada en la interfaz.

`view/Plantilla.view.xml`:

```xml
<mvc:View
  controllerName="football.equipo.controller.Plantilla"
  xmlns:mvc="sap.ui.core.mvc"
  xmlns="sap.m"
  xmlns:core="sap.ui.core"
  xmlns:f="sap.ui.layout.form"
  displayBlock="true">
  <App>
    <Page title="Mi equipo">
      <subHeader>
        <Toolbar>
          <Label text="Equipo y liga:" labelFor="selInscripcion"/>
          <Select id="selInscripcion" forceSelection="false" width="24rem" change=".onCambiarInscripcion"
            items="{path: '/Inscripciones', sorter: [{path: 'ligaNombre'}, {path: 'equipoNombre'}]}">
            <core:Item key="{ID}" text="{equipoNombre} · {ligaNombre} {temporada}"/>
          </Select>
        </Toolbar>
      </subHeader>

      <!-- Su contexto es la inscripción elegida en el desplegable -->
      <Table id="plantilla" noDataText="Elige un equipo"
        items="{path: 'plantilla', sorter: {path: 'dorsal'}}">
        <headerToolbar>
          <OverflowToolbar>
            <Title text="Plantilla"/>
            <ToolbarSpacer/>
            <Button text="Alta de jugador" icon="sap-icon://add-employee" press=".onAbrirAlta"
              enabled="{= !!${ID} }"/>
          </OverflowToolbar>
        </headerToolbar>
        <columns>
          <Column width="5rem"><Text text="Dorsal"/></Column>
          <Column><Text text="Nombre"/></Column>
          <Column><Text text="Apellidos"/></Column>
          <Column minScreenWidth="Tablet" demandPopin="true"><Text text="Alta"/></Column>
          <Column><Text text="Estado"/></Column>
          <Column hAlign="End"><Text text=""/></Column>
        </columns>
        <items>
          <ColumnListItem>
            <cells>
              <Text text="{dorsal}"/>
              <Text text="{jugador/nombre}"/>
              <Text text="{jugador/apellidos}"/>
              <Text text="{fecha_alta}"/>
              <ObjectStatus text="{= ${fecha_baja} ? 'Baja' : 'Activo' }"
                state="{= ${fecha_baja} ? 'Error' : 'Success' }"/>
              <Button text="Dar de baja" type="Transparent" press=".onDarDeBaja"
                visible="{= !${fecha_baja} }"/>
            </cells>
          </ColumnListItem>
        </items>
      </Table>

      <dependents>
        <Dialog id="dlgAlta" title="Alta de jugador">
          <f:SimpleForm editable="true" layout="ResponsiveGridLayout">
            <Label text="Documento de identidad" required="true"/>
            <Input id="documento"/>
            <Label text="Nombre" required="true"/>
            <Input id="nombre"/>
            <Label text="Apellidos" required="true"/>
            <Input id="apellidos"/>
            <Label text="Fecha de nacimiento"/>
            <DatePicker id="fechaNacimiento" valueFormat="yyyy-MM-dd"/>
            <Label text="Dorsal"/>
            <StepInput id="dorsal" min="1" max="99" value="1"/>
          </f:SimpleForm>
          <beginButton>
            <Button text="Dar de alta" type="Emphasized" press=".onAlta"/>
          </beginButton>
          <endButton>
            <Button text="Cancelar" press=".onCerrarAlta"/>
          </endButton>
        </Dialog>
      </dependents>
    </Page>
  </App>
</mvc:View>
```

`controller/Plantilla.controller.js`:

```js
sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageBox",
  "sap/m/MessageToast"
], (Controller, MessageBox, MessageToast) => {
  "use strict";

  return Controller.extend("football.equipo.controller.Plantilla", {
    // Al elegir una inscripción, la tabla y el diálogo pasan a usarla como contexto
    onCambiarInscripcion(oEvent) {
      const sId = oEvent.getParameter("selectedItem").getKey();
      this.byId("plantilla").bindElement({ path: `/Inscripciones(${sId})` });
    },

    async _ejecutar(sOperacion, oContexto, mParametros) {
      const oOperacion = this.getView().getModel().bindContext(`${sOperacion}(...)`, oContexto);
      Object.entries(mParametros).forEach(([sNombre, vValor]) => oOperacion.setParameter(sNombre, vValor));
      try {
        await oOperacion.invoke();
        return true;
      } catch (oError) {
        MessageBox.error(oError.message);
        return false;
      }
    },

    onAbrirAlta() {
      ["documento", "nombre", "apellidos", "fechaNacimiento"].forEach((sId) => this.byId(sId).setValue(""));
      this.byId("dlgAlta").open();
    },

    onCerrarAlta() {
      this.byId("dlgAlta").close();
    },

    async onAlta() {
      const mDatos = {
        documento_identidad: this.byId("documento").getValue().trim(),
        nombre: this.byId("nombre").getValue().trim(),
        apellidos: this.byId("apellidos").getValue().trim(),
        fecha_nacimiento: this.byId("fechaNacimiento").getValue() || null,
        dorsal: this.byId("dorsal").getValue()
      };
      if (!mDatos.documento_identidad || !mDatos.nombre || !mDatos.apellidos) {
        MessageBox.warning("Documento, nombre y apellidos son obligatorios");
        return;
      }
      this.byId("dlgAlta").close();

      const oTabla = this.byId("plantilla");
      if (await this._ejecutar("EquipoService.altaJugador", oTabla.getBindingContext(), mDatos)) {
        MessageToast.show("Jugador dado de alta");
        oTabla.getBinding("items").refresh();
      }
    },

    onDarDeBaja(oEvent) {
      const oFicha = oEvent.getSource().getBindingContext();
      const sNombre = `${oFicha.getProperty("jugador/nombre")} ${oFicha.getProperty("jugador/apellidos")}`;
      MessageBox.confirm(`¿Dar de baja a ${sNombre}? No podrá volver a jugar en esta liga.`, {
        onClose: async (sAccion) => {
          if (sAccion !== MessageBox.Action.OK) {
            return;
          }
          if (await this._ejecutar("EquipoService.darDeBaja", oFicha, {})) {
            MessageToast.show("Jugador dado de baja");
            this.byId("plantilla").getBinding("items").refresh();
          }
        }
      });
    }
  });
});
```

- **Contexto de la tabla:** al elegir una inscripción, `bindElement` le da a la tabla el contexto `/Inscripciones(ID)`, y su binding relativo `plantilla` carga las fichas de ese equipo.
- **Dar de baja:** la action se llama sobre el contexto de la fila. SAPUI5 envía `POST .../Inscripciones(ID)/plantilla(ID)/EquipoService.darDeBaja`, y CAP aplica también ahí la restricción del delegado.

## 7. App de consulta

Una pantalla con un desplegable de ligas y tres pestañas: clasificación, goleadores y calendario. Al pulsar un partido se muestra su marcador.

`view/Liga.view.xml`:

```xml
<mvc:View
  controllerName="football.consulta.controller.Liga"
  xmlns:mvc="sap.ui.core.mvc"
  xmlns="sap.m"
  xmlns:core="sap.ui.core"
  displayBlock="true">
  <App>
    <Page title="Consulta de ligas">
      <subHeader>
        <Toolbar>
          <Label text="Liga:" labelFor="selLiga"/>
          <Select id="selLiga" forceSelection="false" width="20rem" change=".onCambiarLiga"
            items="{path: '/Ligas', sorter: {path: 'nombre'}}">
            <core:Item key="{ID}" text="{nombre} {temporada}"/>
          </Select>
        </Toolbar>
      </subHeader>

      <IconTabBar id="pestanas" expandable="false">
        <items>
          <IconTabFilter text="Clasificación" key="clasificacion">
            <Table items="{clasificacion>/}" noDataText="Elige una liga">
              <columns>
                <Column width="3rem"><Text text="#"/></Column>
                <Column><Text text="Equipo"/></Column>
                <Column hAlign="End"><Text text="PJ"/></Column>
                <Column hAlign="End"><Text text="G"/></Column>
                <Column hAlign="End"><Text text="E"/></Column>
                <Column hAlign="End"><Text text="P"/></Column>
                <Column hAlign="End" minScreenWidth="Tablet" demandPopin="true"><Text text="GF"/></Column>
                <Column hAlign="End" minScreenWidth="Tablet" demandPopin="true"><Text text="GC"/></Column>
                <Column hAlign="End"><Text text="DG"/></Column>
                <Column hAlign="End"><Text text="Puntos"/></Column>
              </columns>
              <items>
                <ColumnListItem>
                  <cells>
                    <Text text="{clasificacion>posicion}"/>
                    <Text text="{clasificacion>equipo}"/>
                    <Text text="{clasificacion>jugados}"/>
                    <Text text="{clasificacion>ganados}"/>
                    <Text text="{clasificacion>empatados}"/>
                    <Text text="{clasificacion>perdidos}"/>
                    <Text text="{clasificacion>golesFavor}"/>
                    <Text text="{clasificacion>golesContra}"/>
                    <Text text="{clasificacion>diferencia}"/>
                    <ObjectNumber number="{clasificacion>puntos}" emphasized="true"/>
                  </cells>
                </ColumnListItem>
              </items>
            </Table>
          </IconTabFilter>

          <IconTabFilter text="Goleadores" key="goleadores">
            <Table items="{goleadores>/}" noDataText="Todavía no hay goles">
              <columns>
                <Column><Text text="Jugador"/></Column>
                <Column><Text text="Equipo"/></Column>
                <Column hAlign="End"><Text text="Goles"/></Column>
              </columns>
              <items>
                <ColumnListItem>
                  <cells>
                    <Text text="{goleadores>nombre} {goleadores>apellidos}"/>
                    <Text text="{goleadores>equipo}"/>
                    <ObjectNumber number="{goleadores>goles}" emphasized="true"/>
                  </cells>
                </ColumnListItem>
              </items>
            </Table>
          </IconTabFilter>

          <IconTabFilter text="Calendario" key="calendario">
            <Table id="partidos" growing="true" growingThreshold="50" noDataText="Sin partidos"
              items="{path: '/Partidos', suspended: true,
                      sorter: [{path: 'jornadaNumero'}, {path: 'fecha_hora'}]}">
              <columns>
                <Column width="6rem"><Text text="Jornada"/></Column>
                <Column><Text text="Fecha y hora"/></Column>
                <Column><Text text="Local"/></Column>
                <Column><Text text="Visitante"/></Column>
                <Column minScreenWidth="Tablet" demandPopin="true"><Text text="Sede"/></Column>
                <Column><Text text="Estado"/></Column>
              </columns>
              <items>
                <ColumnListItem type="Active" press=".onVerMarcador">
                  <cells>
                    <Text text="{jornadaNumero}"/>
                    <Text text="{fecha_hora}"/>
                    <Text text="{localNombre}"/>
                    <Text text="{visitanteNombre}"/>
                    <Text text="{sedeNombre}"/>
                    <Text text="{estado}"/>
                  </cells>
                </ColumnListItem>
              </items>
            </Table>
          </IconTabFilter>
        </items>
      </IconTabBar>
    </Page>
  </App>
</mvc:View>
```

`controller/Liga.controller.js`:

```js
sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/m/MessageBox",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/ui/model/json/JSONModel"
], (Controller, MessageBox, Filter, FilterOperator, JSONModel) => {
  "use strict";

  return Controller.extend("football.consulta.controller.Liga", {
    onInit() {
      // Los resultados de las functions se guardan en modelos locales
      this.getView().setModel(new JSONModel([]), "clasificacion");
      this.getView().setModel(new JSONModel([]), "goleadores");
    },

    onCambiarLiga(oEvent) {
      const sLiga = oEvent.getParameter("selectedItem").getKey();

      this._cargarFuncion("clasificacion", { liga: sLiga });
      this._cargarFuncion("goleadores", { liga: sLiga, top: 10 });

      const oPartidos = this.byId("partidos").getBinding("items");
      oPartidos.filter(new Filter("jornada/liga_ID", FilterOperator.EQ, sLiga));
      if (oPartidos.isSuspended()) {
        oPartidos.resume();
      }
    },

    // Llama a una function sin entidad, p. ej. GET /clasificacion(liga=...), y guarda la lista
    async _cargarFuncion(sNombre, mParametros) {
      const oFuncion = this.getView().getModel().bindContext(`/${sNombre}(...)`);
      Object.entries(mParametros).forEach(([sParametro, vValor]) => oFuncion.setParameter(sParametro, vValor));
      try {
        await oFuncion.invoke();
        const oDatos = await oFuncion.getBoundContext().requestObject();
        this.getView().getModel(sNombre).setData(Array.isArray(oDatos) ? oDatos : (oDatos?.value ?? []));
      } catch (oError) {
        MessageBox.error(oError.message);
      }
    },

    // Function enlazada a un partido: GET /Partidos(...)/ConsultaService.marcador()
    async onVerMarcador(oEvent) {
      const oPartido = oEvent.getSource().getBindingContext();
      const oFuncion = this.getView().getModel().bindContext("ConsultaService.marcador(...)", oPartido);
      try {
        await oFuncion.invoke();
        const oContexto = oFuncion.getBoundContext();
        MessageBox.information(
          `${oPartido.getProperty("localNombre")} ${oContexto.getProperty("local")} - ` +
          `${oContexto.getProperty("visitante")} ${oPartido.getProperty("visitanteNombre")}`,
          { title: "Marcador" });
      } catch (oError) {
        MessageBox.error(oError.message);
      }
    }
  });
});
```

- **Clasificación y goleadores:** son functions sin entidad que devuelven una lista. `_cargarFuncion` las invoca y guarda el resultado en un `JSONModel`, al que se enlazan las tablas con el prefijo `clasificacion>` o `goleadores>`.
- **Calendario:** es una tabla OData normal sobre `/Partidos`, filtrada por la liga, igual que en la app del administrador.
- **Marcador:** es una function enlazada a cada partido. Devuelve un tipo complejo, así que sus campos se leen con `getProperty("local")` y `getProperty("visitante")`.

## 8. Arrancar las apps

```bash
cds watch
```

Abre la dirección que da BAS para el puerto 4004 y añade la ruta de cada app:

| App | Ruta | Usuario / contraseña |
|---|---|---|
| Administración | `/admin/webapp/index.html` | `admin@liga.es` / `admin` |
| Mi equipo | `/equipo/webapp/index.html` | `delegado@liga.es` / `delegado` |
| Consulta | `/consulta/webapp/index.html` | `jugador@liga.es` / `jugador` |

El navegador pide usuario y contraseña con la primera petición y los recuerda. Para entrar con otro rol, usa una ventana de incógnito o cierra todas las del navegador.

## 9. Probar las pantallas

Con los datos de prueba recién cargados:

**Administración (`admin@liga.es`)**
1. Abre **Liga Diario** y pulsa **Generar calendario** con fecha `2026-11-16` e ida y vuelta. Debe mostrar "Calendario generado: 30 partidos" y la tabla con las 10 jornadas.
2. Abre un partido de Atlético Robledal y pulsa **Añadir jugador**. El dorsal 2 no debe aparecer, porque está sancionado.
3. Añade dos jugadores, registra un gol y una tarjeta roja. Cada tabla se actualiza al momento.
4. Pulsa **Finalizar**: los botones del acta se desactivan y el estado pasa a `finalizado`.
5. Abre el siguiente partido de Atlético Robledal: el expulsado no aparece en **Añadir jugador**.

**Mi equipo (`delegado@liga.es`)**
1. El desplegable muestra solo 4 inscripciones: Atlético Robledal y Racing Vallehermoso.
2. Da de alta un jugador nuevo con un documento inventado: aparece en la tabla.
3. Da de alta al documento `10000003T` en Racing Vallehermoso, Liga Diario: aparece el error "El jugador ya tiene ficha en un equipo de esta liga".
4. Da de baja a un jugador: su estado pasa a **Baja** y desaparece el botón.

**Consulta (`jugador@liga.es`)**
1. Elige **Liga Diario**: la clasificación muestra los 6 equipos.
2. Si ya finalizaste un partido, aparece en **Clasificación** y sus goles en **Goleadores**.
3. En **Calendario**, pulsa un partido: se muestra su marcador.

## 10. Problemas frecuentes

| Síntoma | Causa y solución |
|---|---|
| Página en blanco | Abre las herramientas del navegador (F12) → **Console**. Suele ser un error de sintaxis en una vista XML o un nombre mal escrito en `manifest.json`. |
| `404` en `sap-ui-core.js` | La versión indicada en `index.html` ya no está en el CDN. Cámbiala por una LTS vigente. |
| `403` o tablas vacías | El usuario no tiene el rol del servicio. Abre la app en una ventana de incógnito con el usuario correcto. |
| Error "Forbidden" al pulsar un botón | El delegado intenta actuar sobre un equipo que no es suyo, o el usuario no es admin. |
| Los cambios en el código no se ven | Recarga sin caché con Ctrl+Shift+R. |
| Horas distintas a las de la base de datos | Es correcto: el servidor guarda en UTC y SAPUI5 las muestra en la hora local del navegador. |

## 11. Siguientes pasos

- **Textos traducibles:** mover los textos a `i18n/i18n.properties` y usarlos con `{i18n>clave}`.
- **Más mantenimiento en la app de admin:** equipos, jugadores y sedes, con el mismo patrón de tabla y diálogo. Para crear registros se usa `oListBinding.create({...})` y para editar basta con enlazar un `Input` a la propiedad (`value="{nombre}"`), ya que el modelo envía el `PATCH`.
- **Reprogramar partidos:** diálogo con `DateTimePicker` y `Select` de sedes que llame a `AdminService.reprogramar`.
- **Launchpad:** reunir las tres apps en un único punto de entrada, por ejemplo con el plugin `cds-launchpad-plugin` en local o con SAP Build Work Zone al desplegar.
- **Herramientas de UI5:** añadir `ui5.yaml` y `@ui5/cli` para empaquetar las apps antes de desplegarlas, y `@ui5/linter` para revisarlas:

  ```bash
  cd app/admin && npx @ui5/linter
  ```
