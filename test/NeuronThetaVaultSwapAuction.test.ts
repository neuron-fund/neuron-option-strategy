// import { ethers } from 'hardhat'
// import { BigNumber } from 'ethers'
// import { parseUnits } from 'ethers/lib/utils'
// import TestVolOracle_ABI from '../constants/abis/TestVolOracle.json'
// import OptionsPremiumPricerInStables_ABI from '../constants/abis/OptionsPremiumPricerInStables.json'
// import * as time from './helpers/time'
// import {
//   CHAINID,
//   ETH_PRICE_ORACLE,
//   USDC_PRICE_ORACLE,
//   UNIV3_ETH_USDC_POOL,
//   UNIV3_WBTC_USDC_POOL,
//   GAMMA_CONTROLLER,
//   MARGIN_POOL,
//   ON_TOKEN_FACTORY,
//   USDC_ADDRESS,
//   WETH_ADDRESS,
//   GNOSIS_EASY_AUCTION,
//   DEX_ROUTER,
//   TestVolOracle_BYTECODE,
//   OptionsPremiumPricerInStables_BYTECODE,
//   GAMMA_ORACLE,
// } from '../constants/constants'
// import { deployProxy, setAssetPricer } from './helpers/utils'
// import { prepareNeuronPool } from './helpers/neuronPool'
// import {
//   CollateralVaultLifecycle__factory,
//   DeltaStrikeSelection__factory,
//   MockNeuronPoolPricer__factory,
//   MockNeuronPool__factory,
//   NeuronPoolUtils__factory,
//   VaultLifecycle__factory,
// } from '../typechain-types'
// import { runVaultTests } from './helpers/runVaultTests'
// import { PERIOD } from './helpers/vault'

// const { getContractFactory } = ethers
// const { parseEther } = ethers.utils

// const chainId = CHAINID.ETH_MAINNET

// runVaultTests('NeuronThetaVaultSwapAuction', async function (params) {
//   return () => {
//     it('OTM auction swap', async () => {
//       const [adminSigner, ownerSigner, keeperSigner, userSigner, feeRecipientSigner] = await ethers.getSigners()
//       const UNIV3_POOL = UNIV3_ETH_USDC_POOL[chainId]
//       const UNDERLYING_PRICE_ORACLE = ETH_PRICE_ORACLE[chainId]
//       const STRIKE_PRICE_ORACLE = USDC_PRICE_ORACLE[chainId]

//       const TestVolOracle = await getContractFactory(TestVolOracle_ABI, TestVolOracle_BYTECODE, ownerSigner)
//       const testVolOracle = await TestVolOracle.deploy(PERIOD, 7)
//       await testVolOracle.initPool(UNIV3_POOL)

//       const OptionsPremiumPricer = await getContractFactory(
//         OptionsPremiumPricerInStables_ABI,
//         OptionsPremiumPricerInStables_BYTECODE,
//         ownerSigner
//       )
//       const optionsPremiumPricer = await OptionsPremiumPricer.deploy(
//         UNIV3_POOL,
//         testVolOracle.address,
//         UNDERLYING_PRICE_ORACLE,
//         STRIKE_PRICE_ORACLE
//       )

//       const StrikeSelection = (await getContractFactory(
//         'DeltaStrikeSelection',
//         ownerSigner
//       )) as DeltaStrikeSelection__factory

//       const strikeSelection = await StrikeSelection.deploy(
//         optionsPremiumPricer.address,
//         params.deltaFirstOption,
//         params.deltaStep
//       )

//       const VaultLifecycle = (await ethers.getContractFactory('VaultLifecycle')) as VaultLifecycle__factory
//       const vaultLifecycleLib = await VaultLifecycle.deploy()

//       const CollateralVaultLifecycle = (await ethers.getContractFactory(
//         'CollateralVaultLifecycle'
//       )) as CollateralVaultLifecycle__factory
//       const collateralVaultLifecycleLib = await CollateralVaultLifecycle.deploy()

//       const NeuronPoolUtils = (await ethers.getContractFactory('NeuronPoolUtils')) as NeuronPoolUtils__factory
//       const neuronPoolUtilsLib = await NeuronPoolUtils.deploy()

//       const MockNeuronPool = (await ethers.getContractFactory('MockNeuronPool')) as MockNeuronPool__factory
//       const MockNeuronPoolPricer = (await ethers.getContractFactory(
//         'MockNeuronPoolPricer'
//       )) as MockNeuronPoolPricer__factory
//       const collateralAssetsContracts = []
//       const collateralAssetsAddresses = []
//       const collateralVaults = []
//       const collateralAssetsOracles = []
//       const collateralAssetsOraclesAddresses = []
//       const collateralVaultDeployArgs = [WETH_ADDRESS[chainId], USDC_ADDRESS[chainId]]
//       for (let i = 0; i < params.collateralAssetsNumber; i++) {
//         const mockNeuronPool = await MockNeuronPool.deploy(params.asset)
//         await prepareNeuronPool(chainId, mockNeuronPool)
//         const mockNeuronPoolAddress = mockNeuronPool.address

