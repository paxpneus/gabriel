// Agenda sempre para o mesmo dia da coleta, às 07:00 BRT (10:00 UTC). Se já
// passou das 13:00 BRT (16:00 UTC) nesse dia, empurra para o dia seguinte às
// 07:00 — cobre tanto "coleta é hoje mas já passou das 13h" quanto qualquer
// collection_date já no passado.
export const setDelayBasedOnDate = (date: Date): number => {
    const collectionDate = new Date(date);

    const target = new Date(collectionDate);
    target.setUTCHours(10, 0, 0, 0);

    const cutoff = new Date(collectionDate);
    cutoff.setUTCHours(16, 0, 0, 0);

    const now = Date.now();

    if (now > cutoff.getTime()) {
        target.setUTCDate(target.getUTCDate() + 1);
    }

    const delay = target.getTime() - now;

    console.log(`[QueueDelay] Coleta: ${collectionDate.toISOString()}`);
    console.log(`[QueueDelay] Execução agendada para (UTC): ${target.toISOString()}`);

    return Math.max(0, delay);
};