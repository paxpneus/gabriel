import crypto from "crypto";
import { PdvAccessScreen } from "../pdv-access.types";

// Sem tabela/persistência: o token de cada link é derivado deterministicamente
// (HMAC) de (número da loja, tela) + um segredo que mora só em variável de
// ambiente — nunca no banco. Televendas/Financeiro usam a mesma função com um
// input fixo (acesso global, não amarrado a nenhuma loja real).
function getSecret(): string {
  const secret = process.env.PDV_ACCESS_TOKEN_SECRET;
  if (!secret) {
    throw new Error(
      "PDV_ACCESS_TOKEN_SECRET não configurada — obrigatória pra computar/validar links do PDV Management",
    );
  }
  return secret;
}

function hmac(input: string): string {
  return crypto.createHmac("sha256", getSecret()).update(input).digest("hex");
}

export function computeStoreScreenToken(
  unitBusinessNumber: string,
  screen: PdvAccessScreen,
): string {
  return hmac(`store:${unitBusinessNumber}:${screen}`);
}

export function computeTelesalesToken(): string {
  return hmac("telesales");
}

export function computeFinanceToken(): string {
  return hmac("finance");
}

export function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
