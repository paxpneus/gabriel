import { Model } from "sequelize";

interface hasDocument {
    document?: string | number
    cnpj?: string | number
    cpf?: string | number
}

const normalizeDocument = <T extends hasDocument> (instance: T) => {
    if (instance.document) {
        instance.document = String(instance.document).replace(/\D/g, '') as any;
    }

    if (instance.cnpj) {
        instance.cnpj = String(instance.cnpj).replace(/\D/g, '') as any;
    }
};

const cleanDocument = (doc: string) => String(doc).replace(/\D/g, '')



export {
    normalizeDocument,
    cleanDocument
}