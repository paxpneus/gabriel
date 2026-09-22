import { IMailProvider, sendMailDto } from './nodemailer.types';
import nodemailer, { Transporter } from "nodemailer";
import SMTPTransport from "nodemailer/lib/smtp-transport";
import dotenv from "dotenv";
dotenv.config();

export class NodeMailerService implements IMailProvider {
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

    // Pula a verificação SMTP real (rede) sob Jest — esse singleton é
    // reimportado por praticamente toda fila (via alertService), então
    // cada arquivo de teste disparava uma nova conexão real contra o
    // Gmail. Além de deixar a suíte lenta, a chamada pendente (handle
    // aberto) sobrevivia ao fim dos testes ("Cannot log after tests are
    // done"), e em ambientes de rede mais restritos (ex: build Docker)
    // isso derrubava `npm test` com exit code != 0 mesmo com todos os
    // testes passando.
    if (!process.env.JEST_WORKER_ID) {
      this.checkMailerService();
    }
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
