import { LogDescription } from '@ethersproject/abi'
import { TransactionReceipt } from '@ethersproject/abstract-provider'
import { BigNumber } from '@ethersproject/bignumber'
import { parseEther } from '@ethersproject/units'
import { assert, expect } from 'chai'
import { ethers, network } from 'hardhat'
import {
  MockNeurToken__factory,
  VestingFactory__factory,
  Vesting__factory,
  VestingFactory,
  MockNeurToken,
} from '../typechain-types'
import * as time from '../helpers/time'
import { VestingInitializedEvent } from '../typechain-types/contracts/vesting/VestingFactory'

const HALF_YEAR_IN_SECONDS = 15768000

describe('Test vesting', () => {
  let snapshotId: string

  it('deploys with right params', async () => {
    const {
      recipients,
      vestingPeriods,
      vestingAmounts,
      cliffTimes,
      initializedVestingEventAmounts,
      initializedVestingEventCliffTimes,
      initializedVestingEventRecipients,
      initializedVestingEventUnlockTimes,
      vestingBalances,
      vestingContractsCliffTimes,
      vestingContractsLockedAmounts,
      vestingContractsRecipients,
    } = await deployAndGetData()

    assert.deepEqual(vestingBalances, vestingAmounts, 'Vesting balances are not correct')
    assert.deepEqual(
      initializedVestingEventAmounts,
      vestingAmounts,
      'Vesting initialized event amounts are not correct'
    )
    assert.deepEqual(
      initializedVestingEventRecipients,
      recipients,
      'Vesting initialized event recipients are not correct'
    )
    assert.deepEqual(
      initializedVestingEventCliffTimes,
      cliffTimes,
      'Vesting initialized event cliff times are not correct'
    )
    assert.deepEqual(
      initializedVestingEventUnlockTimes,
      vestingPeriods,
      'Vesting initialized event unlock times are not correct'
    )
    assert.deepEqual(vestingContractsRecipients, recipients, 'Vesting contracts recipients are not correct')
    assert.deepEqual(vestingContractsLockedAmounts, vestingAmounts, 'Vesting contracts locked amounts are not correct')
    assert.deepEqual(vestingContractsCliffTimes, cliffTimes, 'Vesting contracts cliff times are not correct')
  })

  it(`Unclaimed is zero before cliff ends`, async () => {
    const { vestingInitializedEventsArgs } = await deployAndGetData()

    const nonZeroCliffTimeVesting = vestingInitializedEventsArgs.find(x => !x.cliffTime.isZero())
    const cliffTime = nonZeroCliffTimeVesting.cliffTime
    const recipientAddress = nonZeroCliffTimeVesting.recipient
    const recipient = await ethers.getSigner(recipientAddress)
    const vesting = await Vesting__factory.connect(nonZeroCliffTimeVesting.vestingAddress, recipient)

    await time.increase(cliffTime.sub(1))

    const unclaimed = await vesting.unclaimed()

    assert.equal(unclaimed.toString(), '0', 'Unclaimed is not zero')
  })

  it(`Unclaimed is zero right after cliff ends`, async () => {
    const { vestingInitializedEventsArgs } = await deployAndGetData()

    const nonZeroCliffTimeVesting = vestingInitializedEventsArgs.find(x => !x.cliffTime.isZero())
    const cliffTime = nonZeroCliffTimeVesting.cliffTime
    const recipientAddress = nonZeroCliffTimeVesting.recipient
    const recipient = await ethers.getSigner(recipientAddress)
    const vesting = await Vesting__factory.connect(nonZeroCliffTimeVesting.vestingAddress, recipient)

    await time.increase(cliffTime)

    const unclaimed = await vesting.unclaimed()

    assert.equal(unclaimed.toString(), '0', 'Unclaimed is not zero')
  })

  it(`Can claim with zero cliff after some time`, async () => {
    const { vestingInitializedEventsArgs, mockNeurToken } = await deployAndGetData()

    const zeroCliffTimeVesting = vestingInitializedEventsArgs.find(x => x.cliffTime.isZero())
    const recipientAddress = zeroCliffTimeVesting.recipient
    const recipient = await ethers.getSigner(recipientAddress)
    const vesting = await Vesting__factory.connect(zeroCliffTimeVesting.vestingAddress, recipient)

    await time.increase(100)

    const unclaimed = await vesting.unclaimed()

    assert.notEqual(unclaimed.toString(), '0', 'Unclaimed is zero')

    await vesting.claim(recipient.address, unclaimed)

    const balance = await mockNeurToken.balanceOf(recipient.address)

    assert.equal(balance.toString(), unclaimed.toString(), 'Balance after claim is not correct')
  })

  it(`Can't claim amount greater than unclaimed`, async () => {
    const { vestingInitializedEventsArgs } = await deployAndGetData()

    const zeroCliffTimeVesting = vestingInitializedEventsArgs.find(x => x.cliffTime.isZero())
    const recipientAddress = zeroCliffTimeVesting.recipient
    const recipient = await ethers.getSigner(recipientAddress)
    const vesting = await Vesting__factory.connect(zeroCliffTimeVesting.vestingAddress, recipient)

    const currentTime = await time.now()
    const blockMineTime = currentTime.add(100).toNumber()

    // Go to the future, get unclaimed amount and revert back and set the time to the same time we checked unclaimed
    // if we just go to the future and check unclaimed, it wont be equal to the one during claim block mine
    // because EVM increases time every block
    const snapshot = await time.takeSnapshot()
    await time.increaseTo(blockMineTime)
    const unclaimed = await vesting.unclaimed()
    await time.revertToSnapShot(snapshot)
    await network.provider.send('evm_setNextBlockTimestamp', [blockMineTime])

    assert.notEqual(unclaimed.toString(), '0', 'Unclaimed is zero')

    await expect(vesting.claim(recipient.address, unclaimed.add(1))).to.be.revertedWith(
      'Amount must be less than or equal to unclaimed amount'
    )
  })

  it(`Can claim half amount after half time with zero cliff`, async () => {
    const { vestingInitializedEventsArgs, mockNeurToken } = await deployAndGetData()

    const zeroCliffTimeVesting = vestingInitializedEventsArgs.find(x => x.cliffTime.isZero())
    const recipientAddress = zeroCliffTimeVesting.recipient
    const recipient = await ethers.getSigner(recipientAddress)
    const vesting = await Vesting__factory.connect(zeroCliffTimeVesting.vestingAddress, recipient)

    const lockedAmount = await vesting.lockedAmount()
    const lockEndTime = await vesting.lockEndTime()
    const unlockStartTime = await vesting.unlockStartTime()
    const currentTime = await time.now()
    const halfUnlockedtime = currentTime.add(lockEndTime.sub(unlockStartTime).div(2))
    const halfUnlockedAmount = lockedAmount.div(2)

    const snapshot = await time.takeSnapshot()
    await time.increaseTo(halfUnlockedtime)
    const unclaimed = await vesting.unclaimed()
    await time.revertToSnapShot(snapshot)
    await network.provider.send('evm_setNextBlockTimestamp', [halfUnlockedtime.toNumber()])

    assert.equal(unclaimed.toString(), halfUnlockedAmount.toString(), 'Unclaimed is not equal half unlocked amount')

    await vesting.claim(recipient.address, unclaimed)

    const balance = await mockNeurToken.balanceOf(recipient.address)

    assert.equal(balance.toString(), halfUnlockedAmount.toString(), 'Balance after claim is not correct')
  })

  it(`Can claim all amount after lock end time with zero cliff`, async () => {
    const { vestingInitializedEventsArgs, mockNeurToken } = await deployAndGetData()

    const zeroCliffTimeVesting = vestingInitializedEventsArgs.find(x => x.cliffTime.isZero())
    const recipientAddress = zeroCliffTimeVesting.recipient
    const recipient = await ethers.getSigner(recipientAddress)
    const vesting = await Vesting__factory.connect(zeroCliffTimeVesting.vestingAddress, recipient)

    const lockedAmount = await vesting.lockedAmount()
    const lockEndTime = await vesting.lockEndTime()
    const snapshot = await time.takeSnapshot()
    await time.increaseTo(lockEndTime)
    const unclaimed = await vesting.unclaimed()
    await time.revertToSnapShot(snapshot)
    await network.provider.send('evm_setNextBlockTimestamp', [lockEndTime.toNumber()])

    assert.equal(unclaimed.toString(), lockedAmount.toString(), 'Unclaimed is not equal lock end time amount')

    await vesting.claim(recipient.address, unclaimed)

    const balance = await mockNeurToken.balanceOf(recipient.address)

    assert.equal(balance.toString(), lockedAmount.toString(), 'Balance after claim is not correct')
  })

  it(`Can claim all amount after lock end time with non-zero cliff`, async () => {
    const { vestingInitializedEventsArgs, mockNeurToken } = await deployAndGetData()

    const zeroCliffTimeVesting = vestingInitializedEventsArgs.find(x => !x.cliffTime.isZero())
    const recipientAddress = zeroCliffTimeVesting.recipient
    const recipient = await ethers.getSigner(recipientAddress)
    const vesting = await Vesting__factory.connect(zeroCliffTimeVesting.vestingAddress, recipient)

    const lockedAmount = await vesting.lockedAmount()
    const lockEndTime = await vesting.lockEndTime()
    const snapshot = await time.takeSnapshot()
    await time.increaseTo(lockEndTime)
    const unclaimed = await vesting.unclaimed()
    await time.revertToSnapShot(snapshot)
    await network.provider.send('evm_setNextBlockTimestamp', [lockEndTime.toNumber()])

    assert.equal(unclaimed.toString(), lockedAmount.toString(), 'Unclaimed is not equal lock end time amount')

    await vesting.claim(recipient.address, unclaimed)

    const balance = await mockNeurToken.balanceOf(recipient.address)

    assert.equal(balance.toString(), lockedAmount.toString(), 'Balance after claim is not correct')

    await time.increase(10000)

    const unclaimedAfterTimeIncrease = await vesting.unclaimed()

    assert.equal(
      unclaimedAfterTimeIncrease.toString(),
      '0',
      'Unclaimed is not zero after total claim and time increase'
    )
  })

  it(`Unclaimed is zero after claim`, async () => {
    const { vestingInitializedEventsArgs, mockNeurToken } = await deployAndGetData()

    const zeroCliffTimeVesting = vestingInitializedEventsArgs.find(x => x.cliffTime.isZero())
    const recipientAddress = zeroCliffTimeVesting.recipient
    const recipient = await ethers.getSigner(recipientAddress)
    const vesting = await Vesting__factory.connect(zeroCliffTimeVesting.vestingAddress, recipient)

    const currentTime = await time.now()
    const blockMineTime = currentTime.add(100).toNumber()

    // Go to the future, get unclaimed amount and revert back and set the time to the same time we checked unclaimed
    // if we just go to the future and check unclaimed, it wont be equal to the one during claim block mine
    // because EVM increases time every block
    const snapshot = await time.takeSnapshot()
    await time.increaseTo(blockMineTime)
    const unclaimed = await vesting.unclaimed()
    await time.revertToSnapShot(snapshot)
    await network.provider.send('evm_setNextBlockTimestamp', [blockMineTime])

    await vesting.claim(recipient.address, unclaimed)

    const balance = await mockNeurToken.balanceOf(recipient.address)

    const unclaimedAfterClaim = await vesting.unclaimed()

    assert.equal(balance.toString(), unclaimed.toString(), 'Balance after claim is not correct')
    assert.equal(unclaimedAfterClaim.toString(), '0', 'Unclaimed is not zero')
  })

  it(`Wrong recipient can't claim`, async () => {
    const nonRecipientSigner = (await ethers.getSigners())[10]
    const { vestingInitializedEventsArgs, mockNeurToken } = await deployAndGetData()

    const zeroCliffTimeVesting = vestingInitializedEventsArgs.find(x => x.cliffTime.isZero())
    const recipientAddress = zeroCliffTimeVesting.recipient
    const recipient = await ethers.getSigner(recipientAddress)
    const vesting = await Vesting__factory.connect(zeroCliffTimeVesting.vestingAddress, recipient)

    const currentTime = await time.now()
    const blockMineTime = currentTime.add(100).toNumber()

    // Go to the future, get unclaimed amount and revert back and set the time to the same time we checked unclaimed
    // if we just go to the future and check unclaimed, it wont be equal to the one during claim block mine
    // because EVM increases time every block
    const snapshot = await time.takeSnapshot()
    await time.increaseTo(blockMineTime)
    const unclaimed = await vesting.unclaimed()
    await time.revertToSnapShot(snapshot)
    await network.provider.send('evm_setNextBlockTimestamp', [blockMineTime])

    await expect(vesting.connect(nonRecipientSigner).claim(recipient.address, unclaimed)).to.be.revertedWith(
      'Only the recipient can claim'
    )
  })

  it(`Can claim to beneficiary address`, async () => {
    const nonRecipientSigner = (await ethers.getSigners())[10]
    const { vestingInitializedEventsArgs, mockNeurToken } = await deployAndGetData()

    const zeroCliffTimeVesting = vestingInitializedEventsArgs.find(x => x.cliffTime.isZero())
    const recipientAddress = zeroCliffTimeVesting.recipient
    const recipient = await ethers.getSigner(recipientAddress)
    const vesting = await Vesting__factory.connect(zeroCliffTimeVesting.vestingAddress, recipient)

    const currentTime = await time.now()
    const blockMineTime = currentTime.add(100).toNumber()

    // Go to the future, get unclaimed amount and revert back and set the time to the same time we checked unclaimed
    // if we just go to the future and check unclaimed, it wont be equal to the one during claim block mine
    // because EVM increases time every block
    const snapshot = await time.takeSnapshot()
    await time.increaseTo(blockMineTime)
    const unclaimed = await vesting.unclaimed()
    await time.revertToSnapShot(snapshot)
    await network.provider.send('evm_setNextBlockTimestamp', [blockMineTime])

    await vesting.claim(nonRecipientSigner.address, unclaimed)

    const balance = await mockNeurToken.balanceOf(nonRecipientSigner.address)

    assert.equal(balance.toString(), unclaimed.toString(), 'Balance of beneficiary after claim is not correct')
  })

  it('Can deploy and init from vesting factory balance', async () => {
    const recipient = (await ethers.getSigners())[5]
    const { mockNeurToken, vestingFactoryInitialNeurAmount, vestingFactory } = await deployAndGetData()

    const recipients = [recipient.address]
    const vestingAmounts = [vestingFactoryInitialNeurAmount]
    const vestingPeriods = [BigNumber.from(HALF_YEAR_IN_SECONDS)]
    const cliffTimes = [BigNumber.from(0)]

    const tx = await vestingFactory.createVestingsFactoryBalance(
      mockNeurToken.address,
      recipients,
      vestingPeriods,
      cliffTimes,
      vestingAmounts
    )

    const txReceipt = await tx.wait()

    const {
      deployedVestingsAddresses,
      initializedVestingEventAmounts,
      initializedVestingEventCliffTimes,
      initializedVestingEventRecipients,
      initializedVestingEventUnlockTimes,
    } = await parseVestingInitializedEventsArgs(txReceipt)

    assert(deployedVestingsAddresses.length === 1, 'Vesting was not deployed')

    const { vestingBalances, vestingContractsCliffTimes, vestingContractsLockedAmounts, vestingContractsRecipients } =
      await getVestingsState({
        vestingsAddresses: deployedVestingsAddresses,
        mockNeurToken,
      })

    assert.deepEqual(vestingBalances, vestingAmounts, 'Vesting balances are not correct')
    assert.deepEqual(
      initializedVestingEventAmounts,
      vestingAmounts,
      'Vesting initialized event amounts are not correct'
    )
    assert.deepEqual(
      initializedVestingEventRecipients,
      recipients,
      'Vesting initialized event recipients are not correct'
    )
    assert.deepEqual(
      initializedVestingEventCliffTimes,
      cliffTimes,
      'Vesting initialized event cliff times are not correct'
    )
    assert.deepEqual(
      initializedVestingEventUnlockTimes,
      vestingPeriods,
      'Vesting initialized event unlock times are not correct'
    )
    assert.deepEqual(vestingContractsRecipients, recipients, 'Vesting contracts recipients are not correct')
    assert.deepEqual(vestingContractsLockedAmounts, vestingAmounts, 'Vesting contracts locked amounts are not correct')
    assert.deepEqual(vestingContractsCliffTimes, cliffTimes, 'Vesting contracts cliff times are not correct')
  })
})

