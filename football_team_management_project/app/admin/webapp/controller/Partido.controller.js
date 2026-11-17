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
