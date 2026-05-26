import crypto from "crypto";

export class CertificateService {
  private static getKey(): Buffer {
    const secret = process.env.CERT_ENCRYPTION_KEY;
    if (!secret) throw new Error("[Sefaz] CERT_ENCRYPTION_KEY não definida");
    return crypto.scryptSync(secret, "sefaz-cert-salt", 32);
  }

  static loadPfx(): { pfxBuffer: Buffer; passphrase: string } {
    const stored = process.env.SEFAZ_CERT_ENCRYPTED;
    if (!stored) throw new Error("[Sefaz] SEFAZ_CERT_ENCRYPTED não definida");

    const passphrase = process.env.SEFAZ_CERT_PASSPHRASE;
    if (!passphrase) throw new Error("[Sefaz] SEFAZ_CERT_PASSPHRASE não definida");

    const [ivHex, authTagHex, encryptedHex] = stored.split(":");
    if (!ivHex || !authTagHex || !encryptedHex)
      throw new Error("[Sefaz] SEFAZ_CERT_ENCRYPTED com formato inválido");

    const key = this.getKey();
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivHex, "hex"),
    );
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));

    return {
      pfxBuffer: Buffer.concat([
        decipher.update(Buffer.from(encryptedHex, "hex")),
        decipher.final(),
      ]),
      passphrase,
    };
  }
}