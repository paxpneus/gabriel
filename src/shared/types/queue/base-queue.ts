type nextStepOnQueue = {add: (data: any, jobId: string) => Promise<any>}
type nextStepDelayedOnQueue = {addDelayed: (data: any, jobId: string, delay: number) => Promise<any>}

export {
    nextStepOnQueue,
    nextStepDelayedOnQueue
}