async function deployVestings(vestingFactory: VestingFactory, numberOfVestings: number) {
  const deployVestingsTx = await vestingFactory.deployVestings(numberOfVestings)

  const deployVestingsTxReceipt = await deployVestingsTx.wait()
  const VestingDeployedEventName = vestingFactory.interface.events['VestingDeployed(address)'].name
  const deployedVestingsAddresses = deployVestingsTxReceipt.events
    .filter(x => x.event === VestingDeployedEventName)
    .map(x => x.args.vesting) as string[]

  return deployedVestingsAddresses
}

async function deployAndGetData() {
  const vestingParams = await getVestingParams()
  const { recipients, vestingPeriods, vestingAmounts, cliffTimes } = vestingParams

  const { vestingFactory, vestingImplementation } = await deployVestingContracts()
  const deployedVestingsAddresses = await deployVestings(vestingFactory, recipients.length)

  const vestingFactoryInitialNeurAmount = parseEther('100')

  const initialHolders = [...deployedVestingsAddresses, vestingFactory.address]
  const initialHoldersAmounts = [...vestingAmounts, vestingFactoryInitialNeurAmount]

  const { mockNeurToken } = await deployMockNeurToken({
    initialHolders,
    initialHoldersAmounts,
  })

  const initVestingsTx = await vestingFactory.initVestings(
    mockNeurToken.address,
    deployedVestingsAddresses,
    recipients,
    vestingPeriods,
    cliffTimes,
    vestingAmounts
  )

  const initVestingsTxReceipt = await initVestingsTx.wait()
  const {
    vestingInitializedEventsArgs,
    initializedVestingEventAmounts,
    initializedVestingEventCliffTimes,
    initializedVestingEventRecipients,
    initializedVestingEventUnlockTimes,
  } = await parseVestingInitializedEventsArgs(initVestingsTxReceipt)
  const { vestingBalances, vestingContractsCliffTimes, vestingContractsLockedAmounts, vestingContractsRecipients } =
    await getVestingsState({
      vestingsAddresses: deployedVestingsAddresses,
      mockNeurToken,
    })

  return {
    vestingParams,
    recipients,
    vestingPeriods,
    vestingAmounts,
    cliffTimes,
    vestingFactory,
    vestingImplementation,
    mockNeurToken,
    deployReceipt: initVestingsTxReceipt,
    deployedVestingsAddresses,
    initializedVestingEventAmounts,
    initializedVestingEventCliffTimes,
    initializedVestingEventRecipients,
    initializedVestingEventUnlockTimes,
    vestingBalances,
    vestingContractsCliffTimes,
    vestingContractsLockedAmounts,
    vestingContractsRecipients,
    vestingInitializedEventsArgs,
    vestingFactoryInitialNeurAmount,
  }
}

