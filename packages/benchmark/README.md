## Introduce for benchmark

It is used to test the hash calculation speed of the Hash worker under different threads.

Both `browser` environments and `node` environments are now supported.

### Usage

```ts
import { benchmark, BenchmarkOptions } from 'hash-worker-benchmark'

// options is optional.
const options: BenchmarkOptions = {}
benchmark(options)
```

### Options

**BenchmarkOptions**

| filed               | type     | default                                 | description                |
| ------------------- | -------- | --------------------------------------- | -------------------------- |
| sizeInMB            | number   | 500                                     | File size for testing (MB)    |
| strategy            | Strategy | Strategy.md5                            | Hash computation strategy     |
| workerCountTobeTest | number[] | [1, 1, 1, 4, 4, 4, 8, 8, 8, 12, 12, 12] | Each test is performed three times with 1, 4, 8, and 12 threads |

```ts
// strategy.ts
export enum Strategy {
  md5 = 'md5',
  crc32 = 'crc32',
  mixed = 'mixed',
}
```
### LICENSE

[MIT](./../../LICENSE)