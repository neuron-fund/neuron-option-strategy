import { BigNumber } from '@ethersproject/bignumber'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { ethers, deployments } from 'hardhat'
import { parseUnits } from 'ethers/lib/utils'
import TestVolOracle_ABI from '../constants/abis/TestVolOracle.json'
import OptionsPremiumPricerInStables_ABI from '../constants/abis/OptionsPremiumPricerInStables.json'
import moment from 'moment-timezone'
import {
  ETH_PRICE_ORACLE,
  BTC_PRICE_ORACLE,
  USDC_PRICE_ORACLE,
  UNIV3_ETH_USDC_POOL,
  UNIV3_WBTC_USDC_POOL,
  GAMMA_CONTROLLER,
  MARGIN_POOL,
  ON_TOKEN_FACTORY,
  GNOSIS_EASY_AUCTION,
  DEX_ROUTER,
  TestVolOracle_BYTECODE,
  OptionsPremiumPricerInStables_BYTECODE,
  GAMMA_ORACLE,
  CHAINID,
} from '../constants/constants'
import {
  deployProxy,
  setupOracle,
  whitelistProduct,
  setAssetPricer,
  convertPriceAmount,
  setOpynOracleExpiryPriceNeuron,
} from '../helpers/utils'
import { prepareNeuronPool } from '../helpers/neuronPool'
import { USDC, WETH } from '../constants/externalAddresses'
import {
  CollateralVaultLifecycle,
  IERC20Detailed,
  IGnosisAuction,
  INeuronPool,
  IONtoken,
  IONtokenFactory,
  IPricer,
  MockNeuronPool,
  MockNeuronPoolPricer,
  NeuronCollateralVault,
  NeuronPoolUtils,
  NeuronThetaVault,
  VaultLifecycle,
  IERC20Detailed__factory,
  IONtoken__factory,
  IONtokenFactory__factory,
  IGnosisAuction__factory,
  INeuronPool__factory,
  INeuronPoolPricer__factory,
} from '../typechain-types'
import { Contract } from '@ethersproject/contracts'
import * as time from './time'

const { provider, getContractAt, getContractFactory } = ethers
const { parseEther } = ethers.utils

moment.tz.setDefault('UTC')

export const OPTION_DELAY = 0
export const DELAY_INCREMENT = 100
export const FEE_SCALING = BigNumber.from(10).pow(6)
export const WEEKS_PER_YEAR = 52142857
export const PERIOD = 43200 // 12 hours

export type Option = {
  address: string
  strikePrice: BigNumber
  expiry: number
}

/**
 * VaultTestParams - Parameter of option vault
 */
export type VaultTestParams = {
  /** name - Name of test */
  name: string
  /** tokenName - Name of Option Vault */
  tokenName: string
  /** tokenSymbol - Symbol of Option Vault */
  tokenSymbol: string
  /** tokenDecimals - Decimals of the vault shares */
  tokenDecimals: number
  /** asset - Address of asset */
  underlying: string
  /** strikeAsset - Address of strike assets */
  strikeAsset: string
  /** chainlinkPricer - Address of chainlink pricer */
  chainlinkPricer: string
  /**  neuronPoolsNames - names of Neuron Pools used as assets for NeuronCollateralVaults */
  neuronPoolsNames: string[]
  /**  neuronPoolsPricersNames - names of Neuron Pools Pricers, should be in same order as neuronPoolsNames provided */
  neuronPoolsPricersNames: string[]
  /** neuron pools additional pricers names */
  additionalPricersNames?: {
    pricerName: string
    asset: string
  }[]
  /** deltaFirstOption - Delta of first option */
  deltaFirstOption: BigNumber
  /** deltaSecondOption - Delta of second option */
  deltaSecondOption: BigNumber
  /** deltaStep - Step to use for xiterating over strike prices and corresponding deltas */
  deltaStep: BigNumber
  /** underlyingPricer */
  underlyingPricer: string
  /** depositAmount - Deposit amount */
  depositAmount: BigNumber
  /** minimumSupply - Minimum supply to maintain for share and asset balance */
  minimumSupply: string
  /** expectedMintAmount - Expected onToken amount to be minted with our deposit */
  expectedMintAmount: BigNumber
  /** auctionDuration - Duration of gnosis auction in seconds */
  auctionDuration: number
  /** premiumDiscount - Premium discount of the sold options to incentivize arbitraguers (thousandths place: 000 - 999) */
  premiumDiscount: BigNumber
  /** managementFee - Management fee (6 decimals) */
  managementFee: BigNumber
  /** performanceFee - PerformanceFee fee (6 decimals) */
  performanceFee: BigNumber
  /** isPut - Boolean flag for if the vault sells call or put options */
  isPut: boolean
  /** isUsdcAuction - Boolean flag whether auction is denominated in USDC */
  auctionBiddingToken: string
}

