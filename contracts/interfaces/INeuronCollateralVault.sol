// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

interface INeuronCollateralVault {
    function rollToNextOption() external returns (uint256 lockedAmountInCollateral, uint256 lockedAmountInAsset);

    function commitAndClose() external;
}
