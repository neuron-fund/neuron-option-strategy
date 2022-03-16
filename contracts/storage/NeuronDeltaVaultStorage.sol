// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;
import {INeuronThetaVault} from "../interfaces/INeuronThetaVault.sol";
import {Vault} from "../libraries/Vault.sol";

abstract contract NeuronDeltaVaultStorageV1 {
    // Neuron counterparty theta vault
    INeuronThetaVault public counterpartyThetaVault;
    // % of funds to be used for weekly option purchase
    uint256 public optionAllocation;
    // Delta vault equivalent of lockedAmount
    uint256 public balanceBeforePremium;
    // User Id of delta vault in latest gnosis auction
    Vault.AuctionSellOrder public auctionSellOrder;
}

abstract contract NeuronDeltaVaultStorageV2 {
    // Amount locked for scheduled withdrawals last week;
    uint128 public lastQueuedWithdrawAmount;
}

// We are following Compound's method of upgrading new contract implementations
// When we need to add new storage variables, we create a new version of NeuronDeltaVaultStorage
// e.g. NeuronDeltaVaultStorage<versionNumber>, so finally it would look like
// contract NeuronDeltaVaultStorage is NeuronDeltaVaultStorageV1, NeuronDeltaVaultStorageV2
abstract contract NeuronDeltaVaultStorage is NeuronDeltaVaultStorageV1, NeuronDeltaVaultStorageV2 {

}
