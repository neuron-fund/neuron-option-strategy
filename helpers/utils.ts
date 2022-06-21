import hre, { ethers, artifacts, deployments } from 'hardhat'
import { increaseTo } from './time'
import ORACLE_ABI from '../constants/abis/OpynOracle.json'
import {
  CHAINID,
  GAMMA_ORACLE,
  GAMMA_ORACLE_NEW,
  GAMMA_WHITELIST,
  GAMMA_WHITELIST_OWNER,
  ORACLE_DISPUTE_PERIOD,
  ORACLE_LOCKING_PERIOD,
  ORACLE_OWNER,
  USDC_ADDRESS,
  WBTC_ADDRESS,
} from '../constants/constants'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumber, BigNumberish, Contract, Signer } from 'ethers'
import { wmul } from '../helpers/math'
import { getAsset } from './funds'
import { IOracle__factory } from '../typechain-types'
const { provider } = ethers
const { parseEther } = ethers.utils
const chainId = hre.network.config.chainId || 1

export async function deployProxy(
  logicContractName: string,
  adminSigner: SignerWithAddress,
  initializeArgs: any[],
  logicDeployParams = [],
  factoryOptions = {}
) {
  const AdminUpgradeabilityProxy = await ethers.getContractFactory('AdminUpgradeabilityProxy', adminSigner)
  const LogicContract = await ethers.getContractFactory(logicContractName, factoryOptions || {})
  const logic = await LogicContract.deploy(...logicDeployParams)

  const initBytes = LogicContract.interface.encodeFunctionData('initialize', initializeArgs)

  const proxy = await AdminUpgradeabilityProxy.deploy(logic.address, await adminSigner.getAddress(), initBytes)
  return await ethers.getContractAt(logicContractName, proxy.address)
}

export async function parseLog(contractName: string, log: { topics: string[]; data: string }) {
  if (typeof contractName !== 'string') {
    throw new Error('contractName must be string')
  }
  const abi = (await artifacts.readArtifact(contractName)).abi
  const iface = new ethers.utils.Interface(abi)
  const event = iface.parseLog(log)
  return event
}

export async function getAssetPricer(pricer: string, signer: SignerWithAddress) {
  await hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [pricer],
  })

  const ownerSigner = await provider.getSigner(pricer)

  const pricerContract = await ethers.getContractAt('IYearnPricer', pricer)

  const forceSendContract = await ethers.getContractFactory('ForceSend')
  const forceSend = await forceSendContract.deploy() // force Send is a contract that forces the sending of Ether to WBTC minter (which is a contract with no receive() function)
  await forceSend.connect(signer).go(pricer, { value: parseEther('0.5') })

  return await pricerContract.connect(ownerSigner)
}

export async function setAssetPricer(asset: string, pricer: string) {
  await hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [ORACLE_OWNER[chainId]],
  })

  const ownerSigner = await provider.getSigner(ORACLE_OWNER[chainId])

  const oracle = await ethers.getContractAt('IOracle', GAMMA_ORACLE_NEW[chainId])

  await oracle.connect(ownerSigner).setAssetPricer(asset, pricer)
}

export async function whitelistProduct(
  underlying: string,
  strike: string,
  collaterals: string[],
  isPut: boolean,
  useNew = false
) {
  const [adminSigner] = await ethers.getSigners()
  const ownerAddress = useNew ? GAMMA_WHITELIST_OWNER[chainId] : ORACLE_OWNER[chainId]

  await hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [ownerAddress],
  })

  const ownerSigner = await provider.getSigner(ownerAddress)

  const whitelist = await ethers.getContractAt('IGammaWhitelist', GAMMA_WHITELIST[chainId])

  await adminSigner.sendTransaction({
    to: ownerAddress,
    value: parseEther('1'),
  })

  const realOwner = await whitelist.connect(ownerSigner).owner()

  await whitelist.connect(ownerSigner).whitelistCollaterals(collaterals)

  await whitelist.connect(ownerSigner).whitelistProduct(underlying, strike, collaterals, isPut)
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

  await oracle.connect(oracleOwner).setStablePrice(USDC_ADDRESS[chainId], '100000000')

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

