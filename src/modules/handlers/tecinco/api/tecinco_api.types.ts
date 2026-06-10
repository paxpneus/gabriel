// Resposta do login TCar
export interface TCarLoginResponse {
  status: "success" | "error";
  data: {
    session_token: string;
    user_id: number;
    username: string;
    expires_at: string;
    active_branch_id: number;
    branch_required: boolean;
    must_change_password: boolean;
    allowed_branches: Array<{ codigo: number; nome: string }>;
  };
}

// Fila de requisições aguardando um novo session_token
export interface QueueItem {
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
}

// Estado de sessão mantido por filial
export interface TCarBranchSession {
  sessionToken: string | null;
  isRefreshing: boolean;
  failedQueue: QueueItem[];
}