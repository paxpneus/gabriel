import { Socket } from "socket.io";
import { parseCookie } from "cookie";
import { PdvAccessContext, PdvAccessScreen } from "./pdv-access.types";
import {
  assertLinkParamsMatch,
  resolveLinkAccess,
  resolveLoginAccess,
} from "./helpers/resolve-pdv-access";

export interface PdvSocketData {
  pdvAccess: PdvAccessContext;
}

// Escopo real (a que solicitação o socket pode se inscrever) é checado
// depois, no evento de watch (pdv-sales-request.socket.ts).
const ALL_SCREENS = [
  PdvAccessScreen.STORE_REQUEST,
  PdvAccessScreen.FINANCE,
  PdvAccessScreen.CD21,
];

// Mesma resolução dual do pdvAccess HTTP — cookie de login vem do handshake
// (sem cookie-parser aqui), link vem de handshake.auth em vez de headers.
export async function pdvSocketAuthMiddleware(
  socket: Socket,
  next: (err?: Error) => void,
): Promise<void> {
  try {
    const rawCookie = socket.handshake.headers.cookie;
    const cookieToken = rawCookie ? parseCookie(rawCookie).token : undefined;

    const { unitBusinessNumber, token, screen } = socket.handshake.auth ?? {};
    const loginResult = await resolveLoginAccess(cookieToken, ALL_SCREENS);
    if (loginResult && "context" in loginResult) {
      (socket.data as PdvSocketData).pdvAccess = loginResult.context;
      return next();
    }
    if (loginResult && !token) {
      return next(new Error(loginResult.error.message));
    }

    const linkResult = await resolveLinkAccess(
      unitBusinessNumber,
      token,
      ALL_SCREENS,
    );
    if ("error" in linkResult) {
      return next(new Error(linkResult.error.message));
    }

    // Número já é o do handshake (mesmo que validou o token) — só `screen` é conferido.
    const mismatch = assertLinkParamsMatch(
      linkResult.context,
      { screen },
      unitBusinessNumber,
    );
    if (mismatch) return next(new Error(mismatch.message));

    (socket.data as PdvSocketData).pdvAccess = linkResult.context;
    next();
  } catch (error: any) {
    next(new Error(error.message));
  }
}
