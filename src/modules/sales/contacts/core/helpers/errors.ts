/** Contato que não pode ser apagado (período de gerente, pedido ou nota): o controller responde 409 com a mensagem. */
export class ContactInUseError extends Error {}
