

// Fila dos processos de get de token, falhos e aceitos
export interface QueueItem {
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
}