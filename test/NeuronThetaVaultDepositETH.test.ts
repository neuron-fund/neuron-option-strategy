import { depositToNeuronPool } from '../helpers/neuronPool'
import { BigNumber } from '@ethersproject/bignumber'
import { assert } from '../helpers/assertions'
import { expect } from 'chai'
import { runVaultTests } from '../helpers/runVaultTests'
import { NEURON_POOL_ETH, WETH } from '../constants/externalAddresses'
import { ethers } from 'hardhat'
import { parseEther } from '@ethersproject/units'

runVaultTests('#depositETH', async function (params) {
  const {
    collateralVaults,
    userSigner,
    user,
    collateralAssetsContracts,
    collateralAssetsAddresses,
    underlying,
    isPut,
  } = params
  const depositAmount = params.depositAmount
  const collateralVault = collateralVaults[0]
  const neuronPool = collateralAssetsContracts[0]

  if (underlying !== WETH || isPut) {
    return () => {
      it('reverts when ETH deposit not supported', async function () {
        await expect(
          collateralVault.connect(userSigner).deposit(parseEther('1'), NEURON_POOL_ETH, { value: parseEther('1') })
        ).to.be.revertedWith('!_depositToken')
      })
    }
  }

  return () => {
    it('creates pending deposit successfully', async function () {
      const tx = await collateralVault
        .connect(userSigner)
        .deposit(depositAmount, NEURON_POOL_ETH, { value: depositAmount })

      const ct = await collateralVault.connect(userSigner).decimals()
      console.log('ct', ct)

      const txReceipt = await tx.wait()

      const neuronPoolTokensMintEvent = txReceipt.events.find(
        x => x.address === neuronPool.address && x?.event === 'Transfer' && x?.args[0] === ethers.constants.AddressZero
      )

      const neuronPoolDepositedTokensAmount = neuronPoolTokensMintEvent.args[2] as BigNumber

      // Unchanged for share balance and totalSupply
      assert.bnEqual(await collateralVault.totalSupply(), BigNumber.from(0))
      assert.bnEqual(await collateralVault.balanceOf(user), BigNumber.from(0))
      await expect(tx).to.emit(collateralVault, 'Deposit').withArgs(user, neuronPoolDepositedTokensAmount, 1)

      assert.bnEqual(await collateralVault.totalPending(), neuronPoolDepositedTokensAmount)
      const { round, amount } = await collateralVault.depositReceipts(user)
      assert.equal(round, 1)
      assert.bnEqual(amount, neuronPoolDepositedTokensAmount)
    })

    it('reverts when no value passed', async function () {
      const collateralVault = collateralVaults[0]
      await expect(collateralVault.connect(userSigner).deposit(0, NEURON_POOL_ETH)).to.be.revertedWith('!amount')
    })

    it('reverts when value does not meet amount', async function () {
      const collateralVault = collateralVaults[0]
      await expect(
        collateralVault.connect(userSigner).deposit(parseEther('1'), NEURON_POOL_ETH, {
          value: parseEther('0.5'),
        })
      ).to.be.revertedWith('deposit ETH: msg.value != _amount')
    })

    it('reverts when value does not meet amount', async function () {
      const collateralVault = collateralVaults[0]
      await expect(
        collateralVault.connect(userSigner).deposit(parseEther('1'), NEURON_POOL_ETH, {
          value: parseEther('0.5'),
        })
      ).to.be.revertedWith('deposit ETH: msg.value != _amount')
    })

    it('reverts when passing value with non eth deposit token', async function () {
      const collateralVault = collateralVaults[0]
      await expect(
        collateralVault.connect(userSigner).deposit(parseEther('1'), collateralAssetsAddresses[0], {
          value: parseEther('0.5'),
        })
      ).to.be.revertedWith('deposit non-ETH: msg.value != 0')
    })
  }
})