async function getContractFactories() {
  const [deployer] = await ethers.getSigners()

  const MockNeurToken_Factory = (await ethers.getContractFactory('MockNeurToken', deployer)) as MockNeurToken__factory
  const VestingFactory_Factory = (await ethers.getContractFactory(
    'VestingFactory',
    deployer
  )) as VestingFactory__factory
  const Vesting_Factory = (await ethers.getContractFactory('Vesting', deployer)) as Vesting__factory

  return {
    MockNeurToken_Factory,
    VestingFactory_Factory,
    Vesting_Factory,
  }
}

async function deployVestingContracts() {
  const [deployer] = await ethers.getSigners()

  const { VestingFactory_Factory, Vesting_Factory } = await getContractFactories()
  const vestingImplementation = await Vesting_Factory.deploy()
  const vestingFactory = await VestingFactory_Factory.deploy([deployer.address], vestingImplementation.address)

  return {
    vestingFactory,
    vestingImplementation,
  }
}

async function deployMockNeurToken({
  initialHolders,
  initialHoldersAmounts,
}: {
  initialHolders: string[]
  initialHoldersAmounts: BigNumber[]
}) {
  const { MockNeurToken_Factory } = await getContractFactories()

  const mockNeurToken = await MockNeurToken_Factory.deploy(
    'MockNeurToken',
    'MockNeurToken',
    18,
    initialHolders,
    initialHoldersAmounts
  )

  return { mockNeurToken }
}

