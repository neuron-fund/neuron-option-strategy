import hre, { ethers, deployments } from 'hardhat'
import { increaseTo } from './time'
import { ORACLE_DISPUTE_PERIOD, ORACLE_LOCKING_PERIOD } from '../constants/constants'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumber, Contract, Signer } from 'ethers'
import { wmul } from '../helpers/math'
import { getAsset } from './funds'
import {
  IChainlinkAggregator__factory,
  IGnosisAuction,
  INeuronPoolChainlinkPricer__factory,
  INeuronPoolPricer__factory,
  IOracle__factory,
} from '../typechain-types'
import { USDC } from '../constants/externalAddresses'
import { chainlinkAggregators } from '../constants/chainlinkAggregators'
import { IWhitelist__factory } from '../typechain-types'
const { provider } = ethers
const { parseEther } = ethers.utils

export async function deployProxy(
  logicContractName: string,
  adminSigner: SignerWithAddress,
  initializeArgs: any[],
  logicDeployParams = [],
  factoryOptions = {}
) {
  const TransparentUpgradeableProxy = await ethers.getContractFactory('TransparentUpgradeableProxy', adminSigner)
  const LogicContract = await ethers.getContractFactory(logicContractName, factoryOptions || {})
  const logic = await LogicContract.deploy(...logicDeployParams)

  const initBytes = LogicContract.interface.encodeFunctionData('initialize', initializeArgs)

  const proxy = await TransparentUpgradeableProxy.deploy(logic.address, await adminSigner.getAddress(), initBytes)
  return await ethers.getContractAt(logicContractName, proxy.address)
}

export async function setAssetPricer(asset: string, pricer: string) {
  const { oracle } = await getOracle()
  await oracle.setAssetPricer(asset, pricer)
}

export async function whitelistProduct(underlying: string, strike: string, collaterals: string[], isPut: boolean) {
  const [adminSigner] = await ethers.getSigners()
  const whitelistDeployment = await deployments.get('Whitelist')
  const whitelist = IWhitelist__factory.connect(whitelistDeployment.address, adminSigner)
  const whitelistOwnerAddress = await whitelist.owner()

  const whitelistOwnerSigner = await provider.getSigner(whitelistOwnerAddress)

  await whitelist.connect(whitelistOwnerSigner).whitelistCollaterals(collaterals)
  await whitelist.connect(whitelistOwnerSigner).whitelistProduct(underlying, strike, collaterals, isPut)
}

export async function getOracle() {
  const signer = (await ethers.getSigners())[0]
  const oracleAddress = await (await deployments.get('Oracle')).address
  const oracle = IOracle__factory.connect(oracleAddress, signer)
  const oracleOwnerAddress = await oracle.owner()
  await hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [oracleOwnerAddress],
  })
  const oracleOwner = await provider.getSigner(oracleOwnerAddress)
  return {
    oracle: oracle.connect(oracleOwner),
    oracleOwnerAddress,
    oracleOwner,
  }
}

export async function setupOracle(asset: string, signer: SignerWithAddress) {
  const { oracle, oracleOwnerAddress, oracleOwner } = await getOracle()

  await signer.sendTransaction({
    to: oracleOwnerAddress,
    value: parseEther('0.5'),
  })

  await oracle.connect(oracleOwner).setStablePrice(USDC, '100000000')

  const pricerAddress = await oracle.getPricer(asset)
  await hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [pricerAddress],
  })

  const forceSendContract = await ethers.getContractFactory('ForceSend')
  const forceSend = await forceSendContract.deploy() // force Send is a contract that forces the sending of Ether to WBTC minter (which is a contract with no receive() function)
  await forceSend.connect(signer).go(pricerAddress, { value: parseEther('0.5') })

  const pricerSigner = await provider.getSigner(pricerAddress)

  return oracle.connect(pricerSigner)
}

export async function setOracleExpiryPriceNeuron(
  underlyingAsset: string,
  underlyingOracle: Contract,
  underlyingSettlePrice: BigNumber,
  collateralPricers: Contract[],
  expiry: BigNumber,
  additionalPricers?: {
    pricerName: string
    asset: string
  }[]
) {
  const { oracleOwner, oracle } = await getOracle()
  await increaseTo(expiry.toNumber() + ORACLE_LOCKING_PERIOD + 1)

  const res = await underlyingOracle.setExpiryPrice(underlyingAsset, expiry, underlyingSettlePrice)
  await res.wait()

  for (const additionalPricer of additionalPricers || []) {
    const isChainLink = additionalPricer.pricerName.toLowerCase().includes('chainlink')

    if (isChainLink) {
      const aggregator = chainlinkAggregators[additionalPricer.asset]
      if (!aggregator) {
        throw Error('No aggregator found for asset: ' + additionalPricer.asset)
      }

      const lastRound = await IChainlinkAggregator__factory.connect(aggregator, oracleOwner).latestRound()
      const pricerDeployment = await deployments.get(additionalPricer.pricerName)
      const pricer = await INeuronPoolChainlinkPricer__factory.connect(pricerDeployment.address, oracleOwner)
      await oracle.setStablePrice(additionalPricer.asset, underlyingSettlePrice)
    } else {
      const pricerDeployment = await deployments.get(additionalPricer.pricerName)
      const pricer = await INeuronPoolPricer__factory.connect(pricerDeployment.address, oracleOwner)
      await pricer.setExpiryPriceInOracle(expiry)
    }
  }

  let receipt
  for (const collateralPricer of collateralPricers) {
    const res2 = await collateralPricer.connect(oracleOwner).setExpiryPriceInOracle(expiry)
    receipt = await res2.wait()
  }

  const timestamp = (await provider.getBlock(receipt.blockNumber)).timestamp
  await increaseTo(timestamp + ORACLE_DISPUTE_PERIOD + 1)
}