export async function setOpynOracleExpiryPriceNeuron(
  underlyingAsset: string,
  underlyingOracle: Contract,
  underlyingSettlePrice: BigNumber,
  collateralPricers: Contract[],
  expiry: BigNumber
) {
  await increaseTo(expiry.toNumber() + ORACLE_LOCKING_PERIOD + 1)

  const res = await underlyingOracle.setExpiryPrice(underlyingAsset, expiry, underlyingSettlePrice)
  await res.wait()
  await hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [ORACLE_OWNER[chainId]],
  })
  const oracleOwnerSigner = await provider.getSigner(ORACLE_OWNER[chainId])

  let receipt
  for (const collateralPricer of collateralPricers) {
    console.log('collateralPricer', collateralPricer.address)
    const res2 = await collateralPricer.connect(oracleOwnerSigner).setExpiryPriceInOracle(expiry)
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

export async function mintToken(
  contract: Contract,
  contractOwner: string,
  recipient: string,
  spender: string,
  amount: BigNumberish
) {
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

  if (isBridgeToken(chainId, contract.address)) {
    // Avax mainnet uses BridgeTokens which have a special mint function
    const txid = ethers.utils.formatBytes32String('Hello World!')
    await contract.connect(tokenOwnerSigner).mint(recipient, amount, recipient, 0, txid)
  } else if (contract.address === USDC_ADDRESS[chainId] || chainId === CHAINID.AURORA_MAINNET) {
    await contract.connect(tokenOwnerSigner).transfer(recipient, amount)
  } else {
    await contract.connect(tokenOwnerSigner).mint(recipient, amount)
  }

  const recipientSigner = await ethers.provider.getSigner(recipient)
  await contract.connect(recipientSigner).approve(spender, amount)

  await hre.network.provider.request({
    method: 'hardhat_stopImpersonatingAccount',
    params: [contractOwner],
  })
}

export const isBridgeToken = (chainId: number, address: string) =>
  chainId === CHAINID.AVAX_MAINNET && (address === WBTC_ADDRESS[chainId] || address === USDC_ADDRESS[chainId])

export const convertPriceAmount = async (tokenIn: string, tokenOut: string, amount: BigNumber, signer: Signer) => {
  const oracle = new ethers.Contract(GAMMA_ORACLE[chainId], ORACLE_ABI, signer)
  const inPrice = await oracle.getPrice(tokenIn)
  const outPrice = await oracle.getPrice(tokenOut)

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
  // console.log('convertPriceAmount ~ newReturn', newReturn)

  return newReturn
}

export async function bidForONToken(
  gnosisAuction: Contract,
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
  const queueStartElement = '0x0000000000000000000000000000000000000000000000000000000000000001'

  await getAsset(CHAINID.ETH_MAINNET, biddingTokenContract.address, bid, contractSigner)

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

  console.log('after placeSellOrders')

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

export async function closeAuctionAndClaim(
  gnosisAuction: Contract,
  thetaVault: Contract,
  vault: Contract,
  signer: string
) {
  const userSigner = await ethers.provider.getSigner(signer)
  await gnosisAuction.connect(userSigner).settleAuction(await thetaVault.optionAuctionID())
  await vault.claimAuctionONtokens()
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

export const serializeToObject = (solidityValue: unknown) => {
  if (BigNumber.isBigNumber(solidityValue)) {
    return solidityValue.toString()
  }
  // Handle structs recursively
  if (Array.isArray(solidityValue)) {
    return solidityValue.map(val => serializeToObject(val))
  }
  return solidityValue
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
      if (chainId === CHAINID.AVAX_MAINNET) {
        return BigNumber.from('5')
      }
      return BigNumber.from('100')
    default:
      throw new Error(`Delta Step not found for asset: ${asset}`)
  }
}
