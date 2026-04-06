import { sendMailDto } from './nodemailer.types';
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

    this.checkMailerService()
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

  async send(data: sendMailDto): Promise<SMTPTransport.SentMessageInfo> {
    try {

      const mail_info = await this.transporter.sendMail({
        from: process.env.MAILER_FROM,
        to: data.to,
        subject: data.subject || 'Sem Assunto',
        text: data.text,
        html: data.html,
      });

      console.log(
        `[NODEMAILER - SERVICE 200] - Email enviado para ${data.to}, ID: ${mail_info.messageId}`,
      );

      return mail_info
    } catch (error) {
      console.error("Error while sending mail:", error);
      throw error;
    }
  }
}

export default new NodeMailerService();
