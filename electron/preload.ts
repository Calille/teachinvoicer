import { contextBridge, ipcRenderer } from 'electron';
import type { BridgeApi } from '../shared/api';

const invoke = ipcRenderer.invoke.bind(ipcRenderer);

const api: BridgeApi = {
  app: {
    version: () => invoke('app:version'),
    envInfo: () => invoke('app:env-info'),
  },
  shell: {
    openExternal: (url) => invoke('shell:open-external', url),
  },
  dialog: {
    openSpreadsheet: () => invoke('dialog:open-file'),
    saveCsv: (defaultName, contents) =>
      invoke('dialog:save-csv', defaultName, contents),
  },
  xero: {
    status: () => invoke('xero:status'),
    connect: () => invoke('xero:connect'),
    disconnect: () => invoke('xero:disconnect'),
    listAccounts: () => invoke('xero:list-accounts'),
    listBrandingThemes: () => invoke('xero:list-branding-themes'),
    listContacts: (force) => invoke('xero:list-contacts', !!force),
    checkDuplicates: (refs) => invoke('xero:check-duplicates', refs),
  },
  parser: {
    parseFile: (filePath, manualWeekEnding) =>
      invoke('parser:parse-file', filePath, manualWeekEnding ?? null),
  },
  matching: {
    buildMatches: (schoolNames) => invoke('matching:build-matches', schoolNames),
  },
  invoices: {
    create: (invoices, opts) => invoke('invoices:create', invoices, opts),
    retry: (invoice, opts) => invoke('invoices:retry', invoice, opts),
  },
  store: {
    getMappings: () => invoke('store:get-mappings'),
    setMapping: (schoolKey, mapping) => invoke('store:set-mapping', schoolKey, mapping),
    deleteMapping: (schoolKey) => invoke('store:delete-mapping', schoolKey),
    getRuns: () => invoke('store:get-runs'),
    getSettings: () => invoke('settings:get'),
    updateSettings: (patch) => invoke('settings:update', patch),
    resetAll: () => invoke('store:reset-all'),
  },
  events: {
    onInvoiceProgress: (cb) => {
      const listener = (
        _e: Electron.IpcRendererEvent,
        p: { index: number; total: number; school: string },
      ): void => cb(p);
      ipcRenderer.on('invoices:progress', listener);
      return () => ipcRenderer.removeListener('invoices:progress', listener);
    },
    onMenu: (channel, cb) => {
      const listener = (): void => cb();
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },
  },
};

contextBridge.exposeInMainWorld('api', api);
