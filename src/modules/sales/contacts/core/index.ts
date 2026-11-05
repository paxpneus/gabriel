// Fachada do core (CRUD genérico de contatos). Controller fica fora: só o contacts.routes.ts importa (ver CLAUDE.md).
export { default as contactService, ContactService } from "./services/contacts.service";
export { default as contactRepository, ContactRepository } from "./repositories/contacts.repository";
