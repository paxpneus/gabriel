export const setDelayBasedOnDate = (date: Date, daysBeforeJob: number = 1): number => {
    const target = new Date(date);
    
    target.setUTCDate(target.getUTCDate() - daysBeforeJob);
    
    target.setUTCHours(11, 0, 0, 0); 
    
    const now = Date.now();
    const delay = target.getTime() - now;

    console.log(`[QueueDelay] Coleta: ${date.toISOString()}`);
    console.log(`[QueueDelay] Execução agendada para (UTC): ${target.toISOString()}`);
    
    return Math.max(0, delay);
};