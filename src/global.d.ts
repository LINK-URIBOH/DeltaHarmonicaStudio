import type { Library, Score } from './core/model';

declare global {
  interface Window {
    studio: {
      getLibrary(): Promise<Library>;
      saveLibrary(data: Library): Promise<boolean>;
      arm(value: boolean): Promise<boolean>;
      start(scoreId: string, events: { startMs: number; durationMs: number; key: string; octave: number; sharp: boolean }[]): Promise<boolean>;
      stop(): Promise<boolean>;
      openProject(): Promise<Score | null>;
      saveProject(score: Score): Promise<boolean>;
      confirmClose(): Promise<boolean>;
      onCloseRequest(callback: () => void): () => void;
      exportText(title: string, content: string): Promise<boolean>;
      exportPage(title: string, html: string, format: 'pdf' | 'png', rowCount: number): Promise<boolean>;
      onPlayRequest(callback: (id: string) => void): () => void;
      onStatus(callback: (message: string) => void): () => void;
      onArmed(callback: (value: boolean) => void): () => void;
    };
  }
}
export {};
