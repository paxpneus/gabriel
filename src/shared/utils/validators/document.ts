export function isValidCNPJ(cnpj: string): boolean {
    const clean = cnpj.replace(/\D/g, '')
    if (clean.length !== 14 || /^(\d)\1+$/.test(clean)) return false

    const calc = (mod: number) => {
        let sum = 0
        let pos = mod - 7
        for (let i = 0; i < mod; i++) {
            sum += parseInt(clean[i]) * pos--
            if (pos < 2) pos = 9
        }
        const rest = sum % 11
        return rest < 2 ? 0 : 11 - rest
    }

    return calc(12) === parseInt(clean[12]) && calc(13) === parseInt(clean[13])
}

export function isValidCPF(cpf: string): boolean {
    const clean = cpf.replace(/\D/g, '')
    if (clean.length !== 11 || /^(\d)\1+$/.test(clean)) return false

    let sum = 0
    for (let i = 0; i < 9; i++) sum += parseInt(clean[i]) * (10 - i)
    let rest = (sum * 10) % 11
    if (rest === 10 || rest === 11) rest = 0
    if (rest !== parseInt(clean[9])) return false

    sum = 0
    for (let i = 0; i < 10; i++) sum += parseInt(clean[i]) * (11 - i)
    rest = (sum * 10) % 11
    if (rest === 10 || rest === 11) rest = 0
    return rest === parseInt(clean[10])
}