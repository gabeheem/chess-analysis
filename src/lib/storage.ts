import { restoreStudy, type Study } from './study';
const KEY = 'open-file:notebooks:v1';
export type SavedStudy = { id: string; savedAt: string; study: Study };
export function readLibrary(storage: Pick<Storage, 'getItem'> = localStorage): SavedStudy[] {
  const raw = storage.getItem(KEY);
  if (!raw) return [];
  const list = JSON.parse(raw);
  if (!Array.isArray(list))
    throw new Error(
      'The saved notebook library could not be read. Export your browser data before clearing it.',
    );
  return list.map((item) => {
    if (typeof item.id !== 'string' || typeof item.savedAt !== 'string')
      throw new Error('Invalid saved notebook.');
    return { id: item.id, savedAt: item.savedAt, study: restoreStudy(item.study) };
  });
}
export function writeLibrary(
  items: SavedStudy[],
  storage: Pick<Storage, 'setItem'> = localStorage,
) {
  // setItem is atomic: if quota fails, the previous library remains intact.
  storage.setItem(KEY, JSON.stringify(items));
}
export function downloadFile(name: string, text: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
