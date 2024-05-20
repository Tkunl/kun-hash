import { WorkerPool } from '../entity/worker-pool'
import { WorkerWrapper } from '../entity/worker-wrapper'
// @ts-ignore
import Worker from 'web-worker:./crc32-single.web-worker.ts'

export class WorkerPoolForCrc32s extends WorkerPool {
  constructor(maxWorkers = navigator.hardwareConcurrency || 4) {
    super(maxWorkers)
    this.pool = Array.from({ length: this.maxWorkerCount }).map(
      () => new WorkerWrapper(new Worker()),
    )
  }
}
