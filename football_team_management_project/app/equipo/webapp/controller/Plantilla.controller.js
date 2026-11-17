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
