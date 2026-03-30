// src/.../nfe/nfe-validation.service.ts

interface ValidationResult {
  valid: boolean;
  missingFields: string[];
}

export class NFeValidationService {

  validate(order: any): ValidationResult {
    const missing: string[] = [];

    // Contato
    if (!order.contato?.nome?.trim())            missing.push('contato.nome')
    if (!order.contato?.tipoPessoa?.trim())       missing.push('contato.tipoPessoa')
    if (!order.contato?.numeroDocumento?.trim())  missing.push('contato.numeroDocumento')

    // Etiqueta de transporte
    const etiqueta = order.transporte?.etiqueta
    if (!etiqueta?.nome?.trim())       missing.push('transporte.etiqueta.nome')
    if (!etiqueta?.endereco?.trim())   missing.push('transporte.etiqueta.endereco')
    if (!etiqueta?.numero?.trim())     missing.push('transporte.etiqueta.numero')
    if (!etiqueta?.municipio?.trim())  missing.push('transporte.etiqueta.municipio')
    if (!etiqueta?.uf?.trim())         missing.push('transporte.etiqueta.uf')
    if (!etiqueta?.cep?.trim())        missing.push('transporte.etiqueta.cep')

    // Itens
    if (!order.itens?.length) {
      missing.push('itens (vazio)')
    } else {
      order.itens.forEach((item: any, i: number) => {
        if (!item.codigo?.trim())     missing.push(`itens[${i}].codigo`)
        if (!item.descricao?.trim())  missing.push(`itens[${i}].descricao`)
        if (!item.produto?.id)        missing.push(`itens[${i}].produto.id`)
        if (!(item.quantidade > 0))   missing.push(`itens[${i}].quantidade`)
        if (!(item.valor > 0))        missing.push(`itens[${i}].valor`)
      })
    }

    // Parcelas
    if (!order.parcelas?.length) {
      missing.push('parcelas (vazio)')
    } else {
      order.parcelas.forEach((parcela: any, i: number) => {
        if (!parcela.formaPagamento?.id) missing.push(`parcelas[${i}].formaPagamento.id`)
        if (!(parcela.valor > 0))        missing.push(`parcelas[${i}].valor`)
      })
    }

    // Intermediador
    if (!order.intermediador?.cnpj?.trim())        missing.push('intermediador.cnpj')
    if (!order.intermediador?.nomeUsuario?.trim()) missing.push('intermediador.nomeUsuario')

    // Totais
    if (!(order.totalProdutos > 0)) missing.push('totalProdutos')
    if (!(order.total > 0))         missing.push('total')

    return {
      valid: missing.length === 0,
      missingFields: missing,
    }
  }
}