export async function initiateVault(params: VaultTestParams) {
  // Addresses
  let owner: string
  let keeper: string
  let user: string
  let feeRecipient: string

  // Signers
  let adminSigner: SignerWithAddress
  let userSigner: SignerWithAddress
  let ownerSigner: SignerWithAddress
  let keeperSigner: SignerWithAddress
  let feeRecipientSigner: SignerWithAddress

  // Parameters
  let tokenName = params.tokenName
  let tokenSymbol = params.tokenSymbol
  let tokenDecimals = params.tokenDecimals
  let minimumSupply = params.minimumSupply
  let underlying = params.underlying
  let depositAmount = params.depositAmount
  let premiumDiscount = params.premiumDiscount
  let managementFee = params.managementFee
  let performanceFee = params.performanceFee
  // let expectedMintAmount = params.expectedMintAmount;
  const auctionDuration = params.auctionDuration
  const auctionBiddingToken = params.auctionBiddingToken

  let isPut = params.isPut

  // Contracts
  let strikeSelection: Contract
  let volOracle: Contract
  let optionsPremiumPricer: Contract
  let gnosisAuction: IGnosisAuction
  let vaultLifecycleLib: VaultLifecycle
  let neuronPoolUtilsLib: NeuronPoolUtils
  let collateralVaultLifecycleLib: CollateralVaultLifecycle
  let vault: NeuronThetaVault
  let onTokenFactory: IONtokenFactory
  let defaultONtoken: IONtoken
  let assetContract: IERC20Detailed
  let usdcContract: IERC20Detailed
  let collateralVaults: NeuronCollateralVault[] = []
  let collateralVaultsAddresses: string[] = []
  let collateralAssetsContracts: INeuronPool[] = []
  let collateralAssetsOracles: IPricer[] = []
  let collateralAssetsOraclesAddresses: string[] = []
  let auctionBiddingTokenContract: IERC20Detailed
  let auctionBiddingTokenDecimals: number

  // Variables
  let collateralAssetsAddresses: string[] = []
  let defaultONtokenAddress: string
  let firstOptionStrike: BigNumber
  let firstOptionPremium: BigNumber
  let premiumCalcToken: string
  let firstOptionExpiry: number
  let secondOptionStrike: BigNumber
  let secondOptionExpiry: number

  let firstOption: Option
  let secondOption: Option
  ;[adminSigner, ownerSigner, keeperSigner, userSigner, feeRecipientSigner] = await ethers.getSigners()
  await setupOracle(params.underlying, ownerSigner)
  owner = ownerSigner.address
  keeper = keeperSigner.address
  user = userSigner.address
  feeRecipient = feeRecipientSigner.address
  auctionBiddingTokenContract = (await getContractAt('IERC20Detailed', auctionBiddingToken)) as IERC20Detailed
  auctionBiddingTokenDecimals = await auctionBiddingTokenContract.decimals()

  const rollToNextOption = async () => {
    await vault.connect(ownerSigner).commitAndClose()
    await time.increaseTo((await getNextOptionReadyAt()) + DELAY_INCREMENT)
    await strikeSelection.setDelta(params.deltaFirstOption)
    await vault.connect(keeperSigner).rollToNextOption()
  }

  const rollToSecondOption = async (settlementPrice: BigNumber) => {
    const oracle = await setupOracle(params.underlying, ownerSigner)

    await setOpynOracleExpiryPriceNeuron(
      params.underlying,
      oracle,
      settlementPrice,
      collateralAssetsOracles,
      await getCurrentOptionExpiry()
    )
    await strikeSelection.setDelta(params.deltaSecondOption)
    await vault.connect(ownerSigner).commitAndClose()
    await time.increaseTo((await vault.nextOptionReadyAt()).toNumber() + 1)
    await vault.connect(keeperSigner).rollToNextOption()
  }

  const getNextOptionReadyAt = async () => {
    const optionState = await vault.optionState()
    return optionState.nextOptionReadyAt
  }

  const getCurrentOptionExpiry = async () => {
    const currentOption = await vault.currentOption()
    const onToken = IONtoken__factory.connect(currentOption, userSigner)
    return onToken.expiryTimestamp()
  }

  const getTopOfPeriod = async () => {
    const latestTimestamp = (await provider.getBlock('latest')).timestamp
    let topOfPeriod: number

    const rem = latestTimestamp % PERIOD
    if (rem < Math.floor(PERIOD / 2)) {
      topOfPeriod = latestTimestamp - rem + PERIOD
    } else {
      topOfPeriod = latestTimestamp + rem + PERIOD
    }
    return topOfPeriod
  }

  const updateVol = async (asset: string) => {
    const values = [
      BigNumber.from('2000000000'),
      BigNumber.from('2100000000'),
      BigNumber.from('2200000000'),
      BigNumber.from('2150000000'),
      BigNumber.from('2250000000'),
      BigNumber.from('2350000000'),
      BigNumber.from('2450000000'),
      BigNumber.from('2550000000'),
      BigNumber.from('2350000000'),
      BigNumber.from('2450000000'),
      BigNumber.from('2250000000'),
      BigNumber.from('2250000000'),
      BigNumber.from('2650000000'),
    ]

    for (let i = 0; i < values.length; i++) {
      await volOracle.setPrice(values[i])
      const topOfPeriod = (await getTopOfPeriod()) + PERIOD
      await time.increaseTo(topOfPeriod)
      await volOracle.mockCommit(
        asset === WETH ? UNIV3_ETH_USDC_POOL[CHAINID.ETH_MAINNET] : UNIV3_WBTC_USDC_POOL[CHAINID.ETH_MAINNET]
      )
    }
  }

  const TestVolOracle = await getContractFactory(TestVolOracle_ABI, TestVolOracle_BYTECODE, ownerSigner)

  volOracle = await TestVolOracle.deploy(PERIOD, 7)

  await volOracle.initPool(
    underlying === WETH ? UNIV3_ETH_USDC_POOL[CHAINID.ETH_MAINNET] : UNIV3_WBTC_USDC_POOL[CHAINID.ETH_MAINNET]
  )

  const OptionsPremiumPricer = await getContractFactory(
    OptionsPremiumPricerInStables_ABI,
    OptionsPremiumPricerInStables_BYTECODE,
    ownerSigner
  )

  const StrikeSelection = await getContractFactory('DeltaStrikeSelection', ownerSigner)

  optionsPremiumPricer = await OptionsPremiumPricer.deploy(
    params.underlying === WETH ? UNIV3_ETH_USDC_POOL[CHAINID.ETH_MAINNET] : UNIV3_WBTC_USDC_POOL[CHAINID.ETH_MAINNET],
    volOracle.address,
    params.underlying === WETH ? ETH_PRICE_ORACLE[CHAINID.ETH_MAINNET] : BTC_PRICE_ORACLE[CHAINID.ETH_MAINNET],
    USDC_PRICE_ORACLE[CHAINID.ETH_MAINNET]
  )

  strikeSelection = await StrikeSelection.deploy(
    optionsPremiumPricer.address,
    params.deltaFirstOption,
    params.deltaStep
  )

  const VaultLifecycle = await ethers.getContractFactory('VaultLifecycle')
  vaultLifecycleLib = (await VaultLifecycle.deploy()) as VaultLifecycle

  const CollateralVaultLifecycle = await ethers.getContractFactory('CollateralVaultLifecycle')
  collateralVaultLifecycleLib = (await CollateralVaultLifecycle.deploy()) as CollateralVaultLifecycle

  const NeuronPoolUtils = await ethers.getContractFactory('NeuronPoolUtils')
  neuronPoolUtilsLib = (await NeuronPoolUtils.deploy()) as NeuronPoolUtils

  gnosisAuction = IGnosisAuction__factory.connect(GNOSIS_EASY_AUCTION[CHAINID.ETH_MAINNET], ownerSigner)

  for (const additionalPricer of params.additionalPricersNames) {
    const additionalPricerDeployment = await deployments.get(additionalPricer.pricerName)
    await setAssetPricer(additionalPricer.asset, additionalPricerDeployment.address)
  }

  collateralAssetsContracts = []
  collateralAssetsAddresses = []
  collateralVaults = []
  const collateralVaultDeployArgs = [WETH, USDC]
  for (const [i, neuronPoolName] of params.neuronPoolsNames.entries()) {
    const neuronPoolDeployment = await deployments.get(neuronPoolName)
    const neuronPool = INeuronPool__factory.connect(neuronPoolDeployment.address, ownerSigner)
    await prepareNeuronPool(CHAINID.ETH_MAINNET, neuronPool)
    const neuronPoolAddress = neuronPool.address

    const neuronPoolPricerName = params.neuronPoolsPricersNames[i]

    const neuronPoolPricerDeployment = await deployments.get(neuronPoolPricerName)

    const neuronPoolPricer = INeuronPoolPricer__factory.connect(neuronPoolPricerDeployment.address, ownerSigner)

    collateralAssetsContracts.push(neuronPool)
    collateralAssetsAddresses.push(neuronPool.address)
    collateralAssetsOracles.push(neuronPoolPricer)
    collateralAssetsOraclesAddresses.push(neuronPoolPricer.address)
    await setAssetPricer(neuronPoolAddress, neuronPoolPricer.address)

    const collateralUnwrappedAsset = await neuronPool.token()
    const neuronPoolSupportedTokens = await neuronPool.getSupportedTokens()
    // TODO neuron actually not all are "base tokens" for metapool, it can also be other from 3crv token in metapool
    const neuronPoolBaseTokens = neuronPoolSupportedTokens.filter(x => x !== collateralUnwrappedAsset)

    const collateralVaultInitializeArgs = [
      owner,
      keeper,
      feeRecipient,
      managementFee,
      performanceFee,
      `COLLATERAL-${tokenName}`,
      `CV${tokenSymbol}`,
      [
        isPut,
        tokenDecimals,
        collateralUnwrappedAsset,
        neuronPoolAddress,
        underlying,
        minimumSupply,
        parseUnits('500', tokenDecimals > 18 ? tokenDecimals : 18),
      ],
      neuronPoolBaseTokens,
    ]
    const collateralVault = (
      await deployProxy(
        'NeuronCollateralVault',
        adminSigner,
        collateralVaultInitializeArgs,
        collateralVaultDeployArgs,
        {
          libraries: {
            CollateralVaultLifecycle: collateralVaultLifecycleLib.address,
            NeuronPoolUtils: neuronPoolUtilsLib.address,
          },
        }
      )
    ).connect(keeperSigner) as NeuronCollateralVault
    collateralVaults.push(collateralVault)
  }

  collateralVaultsAddresses = collateralVaults.map(vault => vault.address)

  const vaultInitializeArgs = [
    owner,
    keeper,
    feeRecipient,
    managementFee,
    performanceFee,
    tokenName,
    tokenSymbol,
    optionsPremiumPricer.address,
    strikeSelection.address,
    premiumDiscount,
    [auctionDuration, auctionBiddingToken],
    [isPut, tokenDecimals, collateralAssetsAddresses, underlying, collateralVaultsAddresses],
  ]

  const vaultDeployArgs = [
    WETH,
    USDC,
    ON_TOKEN_FACTORY[CHAINID.ETH_MAINNET],
    GAMMA_CONTROLLER[CHAINID.ETH_MAINNET],
    MARGIN_POOL[CHAINID.ETH_MAINNET],
    GNOSIS_EASY_AUCTION[CHAINID.ETH_MAINNET],
    DEX_ROUTER[CHAINID.ETH_MAINNET],
  ]

  vault = (
    await deployProxy('NeuronThetaVault', adminSigner, vaultInitializeArgs, vaultDeployArgs, {
      libraries: {
        VaultLifecycle: vaultLifecycleLib.address,
        NeuronPoolUtils: neuronPoolUtilsLib.address,
      },
    })
  ).connect(userSigner) as NeuronThetaVault

  // Set NeuronThetaVault as keeper for collateral vault
  for (const collateralVault of collateralVaults) {
    await collateralVault.connect(ownerSigner).setNewKeeper(vault.address)
  }

  // Update volatility
  await updateVol(params.underlying)

  onTokenFactory = IONtokenFactory__factory.connect(ON_TOKEN_FACTORY[CHAINID.ETH_MAINNET], ownerSigner)

  await whitelistProduct(params.underlying, params.strikeAsset, collateralAssetsAddresses, params.isPut)

  const latestTimestamp = (await provider.getBlock('latest')).timestamp
  // Create first option
  firstOptionExpiry = moment(latestTimestamp * 1000)
    .add(1, 'week')
    .startOf('isoWeek')
    .day('friday')
    .hours(8)
    .minutes(0)
    .seconds(0)
    .unix()
  ;[firstOptionStrike] = await strikeSelection.getStrikePrice(firstOptionExpiry, params.isPut)

  firstOptionPremium = BigNumber.from(
    await optionsPremiumPricer.getPremium(firstOptionStrike, firstOptionExpiry, params.isPut)
  )
  premiumCalcToken = isPut ? params.strikeAsset : underlying

  if (auctionBiddingTokenContract.address !== premiumCalcToken) {
    firstOptionPremium = await convertPriceAmount(
      premiumCalcToken,
      auctionBiddingTokenContract.address,
      firstOptionPremium,
      userSigner
    )
  }

  const firstOptionAddress = await onTokenFactory.getTargetONtokenAddress(
    params.underlying,
    params.strikeAsset,
    collateralAssetsAddresses,
    collateralAssetsAddresses.map(x => 0),
    firstOptionStrike,
    firstOptionExpiry,
    params.isPut
  )

  firstOption = {
    address: firstOptionAddress,
    strikePrice: firstOptionStrike,
    expiry: firstOptionExpiry,
  }

  // Create second option
  secondOptionExpiry = moment(latestTimestamp * 1000)
    .startOf('isoWeek')
    .add(2, 'week')
    .day('friday')
    .hours(8)
    .minutes(0)
    .seconds(0)
    .unix()

  secondOptionStrike = firstOptionStrike.add(await strikeSelection.step())

  await strikeSelection.setDelta(params.deltaFirstOption)

  const secondOptionAddress = await onTokenFactory.getTargetONtokenAddress(
    params.underlying,
    params.strikeAsset,
    collateralAssetsAddresses,
    collateralAssetsAddresses.map(x => 0),
    secondOptionStrike,
    secondOptionExpiry,
    params.isPut
  )

  secondOption = {
    address: secondOptionAddress,
    strikePrice: secondOptionStrike,
    expiry: secondOptionExpiry,
  }

  for (const collateralVault of collateralVaults) {
    await collateralVault.initRounds(50)
  }

  defaultONtokenAddress = firstOption.address
  defaultONtoken = IONtoken__factory.connect(defaultONtokenAddress, userSigner)
  usdcContract = IERC20Detailed__factory.connect(USDC, userSigner)
  assetContract = IERC20Detailed__factory.connect(underlying, userSigner)
  const addressToDeposit = [userSigner, ownerSigner, adminSigner]

  if (params.underlying === WETH) {
    for (const signerToDeposit of addressToDeposit) {
      // @ts-ignore
      await assetContract.connect(signerToDeposit).deposit({ value: parseEther('100') })
    }
  }

  return {
    owner,
    keeper,
    user,
    feeRecipient,
    adminSigner,
    userSigner,
    ownerSigner,
    keeperSigner,
    feeRecipientSigner,
    tokenName,
    tokenSymbol,
    tokenDecimals,
    minimumSupply,
    underlying,
    depositAmount,
    premiumDiscount,
    managementFee,
    performanceFee,
    isPut,
    strikeSelection,
    volOracle,
    optionsPremiumPricer,
    gnosisAuction,
    vaultLifecycleLib,
    neuronPoolUtilsLib,
    collateralVaultLifecycleLib,
    vault,
    onTokenFactory,
    defaultONtoken,
    assetContract,
    usdcContract,
    collateralVaults,
    collateralVaultsAddresses,
    collateralAssetsContracts,
    collateralAssetsOracles,
    collateralAssetsOraclesAddresses,
    auctionBiddingTokenContract,
    auctionBiddingTokenDecimals,
    collateralAssetsAddresses,
    defaultONtokenAddress,
    firstOptionStrike,
    firstOptionPremium,
    premiumCalcToken,
    secondOptionStrike,
    firstOption,
    secondOption,
    secondOptionAddress,
    rollToNextOption,
    rollToSecondOption,
    auctionBiddingToken,
    auctionDuration,
    getCurrentOptionExpiry,
    deltaSecondOption: params.deltaSecondOption,
    expectedMintAmount: params.expectedMintAmount,
  }
}