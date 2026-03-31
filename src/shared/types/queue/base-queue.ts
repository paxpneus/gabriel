type nextStepOnQueue = {add: (data: any, jobId: string) => Promise<any>}
type nextStepDelayedOnQueue = {addDelayed: (data: any, jobId: string, delay: number) => Promise<any>}
type nextRemoveOnQueue = {removeJob: (jobId: string) => Promise<void>}

export {
    nextStepOnQueue,
    nextStepDelayedOnQueue,
    nextRemoveOnQueue
}
