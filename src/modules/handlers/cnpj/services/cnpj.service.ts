import { AxiosInstance } from "axios";
import { fetchCNPJ } from "../api/cpnj_api.service";
export class CNPJService {

    constructor(){}

    public async checkCNAE(allowedCnaes: string[], customerCnpj: string): Promise<Boolean> {

        const customerCnaes = await fetchCNPJ(customerCnpj)

        console.log('CNAES DO CLIENTE', customerCnaes)
        console.log('CNAES DA EMPRESA', allowedCnaes)

        return customerCnaes.cnaes.some(cnae => allowedCnaes.includes(cnae))
    }
}

export default CNPJService