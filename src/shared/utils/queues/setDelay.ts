export const setDelayBasedOnDate = (date: Date, daysBeforeJob: number = 1): number => {
    const target = new Date(date);
    
    const brtOffset = 3 * 60 * 60 * 1000;
    const brtMidnight = new Date(target.getTime() - brtOffset);
    brtMidnight.setUTCHours(0, 0, 0, 0); // meia-noite BRT
    
    brtMidnight.setUTCDate(brtMidnight.getUTCDate() - daysBeforeJob);
    brtMidnight.setUTCHours(8, 0, 0, 0);
    
    const delay = Math.max(0, brtMidnight.getTime() - Date.now());
    return delay;
};