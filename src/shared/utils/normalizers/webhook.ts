// Processador Global de Webhooks

export const executeWebhookAction = async <T>(
  action: string,
  body: any,
  handlers: Record<string, (data: any) => Promise<T>>
): Promise<T | void> => {
  const handler = handlers[action];

  if (!handler) {
    console.warn(`[WebhookUtils] Ação não suportada: ${action}`);
    return;
  }

  return await handler(body);
};