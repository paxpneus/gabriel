'use strict';

const { createDecipheriv } = require('crypto');

const PAGE_SIZE = 500;
const NFE_RETURN_PURPOSE = '4';

// Mesma cifra de src/shared/utils/xml/xml-cipher.ts; xml_path legado pode estar em texto puro.
function decryptXml(value, key) {
  if (!/^[a-f0-9]{32}:.+/.test(value)) return value;
  const [ivHex, content] = value.split(':');
  const decipher = createDecipheriv('aes-256-cbc', key, Buffer.from(ivHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(content, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface) {
    const { sequelize } = queryInterface;
    if (!process.env.XML_ENCRYPTION_KEY) throw new Error('XML_ENCRYPTION_KEY não definida');
    const key = Buffer.from(process.env.XML_ENCRYPTION_KEY, 'hex');

    // Devolução antiga: "REF: <n>" na description (gravado pelo upsert antigo a partir do refNFe) e bonded_invoice vazio.
    const toBond = [];
    const toClearDescription = [];
    let lastId = null;
    let unreadable = 0;

    for (;;) {
      const page = await sequelize.query(
        `SELECT i.id, i.description, i.bonded_invoice, i.xml_path,
                bool_and(a.status = 'CANCELLED') AS all_cancelled
         FROM invoices i
         JOIN invoice_unit_business_attributes a ON a.invoice_id = i.id AND a.type = 'INCOMING'
         WHERE i.xml_path IS NOT NULL
           AND (i.bonded_invoice IS NULL OR i.description LIKE 'REF:%')
           ${lastId ? 'AND i.id > :lastId' : ''}
         GROUP BY i.id
         ORDER BY i.id
         LIMIT :limit`,
        { type: 'SELECT', replacements: { lastId, limit: PAGE_SIZE } },
      );
      if (!page.length) break;
      lastId = page[page.length - 1].id;

      for (const row of page) {
        let xml;
        try {
          xml = decryptXml(row.xml_path, key);
        } catch {
          unreadable++;
          continue;
        }
        const purpose = (xml.match(/<finNFe>(\d)<\/finNFe>/) || [])[1];
        if (purpose !== NFE_RETURN_PURPOSE) continue;

        const refKey = (xml.match(/<refNFe>(\d{44})<\/refNFe>/) || [])[1];
        const refNumber = refKey ? String(Number(refKey.slice(25, 34))) : null;

        // Só a REF automática (ou o "REF: null" do bug antigo) — descrição manual fica.
        if (row.description === `REF: ${refNumber}` || row.description === 'REF: null') {
          toClearDescription.push(row.id);
        }
        // Devolução cancelada não vincula, mesmo critério do bling-api-fetch (só situação autorizada).
        if (!row.bonded_invoice && refKey && !row.all_cancelled) {
          toBond.push({ id: row.id, refKey, refNumber });
        }
      }
    }

    const outgoingByKey = new Map();
    const refKeys = [...new Set(toBond.map((item) => item.refKey))];
    for (let i = 0; i < refKeys.length; i += PAGE_SIZE) {
      const outgoing = await sequelize.query(
        `SELECT DISTINCT i.xml_key, i.number_system
         FROM invoices i
         JOIN invoice_unit_business_attributes a ON a.invoice_id = i.id AND a.type = 'OUTGOING'
         WHERE i.xml_key IN (:keys)`,
        { type: 'SELECT', replacements: { keys: refKeys.slice(i, i + PAGE_SIZE) } },
      );
      outgoing.forEach((row) => outgoingByKey.set(row.xml_key, row.number_system));
    }

    // Saída fora do sistema: cai no número do refNFe, o mesmo que já estava na description.
    const bonds = toBond.map((item) => ({
      id: item.id,
      bonded: outgoingByKey.get(item.refKey) ?? item.refNumber,
    }));

    await sequelize.transaction(async (transaction) => {
      for (let i = 0; i < bonds.length; i += PAGE_SIZE) {
        const chunk = bonds.slice(i, i + PAGE_SIZE);
        await sequelize.query(
          `UPDATE invoices i
           SET bonded_invoice = v.bonded, updated_at = NOW()
           FROM unnest(ARRAY[:ids]::uuid[], ARRAY[:bonded]::varchar[]) AS v(id, bonded)
           WHERE i.id = v.id AND i.bonded_invoice IS NULL`,
          {
            replacements: { ids: chunk.map((b) => b.id), bonded: chunk.map((b) => b.bonded) },
            transaction,
          },
        );
      }
      for (let i = 0; i < toClearDescription.length; i += PAGE_SIZE) {
        await sequelize.query(
          `UPDATE invoices SET description = NULL, updated_at = NOW() WHERE id IN (:ids)`,
          { replacements: { ids: toClearDescription.slice(i, i + PAGE_SIZE) }, transaction },
        );
      }
    });

    const missingOutgoing = toBond.filter((item) => !outgoingByKey.has(item.refKey)).length;
    console.log(
      `m317: ${bonds.length} devoluções vinculadas (${missingOutgoing} sem nota de saída no sistema), ` +
        `${toClearDescription.length} descriptions limpas, ${unreadable} XMLs ilegíveis`,
    );
  },

  // Irreversível: não guarda quais bonded_invoice/description vieram daqui.
  async down() {},
};
