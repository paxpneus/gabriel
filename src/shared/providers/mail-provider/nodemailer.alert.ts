import { AlertPayload, IMailNext } from "./nodemailer.types";
import { SEVERITY_EMOJI, buildHtml, buildSimpleHtml } from "./nodemailer.templates";
import nodemailerService from "./nodemailer.service"; // usa o serviço único, sem transporter duplicado

export class AlertService {
  constructor(private mailNext?: IMailNext) {}

  // Fallback direto: chama o NodeMailerService já existente
  private async sendViaSMTP(payload: AlertPayload): Promise<void> {
    const emoji = SEVERITY_EMOJI[payload.severity];
    await nodemailerService.send({
      to: process.env.ALERT_EMAIL ?? process.env.MAILER_USER ?? "",
      subject: `${emoji} [${payload.severity}] ${payload.title}`,
      html: buildHtml(payload),
    });
  }

  async sendAlert(payload: AlertPayload): Promise<void> {
    const emoji = SEVERITY_EMOJI[payload.severity];

    console.error(
      `\n${"=".repeat(60)}\n${emoji} ALERT [${payload.severity}] ${payload.title}\n${"=".repeat(60)}`
    );

    // Se não tem fila, vai direto pro SMTP
    if (!this.mailNext) {
      await this.sendViaSMTP(payload);
      return;
    }

    // Tenta a fila primeiro, independente da severidade
    try {
      await this.mailNext.add(
        {
          to: process.env.ALERT_EMAIL ?? process.env.MAILER_USER ?? "",
          subject: `${emoji} [${payload.severity}] ${payload.title}`,
          html: buildSimpleHtml(payload),
        },
        `alert-${payload.severity}-${payload.title.replace(/\s+/g, "-").toLowerCase()}-${Date.now()}`
      );
    } catch (queueError) {
      console.error("[AlertService] Fila indisponível, fallback SMTP:", queueError);
      try {
        await this.sendViaSMTP(payload);
      } catch (smtpError) {
        // Aqui não tem mais nada pra tentar — loga e segue
        console.error("[AlertService] Falha total no envio de alerta:", smtpError);
      }
    }
  }
}