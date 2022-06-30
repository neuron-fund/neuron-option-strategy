import { spawn } from 'node:child_process'
import fs from 'fs'
import path from 'path'

const testsFolderAbsolutePath = path.resolve(__dirname, '../test')

async function runTest(testFilePath: string) {
  return new Promise((resolve, reject) => {
    const process = spawn('npx', ['hardhat', 'test', '--network', 'localhost', testFilePath], { stdio: 'inherit' })

    process.on('error', reject)
    process.on('exit', resolve)
  })
}

export async function runAllTests() {
  const testsFilesRelativePaths = fs.readdirSync(testsFolderAbsolutePath).map(f => `./test/${f}`)

  for (const testFileRelativePath of testsFilesRelativePaths) {
    await runTest(testFileRelativePath)
  }
}
