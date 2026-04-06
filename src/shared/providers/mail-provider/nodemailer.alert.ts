import { AlertPayload } from "./nodemailer.types";
import { SEVERITY_EMOJI, buildHtml } from "./nodemailer.templates";
import nodemailerService from "./nodemailer.service";

const ALERT_TIMEOUT_MS = 5000;

export class AlertService {

  private async doSend(payload: AlertPayload): Promise<void> {
    const emoji = SEVERITY_EMOJI[payload.severity];
    await nodemailerService.send({
      to: process.env.ALERT_EMAIL ?? process.env.MAILER_USER ?? "",
      subject: `${emoji} [${payload.severity}] ${payload.title}`,
      html: buildHtml(payload),
    });
  }

  sendAlert(payload: AlertPayload): void {
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