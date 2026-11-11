// Fachada de affiliated (login/me do afiliado). Fora do core: user.service puxaria Redis na cadeia do map-repository → contacts/core.
export { default as affiliatedService, AffiliatedService } from "./services/affiliated.service";
