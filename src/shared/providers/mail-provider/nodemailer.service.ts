import nodemailer, { Transporter } from "nodemailer";
import SMTPTransport from "nodemailer/lib/smtp-transport";
import dotenv from "dotenv";
dotenv.config();

class NodeMailerService {
  private transporter: Transporter;

  constructor() {
    const config: SMTPTransport.Options = {
      host: process.env.MAILER_HOST,
      port: Number(process.env.MAILER_PORT),
      secure: process.env.MAILER_SECURE === "true",
      auth: {
        user: process.env.MAILER_USER,
        pass: process.env.MAILER_PASS,
      },
    };

    this.transporter = nodemailer.createTransport(config);
  }

  async checkMailerService(): Promise<void> {
    try {
      await this.transporter.verify();
      console.log(
        "[NODEMAILER - SERVICE 200] Server está pronto para enviar suas mensagens",
      );
    } catch (error) {
      console.log("[NODEMAILER - SERVICE 400] Erro na verificação: ", error);
    }
  }

  async send(to: string, subject?: string, text?: string, html?: string) {
    try {
      const mail_info = await this.transporter.sendMail({
        from: process.env.MAILER_FROM,
        to: to,
        subject: subject,
        text: text,
        html: html,
      });

      console.log(
        `[NODEMAILER - SERVICE 200] - Email enviado para ${to}, conteúdo: %s${mail_info.messageId}`,
      );

      console.log("Preview URL: %s", nodemailer.getTestMessageUrl(mail_info));
    } catch (error) {
      console.error("Error while sending mail:", error);
    }
  }
}

export default new NodeMailerService();
