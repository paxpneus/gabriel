import { JobsOptions } from "bullmq";
import SMTPTransport from "nodemailer/lib/smtp-transport"

// NODEMAILER QUEUE TYPES

export type sendMailDto = {to: string, subject?: string, text?: string, html?: string}

export interface mailerQueueMethods {
    add: {
        jobId: string,
        data: sendMailDto
    }
}

export interface IMailProvider {
    send(data: sendMailDto): Promise<SMTPTransport.SentMessageInfo | any>;
}

// NODE MAILER AELRT TYPES

export type AlertSeverity = "CRITICAL" | "HIGH" | "MEDIUM"

export interface AlertPayload {
    title: string;
    message: string;
    severity: AlertSeverity;
    context?: Record<string, any>;
    error?: Error | unknown;
}

export interface IMailNext {
  
  add: (
    data: sendMailDto, 
    jobId?: string, 
    opts?: JobsOptions
  ) => Promise<any>;
}