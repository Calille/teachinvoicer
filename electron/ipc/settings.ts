import { ipcMain } from 'electron';
import { getSettings, updateSettings } from '../store/index';

export function registerSettingsIpc(): void {
  ipcMain.handle('settings:get', () => getSettings());
  ipcMain.handle('settings:update', (_e, patch) => updateSettings(patch));
}
