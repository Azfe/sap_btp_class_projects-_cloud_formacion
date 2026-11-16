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
