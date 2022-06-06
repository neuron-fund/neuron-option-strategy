import { ethers } from 'hardhat'

import { expect } from 'chai'
import { BigNumber, constants } from 'ethers'
import { parseUnits } from 'ethers/lib/utils'
import {
  GAMMA_CONTROLLER,
  MARGIN_POOL,
  ON_TOKEN_FACTORY,
  GNOSIS_EASY_AUCTION,
  DEX_ROUTER,
  CHAINID,
} from '../constants/constants'
import { assert } from '../helpers/assertions'
import { USDC, WETH } from '../constants/externalAddresses'
import { FEE_SCALING, OPTION_DELAY, WEEKS_PER_YEAR } from '../helpers/vault'
import { runVaultTests } from '../helpers/runVaultTests'

const chainId = CHAINID.ETH_MAINNET

runVaultTests('#initialize', async function (params) {
  const {
    owner,
    keeper,
    feeRecipient,
    tokenName,
    tokenSymbol,
    tokenDecimals,
    minimumSupply,
    underlying: asset,
    collateralUnwrappedAsset,
    premiumDiscount,
    managementFee,
    performanceFee,
    isPut,
    strikeSelection,
    optionsPremiumPricer,
    vaultLifecycleLib,
    neuronPoolUtilsLib,
    vault,
    collateralVaults,
    collateralVaultsAddresses,
    collateralAssetsAddresses,
    auctionDuration,
    auctionBiddingToken,
    userSigner,
  } = params

  const NeuronThetaVault = await ethers.getContractFactory('NeuronThetaVault', {
    libraries: {
      VaultLifecycle: vaultLifecycleLib.address,
      NeuronPoolUtils: neuronPoolUtilsLib.address,
    },
  })
  const vaultDeployArgs = [
    WETH,
    USDC,
    ON_TOKEN_FACTORY[chainId],
    GAMMA_CONTROLLER[chainId],
    MARGIN_POOL[chainId],
    GNOSIS_EASY_AUCTION[chainId],
    DEX_ROUTER[chainId],
  ] as const
  const testVault = await NeuronThetaVault.deploy(...vaultDeployArgs)

  return () => {
    it('initializes with correct values', async function () {
      for (const collateralVault of collateralVaults) {
        const [isPut, decimals, assetFromContract, , underlyingFromContract, minimumSupply, cap] =
          await collateralVault.getVaultParams()
        assert.equal(decimals, tokenDecimals)
        assert.equal(assetFromContract, collateralUnwrappedAsset)
        assert.equal(asset, underlyingFromContract)
        assert.equal(await vault.WETH(), WETH)
        assert.equal(await vault.USDC(), USDC)
        assert.bnEqual(minimumSupply, BigNumber.from(params.minimumSupply))
        assert.equal(isPut, params.isPut)

        assert.bnEqual(cap, parseUnits('500', tokenDecimals > 18 ? tokenDecimals : 18))
        assert.equal(
          (await collateralVault.cap()).toString(),
          parseUnits('500', tokenDecimals > 18 ? tokenDecimals : 18).toString()
        )
        assert.equal(await collateralVault.owner(), owner)
        assert.equal(await collateralVault.keeper(), vault.address)
        assert.equal(await collateralVault.feeRecipient(), feeRecipient)
        assert.equal(
          (await collateralVault.managementFee()).toString(),
          managementFee.mul(FEE_SCALING).div(WEEKS_PER_YEAR).toString()
        )
        assert.equal((await collateralVault.performanceFee()).toString(), performanceFee.toString())
        assert.bnEqual(await collateralVault.totalPending(), BigNumber.from(0))
      }
      assert.equal(await vault.owner(), owner)
      assert.equal(await vault.keeper(), keeper)
      assert.equal(await vault.feeRecipient(), feeRecipient)
      assert.equal(
        (await vault.managementFee()).toString(),
        managementFee.mul(FEE_SCALING).div(WEEKS_PER_YEAR).toString()
      )
      assert.equal((await vault.performanceFee()).toString(), performanceFee.toString())
      const [isPut, decimals, assetFromContract, , underlyingFromContract, ,] = await vault.getVaultParams()
      assert.equal(await decimals, tokenDecimals)
      assert.equal(decimals, tokenDecimals)
      assert.equal(assetFromContract, collateralUnwrappedAsset)
      assert.equal(asset, underlyingFromContract)
      assert.equal(await vault.WETH(), WETH)
      assert.equal(await vault.USDC(), USDC)
      assert.equal(minimumSupply, params.minimumSupply)
      assert.equal(isPut, params.isPut)
      assert.equal((await vault.premiumDiscount()).toString(), params.premiumDiscount.toString())
      assert.equal(await vault.optionsPremiumPricer(), optionsPremiumPricer.address)
      assert.equal(await vault.strikeSelection(), strikeSelection.address)
      assert.bnEqual(await vault.auctionDuration(), BigNumber.from(auctionDuration))
    })

    it('cannot be initialized twice', async function () {
      await expect(
        vault.initialize(
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
          {
            auctionDuration,
            auctionBiddingToken,
          },
          {
            isPut,
            decimals: tokenDecimals,
            asset: collateralUnwrappedAsset,
            collateralAssets: collateralAssetsAddresses,
            underlying: asset,
            collateralVaults: collateralVaultsAddresses,
          }
        )
      ).to.be.revertedWith('Initializable: contract is already initialized')
    })
    it('reverts when initializing with 0 owner', async function () {
      await expect(
        testVault.initialize(
          constants.AddressZero,
          keeper,
          feeRecipient,
          managementFee,
          performanceFee,
          tokenName,
          tokenSymbol,
          optionsPremiumPricer.address,
          strikeSelection.address,
          premiumDiscount,
          {
            auctionDuration,
            auctionBiddingToken,
          },
          {
            isPut,
            decimals: tokenDecimals,
            asset: collateralUnwrappedAsset,
            collateralAssets: collateralAssetsAddresses,
            underlying: asset,
            collateralVaults: collateralVaultsAddresses,
          }
        )
      ).to.be.revertedWith('!owner')
    })
    it('reverts when initializing with 0 keeper', async function () {
      // TODO neuron same test on initialize for NeuronCollateralVault
      await expect(
        testVault.initialize(
          owner,
          constants.AddressZero,
          feeRecipient,
          managementFee,
          performanceFee,
          tokenName,
          tokenSymbol,
          optionsPremiumPricer.address,
          strikeSelection.address,
          premiumDiscount,
          {
            auctionDuration,
            auctionBiddingToken,
          },
          {
            isPut,
            decimals: tokenDecimals,
            asset: collateralUnwrappedAsset,
            collateralAssets: collateralAssetsAddresses,
            underlying: asset,
            collateralVaults: collateralVaultsAddresses,
          }
        )
      ).to.be.revertedWith('!keeper')
    })
    it('reverts when initializing with 0 feeRecipient', async function () {
      await expect(
        testVault.initialize(
          owner,
          keeper,
          constants.AddressZero,
          managementFee,
          performanceFee,
          tokenName,
          tokenSymbol,
          optionsPremiumPricer.address,
          strikeSelection.address,
          premiumDiscount,
          { auctionDuration, auctionBiddingToken },
          {
            isPut,
            decimals: tokenDecimals,
            asset: collateralUnwrappedAsset,
            collateralAssets: collateralAssetsAddresses,
            underlying: asset,
            collateralVaults: collateralVaultsAddresses,
          }
        )
      ).to.be.revertedWith('!feeRecipient')
    })
    // TODO transform this test for NeuronCollateralVault cause it has cup only now
    //it("reverts when initializing with 0 initCap", async function () {
    //   await expect(
    //     testVault.initialize(
    //       [
    //         owner,
    //         keeper,
    //         feeRecipient,
    //         managementFee,
    //         performanceFee,
    //         tokenName,
    //         tokenSymbol,
    //         optionsPremiumPricer.address,
    //         strikeSelection.address,
    //         premiumDiscount,
    //         auctionDuration,
    //         isUsdcAuction,
    //       ],
    //       [
    //         isPut,
    //         tokenDecimals,
    //         isPut ? USDC : asset,
    //         asset,
    //         minimumSupply,
    //         0,
    //       ]
    //     )
    //   ).to.be.revertedWith("!cap");
    // });
    it('reverts when asset is 0x', async function () {
      await expect(
        testVault.initialize(
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
          { auctionDuration, auctionBiddingToken },
          {
            isPut,
            decimals: tokenDecimals,
            asset: constants.AddressZero,
            collateralAssets: collateralAssetsAddresses,
            underlying: asset,
            collateralVaults: collateralVaultsAddresses,
          }
        )
      ).to.be.revertedWith('!asset')
    })

    it('reverts when underlying is 0x', async function () {
      await expect(
        testVault.initialize(
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
          { auctionDuration, auctionBiddingToken },
          {
            isPut,
            decimals: tokenDecimals,
            asset: collateralUnwrappedAsset,
            collateralAssets: collateralAssetsAddresses,
            underlying: constants.AddressZero,
            collateralVaults: collateralVaultsAddresses,
          }
        )
      ).to.be.revertedWith('!underlying')
    })

    it('returns the name', async function () {
      assert.equal(await vault.name(), tokenName)
    })

    it('returns the symbol', async function () {
      assert.equal(await vault.symbol(), tokenSymbol)
    })

    it('returns the delay', async function () {
      assert.equal((await vault.DELAY()).toNumber(), OPTION_DELAY)
    })

    it('returns the owner', async function () {
      assert.equal(await vault.owner(), owner)
    })

    it('should return 18 for decimals', async function () {
      let collateralVault = collateralVaults[0]
      assert.equal((await collateralVault.connect(userSigner).decimals()).toString(), tokenDecimals.toString())
    })

    it('returns the management fee', async function () {
      assert.equal(
        (await vault.managementFee()).toString(),
        managementFee.mul(FEE_SCALING).div(WEEKS_PER_YEAR).toString()
      )
    })

    it('returns the performance fee', async function () {
      assert.equal((await vault.performanceFee()).toString(), performanceFee.toString())
    })

    it('returns the auction duration', async function () {
      assert.equal((await vault.auctionDuration()).toString(), auctionDuration.toString())
    })

    it('should return 18 for decimals', async function () {
      let collateralVault = collateralVaults[0]
      assert.equal((await collateralVault.connect(userSigner).decimals()).toString(), tokenDecimals.toString())
    })
  }
})
