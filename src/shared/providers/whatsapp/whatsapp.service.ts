class WhatsappService {
  async send(message: string): Promise<void> {
    const response = await fetch(
      `https://graph.facebook.com/v23.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: process.env.ALERT_PHONE,
          type: "text",
          text: {
            body: message,
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(
        `WhatsApp API error: ${response.status} ${await response.text()}`
      );
    }
  }
}

export default new WhatsappService();