// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

interface IGammaWhitelist {
    function whitelistCollaterals(address[] calldata _collaterals) external;

    function whitelistProduct(
        address _underlying,
        address _strike,
        address[] calldata _collaterals,
        bool _isPut
    ) external;

    function owner() external returns (address);
}
