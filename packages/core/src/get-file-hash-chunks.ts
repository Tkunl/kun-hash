import { getArrayBufFromBlobs, getArrParts, isBrowser, isNode, sliceFile } from './utils'
import { crc32, md5 } from 'hash-wasm'
import { WorkerService } from './worker/worker-service'
import { isEmpty } from './utils'
import { BrowserHashChksParam, FileMetaInfo, NodeHashChksParam } from './interface'
import { HashChksParam, HashChksParamRes } from './interface'
import { Strategy } from './enum'
import { getRootHashByChunks } from './get-root-hash-by-chunks'

const DEFAULT_MAX_WORKERS = 8
const BORDER_COUNT = 100

const isNodeEnv = isNode()
const isBrowserEnv = isBrowser()

let workerService: WorkerService | null = null

function normalizeParam(param: HashChksParam) {
  if (isNodeEnv && isEmpty(param.url)) {
    throw new Error('The url attribute is required in node environment')
  }

  if (isBrowserEnv && isEmpty(param.file)) {
    throw new Error('The file attribute is required in browser environment')
  }

  /**
   * Ts 编译器无法从 isEmpty 的调用结果自动推断出后续的变量类型, Ts 在类型层面不具备执行时判断函数逻辑的能力
   * 可以通过 明确地检查 undefined 或 使用 ! 或 使用类型断言来处理
   * 此处使用了 !
   */
  const normalizedParam = <HashChksParam>{
    file: param.file,
    url: param.filePath,
    chunkSize: isEmpty(param.chunkSize) ? 10 : param.chunkSize!, // 默认 10MB 分片大小
    maxWorkerCount: isEmpty(param.maxWorkerCount) ? DEFAULT_MAX_WORKERS : param.maxWorkerCount!, // 默认使用 8个 Worker 线程
    strategy: isEmpty(param.strategy) ? Strategy.mixed : param.strategy!, // 默认使用混合模式计算 hash
    borderCount: isEmpty(param.borderCount) ? BORDER_COUNT : param.borderCount!, // 默认以 100 分片数量作为边界
    isCloseWorkerImmediately: isEmpty(param.isCloseWorkerImmediately) // 默认计算 hash 后立即关闭 worker
      ? true
      : param.isCloseWorkerImmediately!,
  }

  if (isNodeEnv) {
    return normalizedParam as NodeHashChksParam
  }

  if (isBrowserEnv) {
    return normalizedParam as BrowserHashChksParam
  }

  throw new Error('Unsupported environment')
}

async function getFileMetadata(file?: File, filePath?: string): Promise<FileMetaInfo> {
  if (file && isBrowserEnv) {
    return {
      name: file.name,
      size: file.size / 1024,
      lastModified: file.lastModified,
      type: file.type,
    }
  }
  if (filePath && isNodeEnv) {
    const { promises: fs } = await import('fs')
    const path = await import('path')
    const stats = await fs.stat(filePath)
    return {
      name: path.basename(filePath),
      size: stats.size / 1024,
      lastModified: stats.mtime.getTime(),
      type: path.extname(filePath),
    }
  }
  throw new Error('Unsupported environment')
}

async function processFileInBrowser(
  file: File,
  chunkSize: number,
  strategy: Strategy,
  maxWorkerCount: number,
  isCloseWorkerImmediately: boolean,
  borderCount: number,
) {
  // 文件分片
  const chunksBlob = sliceFile(file, chunkSize)
  let chunksHash: string[] = []

  if (chunksBlob.length === 1) {
    const unit8Array = new Uint8Array(await chunksBlob[0].arrayBuffer())
    chunksHash =
      strategy === Strategy.md5 || strategy === Strategy.mixed
        ? [await md5(unit8Array)]
        : [await crc32(unit8Array)]
  } else {
    let chunksBuf: ArrayBuffer[] = []
    // 将文件分片进行分组, 组内任务并行执行, 组外任务串行执行
    const chunksPart = getArrParts<Blob>(chunksBlob, maxWorkerCount)
    const tasks = chunksPart.map((part) => async () => {
      // 手动释放上一次用于计算 Hash 的 ArrayBuffer
      // 现在只会占用 MAX_WORKERS * 分片数量大小的内存
      chunksBuf.length = 0
      chunksBuf = await getArrayBufFromBlobs(part)
      // 执行不同的 hash 计算策略
      if (strategy === Strategy.md5) {
        return workerService!.getMD5ForFiles(chunksBuf)
      }
      if (strategy === Strategy.crc32) {
        return workerService!.getCRC32ForFiles(chunksBuf)
      } else {
        return chunksBlob.length <= borderCount
          ? workerService!.getMD5ForFiles(chunksBuf)
          : workerService!.getCRC32ForFiles(chunksBuf)
      }
    })
    isCloseWorkerImmediately && workerService!.terminate()
    for (const task of tasks) {
      const result = await task()
      chunksHash.push(...result)
    }
  }

  const fileHash = await getRootHashByChunks(chunksHash)
  
  return {
    chunksBlob,
    chunksHash,
    fileHash,
  }
}

/**
 * 将文件进行分片, 并获取分片后的 hashList
 * @param param
 */
async function getFileHashChunks(param: HashChksParam): Promise<HashChksParamRes> {
  const normalizedParam = normalizeParam(param)

  const { chunkSize, maxWorkerCount, strategy, borderCount, isCloseWorkerImmediately } =
    normalizedParam

  if (workerService === null) {
    workerService = new WorkerService(maxWorkerCount)
  }

  // 文件元数据
  const metadata = await getFileMetadata(param.file, param.filePath)

  // 浏览器环境下处理文件
  const { chunksBlob, chunksHash, fileHash } = await processFileInBrowser(
    param.file!,
    chunkSize,
    strategy,
    borderCount,
    isCloseWorkerImmediately,
    borderCount,
  )

  return {
    chunksBlob,
    chunksHash,
    merkleHash: fileHash,
    metadata,
  }
}

function destroyWorkerPool() {
  workerService && workerService.terminate()
}

export { getFileHashChunks, destroyWorkerPool }
