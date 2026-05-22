import { ipcMain } from 'electron';
import {
  deleteMapping,
  getMappings,
  getRuns,
  resetAll,
  setMapping,
} from '../store/index';

export function registerStoreIpc(): void {
  ipcMain.handle('store:get-mappings', () => getMappings());

  ipcMain.handle('store:set-mapping', (_e, schoolKey: string, mapping) => {
    setMapping(schoolKey, mapping);
  });

  ipcMain.handle('store:delete-mapping', (_e, schoolKey: string) => {
    deleteMapping(schoolKey);
  });

  ipcMain.handle('store:get-runs', () => getRuns());

  ipcMain.handle('store:reset-all', () => resetAll());
}
