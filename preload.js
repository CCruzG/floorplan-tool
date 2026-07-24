const { contextBridge, ipcRenderer } = require("electron");

// const Ajv = require("ajv"); // ✅ Node can resolve this
// const { floorPlanSchema } = require("./renderer/models/floorPlanSchema.js");

// const ajv = new Ajv({ allErrors: true });
// const validate = ajv.compile(floorPlanSchema);

contextBridge.exposeInMainWorld('electronAPI', {
  saveFloorplan: (args) => ipcRenderer.invoke('save-floorplan', args),
  saveFloorplanSilent: (args) => ipcRenderer.invoke('save-floorplan-silent', args),
  openFloorplan: () => ipcRenderer.invoke('open-floorplan'),
  pickReferenceAsset: () => ipcRenderer.invoke('pick-reference-asset'),

  onServerStatus: (callback) => {
    ipcRenderer.on('server-status', (_event, payload) => callback(payload));
  },

  // // new validator API
  // validateFloorplan: (plan) => {
  //   const ok = validate(plan);
  //   if (ok) {
  //     return { ok: true, errors: [] };
  //   } else {
  //     return {
  //       ok: false,
  //       errors: validate.errors.map(
  //         (err) => `${err.instancePath || "(root)"} ${err.message}`
  //       ),
  //     };
  //   }
  // },
});