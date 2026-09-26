import { Font, VexFlow } from 'vexflow/core';
import bravuraUrl from '@vexflow-fonts/bravura/bravura.woff2?url';
import academicoUrl from '@vexflow-fonts/academico/academico.woff2?url';

let fontPromise: Promise<void> | null = null;
export function loadNotationFonts(): Promise<void> {
  if (!fontPromise) fontPromise = Promise.all([Font.load('Bravura', bravuraUrl), Font.load('Academico', academicoUrl)]).then(() => { VexFlow.setFonts('Bravura', 'Academico'); });
  return fontPromise;
}
