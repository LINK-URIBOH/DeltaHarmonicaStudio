// Accept a source identifier, never an arbitrary URL supplied by the renderer.
export const GUIDE_SOURCES = [
  { id: 'staff', title: 'Steps to Music Theory · 音符、休止与谱号', url: 'https://odp.library.tamu.edu/stepstomusictheory/chapter/the-basics/' },
  { id: 'jianpu', title: 'TablEdit Manual · 简谱记谱说明', url: 'https://tabledit.com/help/english_m/jianpu.shtml' }
] as const;
export function guideSourceUrl(id: unknown): string | null {
  return GUIDE_SOURCES.find(source => source.id === id)?.url ?? null;
}