//         const mockNeuronPoolPricer = await MockNeuronPoolPricer.deploy(
//           mockNeuronPoolAddress,
//           params.asset,
//           GAMMA_ORACLE[chainId]
//         )
//         collateralAssetsContracts.push(mockNeuronPool)
//         collateralAssetsAddresses.push(mockNeuronPool.address)
//         collateralAssetsOracles.push(mockNeuronPoolPricer)
//         collateralAssetsOraclesAddresses.push(mockNeuronPoolPricer.address)
//         await setAssetPricer(mockNeuronPoolAddress, mockNeuronPoolPricer.address)
//         const collateralVaultInitializeArgs = [
//           ownerSigner.address,
//           keeperSigner.address,
//           feeRecipientSigner.address,
//           params.managementFee,
//           params.performanceFee,
//           `COLLATERAL-${params.tokenName}`,
//           `CV${params.tokenSymbol}`,
//           [
//             params.isPut,
//             params.tokenDecimals,
//             params.collateralUnwrappedAsset,
//             mockNeuronPoolAddress,
//             params.asset,
//             params.minimumSupply,
//             parseUnits('500', params.tokenDecimals > 18 ? params.tokenDecimals : 18),
//           ],
//         ]
//         const collateralVault = (
//           await deployProxy(
//             'NeuronCollateralVault',
//             adminSigner,
//             collateralVaultInitializeArgs,
//             collateralVaultDeployArgs,
//             {
//               libraries: {
//                 CollateralVaultLifecycle: collateralVaultLifecycleLib.address,
//                 NeuronPoolUtils: neuronPoolUtilsLib.address,
//               },
//             }
//           )
//         ).connect(keeperSigner)
//         collateralVaults.push(collateralVault)

//         const collateralVaultsAddresses = collateralVaults.map(vault => vault.address)

//         const vaultInitializeArgs = [
//           owner,
//           keeper,
//           feeRecipient,
//           managementFee,
//           performanceFee,
//           tokenName,
//           tokenSymbol,
//           optionsPremiumPricer.address,
//           strikeSelection.address,
//           premiumDiscount,
//           {
//             auctionDuration,
//             asset,
//           },

//           [isPut, tokenDecimals, collateralUnwrappedAsset, collateralAssetsAddresses, asset, collateralVaultsAddresses],
//         ]

//         const vaultDeployArgs = [
//           WETH_ADDRESS[chainId],
//           USDC_ADDRESS[chainId],
//           ON_TOKEN_FACTORY[chainId],
//           GAMMA_CONTROLLER[chainId],
//           MARGIN_POOL[chainId],
//           GNOSIS_EASY_AUCTION[chainId],
//           DEX_ROUTER[chainId],
//           DEX_FACTORY[chainId],
//         ]

//         const vault = (
//           await deployProxy('NeuronThetaVault', adminSigner, vaultInitializeArgs, vaultDeployArgs, {
//             libraries: {
//               VaultLifecycle: vaultLifecycleLib.address,
//               NeuronPoolUtils: neuronPoolUtilsLib.address,
//             },
//           })
//         ).connect(userSigner)

//         // Set NeuronThetaVault as keeper for collateral vault
//         for (const collateralVault of collateralVaults) {
//           await collateralVault.connect(ownerSigner).setNewKeeper(vault.address)
//         }

//         // Update volatility
//         const values = [
//           BigNumber.from('2000000000'),
//           BigNumber.from('2100000000'),
//           BigNumber.from('2200000000'),
//           BigNumber.from('2150000000'),
//           BigNumber.from('2250000000'),
//           BigNumber.from('2350000000'),
//           BigNumber.from('2450000000'),
//           BigNumber.from('2550000000'),
//           BigNumber.from('2350000000'),
//           BigNumber.from('2450000000'),
//           BigNumber.from('2250000000'),
//           BigNumber.from('2250000000'),
//           BigNumber.from('2650000000'),
//         ]

//         for (let i = 0; i < values.length; i++) {
//           await testVolOracle.setPrice(values[i])
//           const topOfPeriod = (await getTopOfPeriod()) + PERIOD
//           await time.increaseTo(topOfPeriod)
//           await testVolOracle.mockCommit(
//             params.asset === WETH_ADDRESS[chainId] ? UNIV3_ETH_USDC_POOL[chainId] : UNIV3_WBTC_USDC_POOL[chainId]
//           )
//         }
//       }
//     })
//   }
// })
