import 'dotenv/config'
import { ChildProcess, spawn } from 'node:child_process'
import fs from 'fs'
import { getExternalDirPathFromEnv } from './importLocalNeuronDeployments'
import { runAllTests } from './runAllTests'

function getEnvValues() {
  const { RPC_URL, TEST_MNEMONIC } = process.env

  if (!RPC_URL) {
    throw new Error('RPC_URL in .env is not set')
  }

  if (!TEST_MNEMONIC) {
    throw new Error('TEST_MNEMONIC in .env is not set')
  }

  const NEURON_OPTIONS_PATH = getExternalDirPathFromEnv('NEURON_OPTIONS_PATH')
  const NEURON_CONTRACTS_PATH = getExternalDirPathFromEnv('NEURON_CONTRACTS_PATH')

  return { RPC_URL, TEST_MNEMONIC, NEURON_OPTIONS_PATH, NEURON_CONTRACTS_PATH }
}

async function runE2E() {
  const { RPC_URL, NEURON_CONTRACTS_PATH, NEURON_OPTIONS_PATH } = getEnvValues()
  console.log('Run node and deploy options')
  const forkProcess = await runNodeAndDeployOptions({ RPC_URL, NEURON_OPTIONS_PATH })
  console.log('Deploy neuron contracts')
  try {
    await deployNeuronContracts({
      NEURON_CONTRACTS_PATH,
      NEURON_OPTIONS_PATH,
    })
    console.log('Run tests')
    await runAllTests()
  } finally {
    forkProcess.kill()
  }
}

async function installNpmInFolder(path: string) {
  const npmProcess = spawn('npm', ['install', '--legacy-peer-deps'], { cwd: path, stdio: 'inherit' })

  return new Promise<void>((resolve, reject) => {
    npmProcess.on('error', reject)
    npmProcess.on('exit', exitCode => {
      if (exitCode === 0) {
        resolve()
      } else {
        reject()
      }
    })
  })
}

async function genTypechain(path: string) {
  const typechainProcess = spawn('npx', ['hardhat', 'typechain'], {
    cwd: path,
    stdio: 'inherit',
  })
  return new Promise<void>((resolve, reject) => {
    typechainProcess.on('exit', exitCode => {
      if (exitCode === 0) {
        resolve()
      } else {
        reject()
      }
    })
  })
}

async function compileInDir(path: string) {
  const compileProcess = spawn('npx', ['hardhat', 'compile'], { cwd: path, stdio: 'inherit' })
  return new Promise<void>((resolve, reject) => {
    compileProcess.on('exit', exitCode => {
      if (exitCode === 0) {
        resolve()
      } else {
        reject()
      }
    })
  })
}

function clearDeployments(path: string) {
  fs.rmSync(`${path}/deployments`, { recursive: true, force: true })
}

async function runNodeAndDeployOptions({ NEURON_OPTIONS_PATH, RPC_URL }): Promise<ChildProcess> {
  clearDeployments(NEURON_OPTIONS_PATH)
  await installNpmInFolder(NEURON_OPTIONS_PATH)
  await genTypechain(NEURON_OPTIONS_PATH)

  const envFileContent = `
    RPC_URL="${RPC_URL}"
    FORK_BLOCK_NUMBER=15002374
  `
  fs.writeFileSync(`${NEURON_OPTIONS_PATH}/.env`, envFileContent)

  const forkProcess = spawn('npx', ['hardhat', 'node'], { cwd: NEURON_OPTIONS_PATH })
  return new Promise((resolve, reject) => {
    forkProcess.stdout.on('data', data => {
      if (data.toString().includes('Started HTTP and WebSocket JSON-RPC server at')) {
        console.log(data.toString())
        resolve(forkProcess)
      }
    })
  })
}

async function deployNeuronContracts({ NEURON_CONTRACTS_PATH, NEURON_OPTIONS_PATH }) {
  await installNpmInFolder(NEURON_CONTRACTS_PATH)
  // Required manual compile before typechain gen because automatically it does not generate types for vyper contracts
  await compileInDir(NEURON_CONTRACTS_PATH)
  await genTypechain(NEURON_CONTRACTS_PATH)
  clearDeployments(NEURON_CONTRACTS_PATH)

  const envFileContent = `
    NEURON_OPTIONS_PATH="${NEURON_OPTIONS_PATH}"
  `
  fs.writeFileSync(`${NEURON_CONTRACTS_PATH}/.env`, envFileContent)

  return new Promise<void>((resolve, reject) => {
    const deployProcess = spawn('npx', ['hardhat', 'deploy', '--network', 'localhost'], {
      cwd: NEURON_CONTRACTS_PATH,
      stdio: 'inherit',
    })
    deployProcess.on('exit', exitCode => {
      if (exitCode === 0) {
        resolve()
      } else {
        reject()
      }
    })
  })
}

runE2E()
  .then(() => {
    process.exit(0)
  })
  .catch(e => {
    console.error(e)
    process.exit(1)
  })
