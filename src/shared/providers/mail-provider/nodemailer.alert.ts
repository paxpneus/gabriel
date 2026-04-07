import { AlertPayload } from "./nodemailer.types";
import { SEVERITY_EMOJI, buildHtml } from "./nodemailer.templates";
import nodemailerService from "./nodemailer.service";

const ALERT_TIMEOUT_MS = 5000;
const DEBOUNCE_MS = 5 * 60 * 1000;

export class AlertService {

  private lastAlertTime: Map<string, number> = new Map();

  private isDebounced(key: string): boolean {
    const last = this.lastAlertTime.get(key);

    if (last && Date.now() - last < DEBOUNCE_MS) return true;
    this.lastAlertTime.set(key, Date.now());
    return false
  }

  private async doSend(payload: AlertPayload): Promise<void> {
    const emoji = SEVERITY_EMOJI[payload.severity];
    await nodemailerService.send({
      to: process.env.ALERT_EMAIL ?? process.env.MAILER_USER ?? "",
      subject: `${emoji} [${payload.severity}] ${payload.title}`,
      html: buildHtml(payload),
    });
  }

  sendAlert(payload: AlertPayload): void {
    const dedupeKey = `${payload.severity}:${payload.title}`;
    if (this.isDebounced(dedupeKey)) {
      console.warn(`[AlertService] Alerta suprimido (debounce): ${payload.title}`);
      return;
    }

    const emoji = SEVERITY_EMOJI[payload.severity];

    console.error(
      `\n${"=".repeat(60)}\n${emoji} ALERT [${payload.severity}] ${payload.title}\n${"=".repeat(60)}`
    );

    Promise.race([
      this.doSend(payload),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error("Alert SMTP timeout")), ALERT_TIMEOUT_MS)
      ),
    ]).catch((err) => {
      console.error("[AlertService] Falha no envio, seguindo:", err.message);
    });
  }
}

export const alertService = new AlertService();