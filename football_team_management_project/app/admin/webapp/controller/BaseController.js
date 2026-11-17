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
