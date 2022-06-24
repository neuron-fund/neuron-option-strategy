// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

interface INeuronCollateralVault {
    /************************************************
     *  EVENTS
     ***********************************************/

    event Deposit(address indexed account, uint256 amount, uint256 round);

    event InitiateWithdraw(address indexed account, uint256 shares, uint256 round);

    event InstantWithdraw(address indexed account, uint256 amount, uint256 round);

    event Redeem(address indexed account, uint256 share, uint256 round);

    event ManagementFeeSet(uint256 managementFee, uint256 newManagementFee);

    event PerformanceFeeSet(uint256 performanceFee, uint256 newPerformanceFee);

    event CapSet(uint256 oldCap, uint256 newCap);

    event Withdraw(address indexed account, uint256 amount, uint256 shares);

    event CollectVaultFees(uint256 performanceFee, uint256 vaultFee, uint256 round, address indexed feeRecipient);

    event OpenShort(uint256 depositAmount, address indexed manager);

    event PremiumSwap(uint256 recievedAmount, uint256 swapResultAmount, uint256 round);

    function rollToNextOption() external returns (uint256 lockedAmountInCollateral, uint256 lockedAmountInAsset);

    function commitAndClose(address premiumToken) external;
}
