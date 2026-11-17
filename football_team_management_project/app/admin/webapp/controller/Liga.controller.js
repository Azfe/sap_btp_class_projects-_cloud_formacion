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
