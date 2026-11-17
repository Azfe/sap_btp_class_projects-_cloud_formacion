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
