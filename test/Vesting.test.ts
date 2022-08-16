import { LogDescription } from '@ethersproject/abi'
import { TransactionReceipt } from '@ethersproject/abstract-provider'
import { BigNumber } from '@ethersproject/bignumber'
import { parseEther } from '@ethersproject/units'
import { assert, expect } from 'chai'
import { ethers, network } from 'hardhat'
import {
  MockERC20__factory,
  MockNeurToken__factory,
  Vesting,
  VestingFactory__factory,
  Vesting__factory,
  VestingFactory,
  MockNeurToken,
} from '../typechain-types'
import { VestingInitializedEvent } from '../typechain-types/contracts/vesting/VestingtFactory.sol/VestingFactory'
import * as time from '../helpers/time'

const HALF_YEAR_IN_SECONDS = 15768000

describe('Test vesting', () => {
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
    const { initializedVestingEventCliffTimes, deployedVestingsAddresses, recipients } = await deployAndGetData()

    const nonZeroCliffTime = initializedVestingEventCliffTimes.find(x => !x.isZero())
    const indexOfVesting = initializedVestingEventCliffTimes.indexOf(nonZeroCliffTime)
    const vestingAddress = deployedVestingsAddresses[indexOfVesting]
    const recipientAddress = recipients[indexOfVesting]
    const recipient = await ethers.getSigner(recipientAddress)
    const vesting = await Vesting__factory.connect(vestingAddress, recipient)

    await time.increase(nonZeroCliffTime.sub(1))

    const unclaimed = await vesting.unclaimed()

    assert.equal(unclaimed.toString(), '0', 'Unclaimed is not zero')
  })

  it(`Unclaimed is zero right after cliff ends`, async () => {
    const { initializedVestingEventCliffTimes, deployedVestingsAddresses, recipients } = await deployAndGetData()

    const nonZeroCliffTime = initializedVestingEventCliffTimes.find(x => !x.isZero())
    const indexOfVesting = initializedVestingEventCliffTimes.indexOf(nonZeroCliffTime)
    const vestingAddress = deployedVestingsAddresses[indexOfVesting]
    const recipientAddress = recipients[indexOfVesting]
    const recipient = await ethers.getSigner(recipientAddress)
    const vesting = await Vesting__factory.connect(vestingAddress, recipient)

    await time.increase(nonZeroCliffTime)

    const unclaimed = await vesting.unclaimed()

    assert.equal(unclaimed.toString(), '0', 'Unclaimed is not zero')
  })

  it(`Can claim with zero cliff after some time`, async () => {
    const { initializedVestingEventCliffTimes, deployedVestingsAddresses, recipients, mockNeurToken } =
      await deployAndGetData()

    const zeroCliffTime = initializedVestingEventCliffTimes.find(x => x.isZero())
    const indexOfVesting = initializedVestingEventCliffTimes.indexOf(zeroCliffTime)
    const vestingAddress = deployedVestingsAddresses[indexOfVesting]
    const recipientAddress = recipients[indexOfVesting]
    const recipient = await ethers.getSigner(recipientAddress)
    const vesting = await Vesting__factory.connect(vestingAddress, recipient)

    await time.increase(100)

    const unclaimed = await vesting.unclaimed()

    assert.notEqual(unclaimed.toString(), '0', 'Unclaimed is zero')

    await vesting.claim(recipient.address, unclaimed)

    const balance = await mockNeurToken.balanceOf(recipient.address)

    assert.equal(balance.toString(), unclaimed.toString(), 'Balance after claim is not correct')
  })

  it(`Can't claim amount greater than unclaimed`, async () => {
    const { initializedVestingEventCliffTimes, deployedVestingsAddresses, recipients } = await deployAndGetData()

    const zeroCliffTime = initializedVestingEventCliffTimes.find(x => x.isZero())
    const indexOfVesting = initializedVestingEventCliffTimes.indexOf(zeroCliffTime)
    const vestingAddress = deployedVestingsAddresses[indexOfVesting]
    const recipientAddress = recipients[indexOfVesting]
    const recipient = await ethers.getSigner(recipientAddress)
    const vesting = await Vesting__factory.connect(vestingAddress, recipient)

    // await time.increase(100)
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
    const { initializedVestingEventCliffTimes, deployedVestingsAddresses, recipients, mockNeurToken } =
      await deployAndGetData()

    const zeroCliffTime = initializedVestingEventCliffTimes.find(x => x.isZero())
    const indexOfVesting = initializedVestingEventCliffTimes.indexOf(zeroCliffTime)
    const vestingAddress = deployedVestingsAddresses[indexOfVesting]
    const recipientAddress = recipients[indexOfVesting]
    const recipient = await ethers.getSigner(recipientAddress)
    const vesting = await Vesting__factory.connect(vestingAddress, recipient)

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
})

async function deployAndGetData() {
  const vestingParams = await getVestingParams()
  const { recipients, vestingPeriods, vestingAmounts, cliffTimes } = vestingParams

  const { vestingFactory, vestingImplementation } = await deployVestingContracts()
  const { mockNeurToken } = await deployMockNeurToken({
    vestingFactory,
    vestingImplementation,
    vestingParams,
  })
  const deployReceipt = await mockNeurToken.deployTransaction.wait()
  const {
    deployedVestingsAddresses,
    initializedVestingEventAmounts,
    initializedVestingEventCliffTimes,
    initializedVestingEventRecipients,
    initializedVestingEventUnlockTimes,
  } = await parseVestingInitializedEventsArgs(deployReceipt)
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
    deployReceipt,
    deployedVestingsAddresses,
    initializedVestingEventAmounts,
    initializedVestingEventCliffTimes,
    initializedVestingEventRecipients,
    initializedVestingEventUnlockTimes,
    vestingBalances,
    vestingContractsCliffTimes,
    vestingContractsLockedAmounts,
    vestingContractsRecipients,
  }
}

async function getContractFactories() {
  const [deployer, recipient1, recipient2] = await ethers.getSigners()

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
  const { VestingFactory_Factory, Vesting_Factory } = await getContractFactories()
  const vestingImplementation = await Vesting_Factory.deploy()
  const vestingFactory = await VestingFactory_Factory.deploy()

  return {
    vestingFactory,
    vestingImplementation,
  }
}

async function deployMockNeurToken({
  vestingParams,
  vestingFactory,
  vestingImplementation,
}: {
  vestingParams: {
    recipients: string[]
    vestingAmounts: BigNumber[]
    vestingPeriods: BigNumber[]
    cliffTimes: BigNumber[]
  }
  vestingFactory: VestingFactory
  vestingImplementation: Vesting
}) {
  const [deployer] = await ethers.getSigners()
  const { MockNeurToken_Factory } = await getContractFactories()

  const mockNeurToken = await MockNeurToken_Factory.deploy(
    'MockNeurToken',
    'MockNeurToken',
    18,
    vestingFactory.address,
    vestingImplementation.address,
    [deployer.address],
    {
      _amounts: vestingParams.vestingAmounts,
      _recipients: vestingParams.recipients,
      _cliffTimes: vestingParams.cliffTimes,
      _unlockTimes: vestingParams.vestingPeriods,
    }
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
    vestingFactoryInterface.events['VestingInitialized(address,address,address,uint256,uint256,uint256)'].name
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

  const deployedVestingsAddresses = vestingInitializedEventsArgs.map(x => x.vesting)
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
