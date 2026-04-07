// METHODS

// [GET] ORDERS RESPONSE

export interface Descount {
    valor: number;
    unidade: string;
}

export interface Category {
    id: string;
}
 
export interface BusinessUnity {
  id: number;
}

export interface Store {
  id: number;
  unidadeNegocio: BusinessUnity;
}

export interface Situation {
  id: number;
  valor: number;
}

export interface Contact {
  id: number;
  nome: string;
  tipoPessoa: 'F' | 'J'; 
  numeroDocumento: string;
}

export interface blingOrderResponse {
  id: number;
  numero: number;
  numeroLoja: string;
  data: string;
  dataSaida: string;
  dataPrevista: string;
  totalProdutos: number;
  total: number;
  contato: Contact;
  situacao: Situation;
  loja: Store;
  numeroPedidoCompra: string;
  outrasDespesas: number;
  observacoes: string;
  observacoesInternas: string;
  desconto: Descount
}

// [GET] ORDERS PARAMS

export interface blingOrdersParams {
  pagina?: number;
  limite?: number;
  idContato?: number;
  
  /** IDs das situações - Enviados como array idsSituacoes[] */
  idsSituacoes?: number[];
  
  /** Formato: YYYY-MM-DD */
  dataInicial?: string;
  dataFinal?: string;
  
  /** Formato: YYYY-MM-DD HH:mm:ss */
  dataAlteracaoInicial?: string;
  dataAlteracaoFinal?: string;
  
  /** Formato: YYYY-MM-DD */
  dataPrevistaInicial?: string;
  dataPrevistaFinal?: string;
  
  numero?: number;
  idLoja?: number;
  idVendedor?: number;
  idControleCaixa?: number;
  
  /** Números dos pedidos nas lojas de origem - Enviados como numerosLojas[] */
  numerosLojas?: string[];
  
  idUnidadeNegocio?: number;
}