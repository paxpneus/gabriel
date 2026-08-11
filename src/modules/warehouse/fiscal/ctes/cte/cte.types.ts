import { Optional } from "sequelize";

// Tipos customizados para o CT-e
export type CteTakerType =
  | "SENDER"       // 0 - Remetente
  | "DISPATCHER"   // 1 - Expedidor
  | "RECEIVER"     // 2 - Recebedor
  | "ADDRESSEE"    // 3 - Destinatário
  | "THIRD_PARTY"; // 4 - Outros / Terceiro

export interface CteAttributes {
  id: string;
  xml_key: string;
  number: number;
  series: number;
  total_value: number;
  issue_date: Date;
  operation_date: Date;

  // Emitente: Sempre a Transportadora que prestou o serviço
  issuer_tax_id: string; // -> transporter
  issuer_name?: string | null; // xNome do <emit> no XML, sem tentar resolver contra tabelas internas

  // Remetente: Origem da carga (Sua Loja em vendas, Fornecedor em compras, Cliente em devoluções)
  sender_tax_id?: string | null; // -> unit_businesses | supplier | customer
  sender_name?: string | null; // xNome do <rem> no XML

  // Destinatário: Destino final da carga (Cliente em vendas, Sua Loja em compras/devoluções)
  recipient_tax_id?: string | null; // -> customer | unit_businesses | supplier
  recipient_name?: string | null; // xNome do <dest> no XML

  // Expedidor: Quem entrega a carga na ponta inicial (Transportadora intermediária / CD)
  dispatcher_tax_id?: string | null; // -> transporter | unit_businesses
  dispatcher_name?: string | null; // xNome do <exped> no XML

  // Recebedor: Quem recebe a carga antes da entrega final (Ponto de transbordo / Redespacho)
  receiver_tax_id?: string | null; // -> transporter | unit_businesses
  receiver_name?: string | null; // xNome do <receb> no XML

  // Tomador: Identifica o papel de quem paga o frete (0-Remetente, 1-Expedidor, 2-Recebedor, 3-Destinatário, 4-Terceiro)
  taker_type?: CteTakerType | null;

  // CNPJ/CPF de quem paga o frete (Pode ser qualquer uma das entidades dependendo do acordo)
  taker_tax_id?: string | null; // -> unit_businesses | customer | supplier | transporter
  taker_name?: string | null; // Nome correspondente à entidade indicada por taker_type/taker_tax_id

  xml_path?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CteCreationAttributes
  extends Optional<CteAttributes, "id" | "createdAt" | "updatedAt"> {}