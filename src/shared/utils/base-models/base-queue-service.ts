import { redisConfig } from './../../../config/redis';
import { Queue, Worker, QueueEvents, Job } from "bullmq";

export abstract class BaseQueueService<T> {
    protected queue: Queue;
    protected worker: Worker;
    protected queueEvents: QueueEvents;
    public queueName: string;

    constructor(queueName: string) {
        this.queueName = queueName
        this.queue = new Queue(this.queueName, { connection: redisConfig })
        this.queueEvents = new QueueEvents(this.queueName, { connection: redisConfig })

        this.worker = new Worker(this.queueName, this.process.bind(this))
    }

    abstract process(job: Job<T>): Promise<void>;

    async add(data: T, jobId?: string) {
        return this.queue.add(this.queueName, data, {
            jobId,
            attempts: 3,
            backoff: {type: 'exponential', delay: 5000}
        })
    }
}