async function getVestingParams() {
  const [, recipient1, recipient2] = await ethers.getSigners()

  const vestingAmount1 = parseEther('100')
  const vestingAmount2 = parseEther('200')
  const vestingCliff1 = BigNumber.from(0)
  const vestingCliff2 = BigNumber.from(10000)
  const vestingPeriod1 = BigNumber.from(HALF_YEAR_IN_SECONDS)
  const vestingPeriod2 = BigNumber.from(HALF_YEAR_IN_SECONDS).mul(2)

  const recipients = [recipient1.address, recipient2.address]
  const vestingAmounts = [vestingAmount1, vestingAmount2]
  const vestingPeriods = [vestingPeriod1, vestingPeriod2]
  const cliffTimes = [vestingCliff1, vestingCliff2]

  return {
    recipients,
    vestingAmounts,
    vestingPeriods,
    cliffTimes,
  }
}

async function parseVestingInitializedEventsArgs(txReceipt: TransactionReceipt) {
  const vestingFactoryInterface = VestingFactory__factory.createInterface()
  const vestingInitializedEventName =
    vestingFactoryInterface.events['VestingInitialized(address,address,address,address,uint256,uint256,uint256)'].name
  const vestingFactoryEvents = txReceipt.logs
    .map(log => {
      try {
        return vestingFactoryInterface.parseLog(log)
      } catch {
        return null
      }
    })
    .filter(Boolean) as LogDescription[]

  const vestingInitializedEventsArgs = vestingFactoryEvents
    .filter(x => x.name === vestingInitializedEventName)
    .map(x => x.args) as VestingInitializedEvent['args'][]

  const deployedVestingsAddresses = vestingInitializedEventsArgs.map(x => x.vestingAddress)
  const initializedVestingEventAmounts = vestingInitializedEventsArgs.map(x => x.lockedAmount)
  const initializedVestingEventRecipients = vestingInitializedEventsArgs.map(x => x.recipient)
  const initializedVestingEventCliffTimes = vestingInitializedEventsArgs.map(x => x.cliffTime)
  const initializedVestingEventUnlockTimes = vestingInitializedEventsArgs.map(x => x.unlockTime)

  return {
    vestingInitializedEventsArgs,
    deployedVestingsAddresses,
    initializedVestingEventAmounts,
    initializedVestingEventRecipients,
    initializedVestingEventCliffTimes,
    initializedVestingEventUnlockTimes,
  }
}

async function getVestingsState({
  vestingsAddresses,
  mockNeurToken,
}: {
  vestingsAddresses: string[]
  mockNeurToken: MockNeurToken
}) {
  const [, recipient1] = await ethers.getSigners()
  const vestingBalances = await Promise.all(
    vestingsAddresses.map(vestingAddress => {
      return mockNeurToken.balanceOf(vestingAddress)
    })
  )

  const vestingContracts = await Promise.all(
    vestingsAddresses.map(vestingAddress => {
      return Vesting__factory.connect(vestingAddress, recipient1)
    })
  )

  const vestingContractsRecipients = await Promise.all(
    vestingContracts.map(vesting => {
      return vesting.recipient()
    })
  )
  const vestingContractsLockedAmounts = await Promise.all(
    vestingContracts.map(vesting => {
      return vesting.lockedAmount()
    })
  )

  const vestingContractsCliffTimes = await Promise.all(
    vestingContracts.map(vesting => {
      return vesting.cliffTime()
    })
  )

  return {
    vestingBalances,
    vestingContractsRecipients,
    vestingContractsLockedAmounts,
    vestingContractsCliffTimes,
  }
}
