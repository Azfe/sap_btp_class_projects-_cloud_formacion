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
