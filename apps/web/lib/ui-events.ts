/**
 * Two shell actions — "upload" and "new folder" — are triggered from three
 * places each (the rail, the command palette, a keyboard shortcut) while the
 * inputs and dialogs that implement them live in the rail. A pair of window
 * events keeps that decoupled instead of threading callbacks through the tree.
 */
export const UI_EVENT = {
  upload: 'basalt:upload',
  newFolder: 'basalt:new-folder',
} as const;

export const requestUpload = (): void => {
  window.dispatchEvent(new Event(UI_EVENT.upload));
};

export const requestNewFolder = (): void => {
  window.dispatchEvent(new Event(UI_EVENT.newFolder));
};

export function onUiEvent(name: keyof typeof UI_EVENT, handler: () => void): () => void {
  window.addEventListener(UI_EVENT[name], handler);
  return () => window.removeEventListener(UI_EVENT[name], handler);
}
