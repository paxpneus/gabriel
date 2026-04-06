import { AlertSeverity, AlertPayload } from "./nodemailer.types";

export const SEVERITY_COLORS: Record<AlertSeverity, string> = {
  CRITICAL: "#D32F2F",
  HIGH: "#F57C00",
  MEDIUM: "#FBC02D",
};

export const SEVERITY_EMOJI: Record<AlertSeverity, string> = {
  CRITICAL: "🔴",
  HIGH: "🟠",
  MEDIUM: "🟡",
};

export function buildHtml(payload: AlertPayload): string {
  const color = SEVERITY_COLORS[payload.severity];
  const emoji = SEVERITY_EMOJI[payload.severity];
  const contextHtml = payload.context
    ? `<pre style="background:#f5f5f5;padding:12px;border-radius:4px;font-size:13px">${JSON.stringify(payload.context, null, 2)}</pre>`
    : "";
  const errorHtml = payload.error
    ? `<p><strong>Erro:</strong></p><pre style="background:#fff3f3;padding:12px;border-radius:4px;font-size:13px;color:#c62828">${payload.error instanceof Error ? payload.error.stack ?? payload.error.message : String(payload.error)}</pre>`
    : "";

  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <div style="background:${color};padding:16px 20px;border-radius:6px 6px 0 0">
        <h2 style="color:#fff;margin:0">${emoji} [${payload.severity}] ${payload.title}</h2>
      </div>
      <div style="border:1px solid #ddd;border-top:none;padding:20px;border-radius:0 0 6px 6px">
        <p style="font-size:15px">${payload.message}</p>
        ${contextHtml}
        ${errorHtml}
        <hr style="border:none;border-top:1px solid #eee;margin:16px 0"/>
        <p style="color:#999;font-size:12px">
          Disparado em: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
          · Ambiente: ${process.env.NODE_ENV ?? "unknown"}
        </p>
      </div>
    </div>
  `;
}

export function buildSimpleHtml(payload: AlertPayload): string {
  const ctx = payload.context ? `<pre style="font-size:12px">${JSON.stringify(payload.context, null, 2)}</pre>` : '';
  const err = payload.error ? `<p style="color:#a32d2d"><strong>Erro:</strong> ${payload.error}</p>` : '';
  return `
    <div style="font-family:sans-serif;max-width:600px">
      <h2 style="margin:0 0 8px">[${payload.severity}] ${payload.title}</h2>
      <p>${payload.message}</p>
      ${err}
      ${ctx}
    </div>
  `;
}