export async function addMinter(contract: Contract, contractOwner: string, minter: string) {
  const tokenOwnerSigner = await ethers.provider.getSigner(contractOwner)

  await hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [contractOwner],
  })

  const forceSendContract = await ethers.getContractFactory('ForceSend')
  const forceSend = await forceSendContract.deploy() // Some contract do not have receive(), so we force send
  await forceSend.deployed()
  await forceSend.go(contractOwner, {
    value: parseEther('0.5'),
  })

  await contract.connect(tokenOwnerSigner).addMinter(minter)

  await hre.network.provider.request({
    method: 'hardhat_stopImpersonatingAccount',
    params: [contractOwner],
  })
}

export const convertPriceAmount = async (tokenIn: string, tokenOut: string, amount: BigNumber, signer: Signer) => {
  const { oracle } = await getOracle()
  const inPrice = await oracle.connect(signer).getPrice(tokenIn)
  const outPrice = await oracle.connect(signer).getPrice(tokenOut)

  const tokenInDecimals = await (await ethers.getContractAt('IERC20Detailed', tokenIn, signer)).decimals()
  const tokenOutDecimals = await (await ethers.getContractAt('IERC20Detailed', tokenOut, signer)).decimals()

  const decimalShift =
    tokenInDecimals > tokenOutDecimals
      ? BigNumber.from(10).pow(tokenInDecimals - tokenOutDecimals)
      : BigNumber.from(10).pow(tokenOutDecimals - tokenInDecimals)

  const tokenInValue = amount.mul(inPrice)

  const newReturn =
    tokenInDecimals > tokenOutDecimals
      ? tokenInValue.div(outPrice).div(decimalShift)
      : tokenInValue.mul(decimalShift).div(outPrice)

  return newReturn
}

export async function bidForONToken(
  gnosisAuction: IGnosisAuction,
  biddingTokenContract: Contract,
  contractSigner: string,
  onToken: string,
  premium: BigNumber,
  assetDecimals: number,
  multiplier: string,
  auctionDuration: number
) {
  const userSigner = await ethers.provider.getSigner(contractSigner)

  const latestAuction = (await gnosisAuction.auctionCounter()).toString()
  const totalOptionsAvailableToBuy = BigNumber.from(
    await (await ethers.getContractAt('IERC20', onToken)).balanceOf(gnosisAuction.address)
  )
    .mul(await gnosisAuction.FEE_DENOMINATOR())
    .div((await gnosisAuction.FEE_DENOMINATOR()).add(await gnosisAuction.feeNumerator()))
    .div(multiplier)

  let bid = wmul(totalOptionsAvailableToBuy.mul(BigNumber.from(10).pow(10)), premium)
  bid =
    assetDecimals > 18
      ? bid.mul(BigNumber.from(10).pow(assetDecimals - 18))
      : bid.div(BigNumber.from(10).pow(18 - assetDecimals))
  const queueStartElement = '0x0000000000000000000000000000000000000000000000000000000000000001'

  await getAsset(biddingTokenContract.address, bid, contractSigner)

  await biddingTokenContract.connect(userSigner).approve(gnosisAuction.address, bid.toString())

  // BID ON_TOKENS HERE
  await gnosisAuction
    .connect(userSigner)
    .placeSellOrders(
      latestAuction,
      [totalOptionsAvailableToBuy.toString()],
      [bid.toString()],
      [queueStartElement],
      '0x'
    )

  await increaseTo((await provider.getBlock('latest')).timestamp + auctionDuration)

  return [latestAuction, totalOptionsAvailableToBuy, bid]
}

export async function lockedBalanceForRollover(vault: Contract) {
  let currentBalance = await vault.totalBalance()
  let newPricePerShare = await vault.pricePerShare()

  let queuedWithdrawAmount = await sharesToAsset(
    (
      await vault.vaultState()
    ).queuedWithdrawShares,
    newPricePerShare,
    (
      await vault.vaultParams()
    ).decimals
  )

  let balanceSansQueued = currentBalance.sub(queuedWithdrawAmount)
  return [balanceSansQueued, queuedWithdrawAmount]
}

export interface Order {
  sellAmount: BigNumber
  buyAmount: BigNumber
  userId: BigNumber
}

export function decodeOrder(bytes: string): Order {
  return {
    userId: BigNumber.from('0x' + bytes.substring(2, 18)),
    sellAmount: BigNumber.from('0x' + bytes.substring(43, 66)),
    buyAmount: BigNumber.from('0x' + bytes.substring(19, 42)),
  }
}

export function encodeOrder(order: Order): string {
  return (
    '0x' +
    order.userId.toHexString().slice(2).padStart(16, '0') +
    order.buyAmount.toHexString().slice(2).padStart(24, '0') +
    order.sellAmount.toHexString().slice(2).padStart(24, '0')
  )
}

async function sharesToAsset(shares: BigNumber, assetPerShare: BigNumber, decimals: BigNumber) {
  return shares.mul(assetPerShare).div(BigNumber.from(10).pow(decimals.toString()))
}

export const getDeltaStep = (asset: string) => {
  switch (asset) {
    case 'WBTC':
      return BigNumber.from('1000')
    case 'AAVE':
      return BigNumber.from('10')
    case 'NEAR':
    case 'AURORA':
      return BigNumber.from('5')
    case 'SUSHI':
      return BigNumber.from('1')
    case 'WETH':
      return BigNumber.from('100')
    default:
      throw new Error(`Delta Step not found for asset: ${asset}`)
  }
}
