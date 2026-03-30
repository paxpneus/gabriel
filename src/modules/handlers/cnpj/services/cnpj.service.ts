import { AxiosInstance } from "axios";
import { fetchCNPJ } from "../api/cpnj_api.service";
export class CNPJService {

    constructor(){}

    public async checkCNAE(allowedCnaes: string[], customerCnpj: string): Promise<Boolean> {
        
        const customerCnaes = await fetchCNPJ(customerCnpj)

        return customerCnaes.cnaes.some(cnae => allowedCnaes.includes(cnae))
    }
}