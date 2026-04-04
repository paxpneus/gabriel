export const setDelayBasedOnDate = (date: Date, daysBeforeJob: number = 1):number => {
    const oneDayBefore = new Date(date);
    oneDayBefore.setDate(oneDayBefore.getDate() - daysBeforeJob);
    const delay = Math.max(0, oneDayBefore.getTime() - Date.now())
    return delay
} 