export const getBrazilDate = (): string => {
  return new Date().toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).replace(/\//g, '') 
}

export function formatToBRDate(date: string | Date) {
  if (!date) return '—'

  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date))
}

export function formatToBRISOString(date: string | Date) {
  if (!date) return null

  const brDate = new Date(
    new Date(date).toLocaleString("en-US", {
      timeZone: "America/Sao_Paulo",
    }),
  )

  return brDate.toISOString()
}